#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : true;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

const htmlPath = required("--html");
const sourceUrl = new URL(required("--source-url"));
const outDir = path.resolve(required("--out"));
const routePath = arg("--route", sourceUrl.pathname.replace(/^\/+|\/+$/g, ""));
const htmlSource = await fs.readFile(htmlPath, "utf8");
let nextData = {};
const nextDataMatch = htmlSource.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
if (nextDataMatch) {
  try {
    nextData = JSON.parse(nextDataMatch[1]);
  } catch {
    // Keep the shell usable even when the framework payload is not strict JSON.
  }
}
const rawFlow = nextData?.query?.flow ?? sourceUrl.searchParams.get("flow");
const defaultFlow = Array.isArray(rawFlow) ? rawFlow[0] : rawFlow;
const sameOrigin = (url) => url.origin === sourceUrl.origin;
const resources = new Map();
const hydrationWarnings = [];

function collectResource(raw) {
  try {
    const url = new URL(raw, sourceUrl);
    if (!sameOrigin(url) || !url.pathname.startsWith("/_next/")) return;
    resources.set(url.pathname, url);
  } catch {
    // Ignore malformed or non-HTTP references in the source document.
  }
}

function collectPath(rawPath) {
  try {
    const pathname = new URL(rawPath, sourceUrl).pathname;
    if (!pathname.startsWith("/_next/")) return;
    resources.set(pathname, new URL(pathname, sourceUrl));
  } catch {
    // Ignore malformed runtime paths.
  }
}

function collectSameOriginPath(rawPath, base = sourceUrl) {
  try {
    const url = new URL(rawPath, base);
    if (!sameOrigin(url)) return;
    resources.set(url.pathname, url);
  } catch {
    // Ignore malformed CSS/document references.
  }
}

for (const match of htmlSource.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) collectResource(match[1]);
for (const match of htmlSource.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) collectResource(match[1]);
for (const match of htmlSource.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']stylesheet["'][^>]*>/gi)) collectResource(match[1]);
for (const match of htmlSource.matchAll(/<link\b([^>]*)>/gi)) {
  const attrs = match[1];
  if (!/\brel=["'][^"']*(?:icon|manifest)[^"']*["']/i.test(attrs)) continue;
  const href = attrs.match(/\bhref=["']([^"']+)["']/i);
  if (href) collectSameOriginPath(href[1]);
}

async function download([pathname, url]) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      accept: "*/*",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${url.href}`);
  const target = path.join(outDir, pathname.replace(/^\/+/, ""));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
  return { pathname, url: url.href, status: response.status, bytes: (await fs.stat(target)).size };
}

async function downloadEntries(entries) {
  const downloaded = [];
  for (const batch of entries.reduce((groups, item, index) => {
    const batchIndex = Math.floor(index / 8);
    (groups[batchIndex] ||= []).push(item);
    return groups;
  }, [])) {
    downloaded.push(...await Promise.all(batch.map(download)));
  }
  return downloaded;
}

let downloaded = await downloadEntries(Array.from(resources.entries()));

function parseJsonScript(html, name) {
  const match = html.match(new RegExp(`<script\\b[^>]*${name}[^>]*>([\\s\\S]*?)<\\/script>`, "i"));
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function parseEnv(html) {
  const match = html.match(/window\[['"]__ENV['"]\]\s*=\s*({[\s\S]*?});/i);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flowNodes(value, result = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) flowNodes(item, result, seen);
    return result;
  }
  if (value.type === "QUESTION" || value.type === "INFO_PAGE") result.push(value);
  for (const child of Object.values(value)) flowNodes(child, result, seen);
  return result;
}

function dynamicImportIds(text, key) {
  const escaped = escapeRegExp(key);
  const pattern = new RegExp(
    `${escaped}\\s*(?:\\])?\\s*:\\s*\\w+\\(\\)\\(\\(\\)=>\\s*(?:Promise\\.all\\(\\[([^\\]]*)\\]|[A-Za-z_$][\\w$]*\\.e\\((\\d+)\\))`,
    "g",
  );
  const ids = new Set();
  for (const match of text.matchAll(pattern)) {
    for (const id of (match[1]?.matchAll(/\.e\((\d+)\)/g) || [])) ids.add(Number(id[1]));
    if (match[2]) ids.add(Number(match[2]));
  }
  return ids;
}

function allDynamicImportIds(text) {
  return new Set([...text.matchAll(/\.e\((\d+)\)/g)].map((match) => Number(match[1])));
}

function dynamicImportIdsForInnerType(text, innerType) {
  const enumName = enumKeyFromTag(innerType);
  const ids = new Set();
  const casePattern = new RegExp("case\\s+[A-Za-z_$][\\w$]*\\.o_\\." + escapeRegExp(enumName) + "\\s*:", "g");
  const declarationPattern = /[A-Za-z_$][\w$]*=l\(\)\(\(\)=>Promise\.all\(\[([^\]]*)\]\)/g;
  for (const caseMatch of text.matchAll(casePattern)) {
    const before = text.slice(Math.max(0, caseMatch.index - 5000), caseMatch.index);
    const declarations = [...before.matchAll(declarationPattern)];
    const declaration = declarations.at(-1);
    if (!declaration) continue;
    for (const id of declaration[1].matchAll(/\.e\((\d+)\)/g)) ids.add(Number(id[1]));
  }
  return ids;
}

function splitTopLevel(value) {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = quote ? (quote === char ? null : quote) : char;
      continue;
    }
    if (!quote && char === ",") {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function manifestBindings(manifestText) {
  const functionMatch = manifestText.match(/self\.__BUILD_MANIFEST=function\(([^)]*)\)\{return/);
  const callStart = manifestText.lastIndexOf("}}(");
  const callEnd = callStart >= 0 ? manifestText.indexOf("),self.__BUILD_MANIFEST_CB", callStart) : -1;
  if (!functionMatch || callStart < 0 || callEnd < 0) return new Map();
  const names = functionMatch[1].split(",").map((name) => name.trim()).filter(Boolean);
  const values = splitTopLevel(manifestText.slice(callStart + 3, callEnd));
  const bindings = new Map();
  for (let index = 0; index < Math.min(names.length, values.length); index += 1) {
    const value = values[index];
    if (value === "void 0") continue;
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      try {
        bindings.set(names[index], JSON.parse(value));
      } catch {
        bindings.set(names[index], value.slice(1, -1));
      }
    }
  }
  return bindings;
}

function manifestRouteResources(manifestText, routePaths) {
  const result = new Set();
  const bindings = manifestBindings(manifestText);
  for (const route of routePaths) {
    const routePattern = new RegExp("\"" + escapeRegExp(route) + "\":\\[([^\\]]*)\\]");
    const match = manifestText.match(routePattern);
    if (!match) continue;
    for (const token of splitTopLevel(match[1])) {
      const resource = bindings.get(token) || (token.startsWith("\"") || token.startsWith("'") ? token.slice(1, -1) : token);
      if (resource.startsWith("static/chunks/") || resource.startsWith("static/css/")) {
        result.add("/_next/" + resource);
      }
    }
  }
  return result;
}

function enumKeyFromTag(tag) {
  return String(tag)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
}

function parseRuntimeChunkMap(runtimeText) {
  const jsById = new Map();
  const cssById = new Map();

  for (const match of runtimeText.matchAll(/(\d+)===[A-Za-z_$][\w$]*\?"static\/chunks\/([^"\\]+\.js)"/g)) {
    jsById.set(Number(match[1]), `/_next/static/chunks/${match[2]}`);
  }
  for (const match of runtimeText.matchAll(/(\d+)===[A-Za-z_$][\w$]*\?"static\/chunks\/"\+[A-Za-z_$][\w$]*\+"-([a-f0-9]+\.js)"/g)) {
    jsById.set(Number(match[1]), `/_next/static/chunks/${match[1]}-${match[2]}`);
  }

  const fallbackStart = runtimeText.indexOf('static/chunks/"+(({');
  const fallbackEnd = fallbackStart >= 0 ? runtimeText.indexOf('})[e]+".js', fallbackStart) : -1;
  if (fallbackStart >= 0 && fallbackEnd > fallbackStart) {
    const prefixById = new Map();
    const suffixById = new Map();
    for (const match of runtimeText.slice(fallbackStart, fallbackEnd).matchAll(/(\d+):"([a-f0-9]+)"/g)) {
      const id = Number(match[1]);
      if (match[2].length <= 8) prefixById.set(id, match[2]);
      else suffixById.set(id, match[2]);
    }
    for (const [id, suffix] of suffixById) {
      const prefix = prefixById.get(id) || String(id);
      if (!jsById.has(id)) jsById.set(id, `/_next/static/chunks/${prefix}.${suffix}.js`);
    }
  }

  const cssStart = runtimeText.indexOf('static/css/"+({');
  const cssEnd = cssStart >= 0 ? runtimeText.indexOf('})[e]+".css', cssStart) : -1;
  if (cssStart >= 0 && cssEnd > cssStart) {
    for (const match of runtimeText.slice(cssStart, cssEnd).matchAll(/(\d+):"([a-f0-9]+)"/g)) {
      cssById.set(Number(match[1]), `/_next/static/css/${match[2]}.css`);
    }
  }
  return { jsById, cssById };
}

async function hydrateFlowRuntime() {
  if (!arg("--hydrate-flow") || !defaultFlow) return { flow: null, ids: [], resources: [] };

  let flow = null;
  const flowJsonPath = arg("--flow-json");
  try {
    if (flowJsonPath) {
      flow = JSON.parse(await fs.readFile(path.resolve(flowJsonPath), "utf8"));
    } else {
      const env = parseEnv(htmlSource);
      const apiBase = env.WEB_CONSTRUCTOR_API || "https://api.web-constructor.betterme.world";
      const flowUrl = new URL(`/flows/quiz-flow/${encodeURIComponent(String(defaultFlow))}`, apiBase.endsWith("/") ? apiBase : `${apiBase}/`);
      const firstPageId = sourceUrl.searchParams.get("firstPageId");
      if (firstPageId) flowUrl.searchParams.set("firstPageId", firstPageId);
      const response = await fetch(flowUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
          accept: "application/json",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${flowUrl.href}`);
      flow = await response.json();
    }
    await fs.writeFile(path.join(outDir, `flow-${String(defaultFlow)}.json`), `${JSON.stringify(flow, null, 2)}\n`);
  } catch (error) {
    hydrationWarnings.push(`flow: ${error.message}`);
    return { flow: null, ids: [], resources: [] };
  }

  const routeResourcePaths = new Set();
  const flowPageRoutes = new Set(
    (Array.isArray(flow.pages) ? flow.pages : [])
      .filter((page) => page?.pageUrl && (page.pageType === "email_page" || page.pageTag === "onboarding_page"))
      .map((page) => page.pageUrl),
  );
  const manifestPath = [...resources.keys()].find((pathname) => pathname.endsWith("/_buildManifest.js"));
  if (manifestPath && flowPageRoutes.size) {
    try {
      const manifestText = await fs.readFile(path.join(outDir, manifestPath.replace(/^\/+/, "")), "utf8");
      for (const pathname of manifestRouteResources(manifestText, flowPageRoutes)) {
        routeResourcePaths.add(pathname);
        collectPath(pathname);
      }
      const downloadedPaths = new Set(downloaded.map((item) => item.pathname));
      const extra = [...routeResourcePaths]
        .filter((pathname) => !downloadedPaths.has(pathname))
        .map((pathname) => [pathname, resources.get(pathname)]);
      downloaded.push(...await downloadEntries(extra));
    } catch (error) {
      hydrationWarnings.push("flow pages: " + error.message);
    }
  }

  const nodes = flowNodes(flow);
  const dynamicKeys = new Set();
  for (const node of nodes) {
    if (node.type === "INFO_PAGE") {
      const schema = typeof node.schema === "string" ? node.schema : node.schema?.slug;
      if (schema) dynamicKeys.add(schema);
      if (node.innerType === "bmi_images") dynamicKeys.add("infoPageBmiWellnessProfile");
      if (node.innerType) dynamicKeys.add("innerType:" + node.innerType);
      if (node.url) dynamicKeys.add(JSON.stringify(node.url));
    }
    if (node.type === "QUESTION" && node.questionComponentTag) {
      dynamicKeys.add(enumKeyFromTag(node.questionComponentTag));
    }
  }

  const jsFiles = downloaded
    .map((item) => item.pathname)
    .filter((pathname) => pathname.endsWith(".js"));
  const sourceBundles = [];
  for (const pathname of jsFiles) {
    try {
      sourceBundles.push(await fs.readFile(path.join(outDir, pathname.replace(/^\/+/, "")), "utf8"));
    } catch {
      // A resource can be non-textual despite its extension; skip it.
    }
  }
  const ids = new Set();
  for (const key of dynamicKeys) {
    for (const text of sourceBundles) {
      const discovered = key.startsWith("innerType:")
        ? dynamicImportIdsForInnerType(text, key.slice("innerType:".length))
        : dynamicImportIds(text, key);
      for (const id of discovered) ids.add(id);
    }
  }
  for (const text of sourceBundles) {
    for (const marker of ["renderFooterLegalNavigation"]) {
      const markerIndex = text.indexOf(marker);
      if (markerIndex < 0) continue;
      for (const id of allDynamicImportIds(text.slice(Math.max(0, markerIndex - 1600), markerIndex + 400))) ids.add(id);
    }
  }
  for (const pathname of routeResourcePaths) {
    if (!pathname.endsWith(".js") || !pathname.includes("/chunks/pages/")) continue;
    try {
      const text = await fs.readFile(path.join(outDir, pathname.replace(/^\/+/, "")), "utf8");
      for (const id of allDynamicImportIds(text)) ids.add(id);
    } catch {
      // The route bundle was optional; the main flow remains usable.
    }
  }

  const runtimeText = sourceBundles.find((text, index) => jsFiles[index]?.includes("/webpack-")) || "";
  const { jsById, cssById } = parseRuntimeChunkMap(runtimeText);
  const unresolved = [];
  for (const id of ids) {
    const jsPath = jsById.get(id);
    const cssPath = cssById.get(id);
    if (jsPath) collectPath(jsPath);
    if (cssPath) collectPath(cssPath);
    if (!jsPath && !cssPath) unresolved.push(id);
  }

  let frontier = new Set(ids);
  const hydratedIds = new Set();
  for (let pass = 0; pass < 1 && frontier.size; pass += 1) {
    const entries = [];
    for (const id of frontier) {
      if (hydratedIds.has(id)) continue;
      hydratedIds.add(id);
      for (const pathname of [jsById.get(id), cssById.get(id)].filter(Boolean)) {
        const url = new URL(pathname, sourceUrl);
        if (!resources.has(pathname)) resources.set(pathname, url);
        entries.push([pathname, url]);
      }
    }
    const freshEntries = entries.filter(([pathname], index, all) => all.findIndex(([candidate]) => candidate === pathname) === index);
    const passDownloaded = freshEntries.length ? await downloadEntries(freshEntries) : [];
    downloaded.push(...passDownloaded);
    frontier = new Set();
  }

  return {
    flow,
    ids: [...ids].sort((a, b) => a - b),
    hydratedIds: [...hydratedIds].sort((a, b) => a - b),
    unresolved,
    resources: downloaded.filter((item) => item.pathname.startsWith("/_next/") && !jsFiles.includes(item.pathname)),
  };
}

async function hydrateCssAssets() {
  const hydrated = new Set();
  for (let pass = 0; pass < 3; pass += 1) {
    const entries = [];
    for (const item of downloaded.filter((entry) => entry.pathname.endsWith(".css"))) {
      if (hydrated.has(item.pathname)) continue;
      hydrated.add(item.pathname);
      const localPath = path.join(outDir, item.pathname.replace(/^\/+/, ""));
      let cssText;
      try {
        cssText = await fs.readFile(localPath, "utf8");
      } catch {
        continue;
      }
      const base = new URL(item.pathname, sourceUrl);
      for (const match of cssText.matchAll(/url\(\s*[\"']?([^\"')]+)[\"']?\s*\)/gi)) {
        const raw = match[1].trim();
        if (!raw || raw.startsWith("data:") || raw.startsWith("#")) continue;
        try {
          const url = new URL(raw, base);
          if (!sameOrigin(url) || resources.has(url.pathname)) continue;
          resources.set(url.pathname, url);
          entries.push([url.pathname, url]);
        } catch {
          // Ignore malformed CSS URLs.
        }
      }
    }
    const uniqueEntries = entries.filter(([pathname], index, all) => all.findIndex(([candidate]) => candidate === pathname) === index);
    if (!uniqueEntries.length) break;
    downloaded.push(...await downloadEntries(uniqueEntries));
  }
  return downloaded.filter((item) => item.pathname.startsWith("/_next/static/media/"));
}

if (arg("--hydrate-manifest")) {
  const manifestPath = [...resources.keys()].find((pathname) => pathname.endsWith("/_buildManifest.js"));
  if (manifestPath) {
    const manifestText = await fs.readFile(path.join(outDir, manifestPath.replace(/^\/+/, "")), "utf8");
    const manifestPaths = new Set([...manifestText.matchAll(/(?:^|["'])((?:static)\/(?:chunks|css)\/[^"'\\]+)/g)].map((match) => `/_next/${match[1]}`));
    const extra = [];
    for (const pathname of manifestPaths) {
      if (resources.has(pathname)) continue;
      const url = new URL(pathname, sourceUrl);
      resources.set(pathname, url);
      extra.push([pathname, url]);
    }
    downloaded.push(...await downloadEntries(extra));
  }
}

const flowHydration = await hydrateFlowRuntime();
const cssAssets = await hydrateCssAssets();

let html = htmlSource;
let removedExternalScripts = 0;
html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>[\s\S]*?<\/script>/gi, (full, before, rawSrc, after) => {
  try {
    const url = new URL(rawSrc, sourceUrl);
    if (sameOrigin(url) && url.pathname.startsWith("/_next/")) {
      return full.replace(rawSrc, url.pathname);
    }
  } catch {
    // Remove malformed external script references from the local preview.
  }
  removedExternalScripts += 1;
  return "";
});
html = html.replace(/<iframe\b[^>]*(?:googletagmanager|google-analytics|gtm)[^>]*>[\s\S]*?<\/iframe>/gi, "");
html = html.replace(/<noscript\b[^>]*>[\s\S]*?(?:googletagmanager|google-analytics|gtm)[\s\S]*?<\/noscript>/gi, "");
html = html.replace(/<link\b([^>]*)\bhref=["']([^"']+)["']([^>]*)>/gi, (full, before, rawHref, after) => {
  try {
    const url = new URL(rawHref, sourceUrl);
    if (sameOrigin(url) && url.pathname.startsWith("/_next/")) return full.replace(rawHref, url.pathname);
  } catch {
    // Preserve non-resource links.
  }
  return full;
});

const outputs = [path.join(outDir, "index.html")];
if (routePath) outputs.push(path.join(outDir, routePath.replace(/^\/+|\/+$/g, ""), "index.html"));
const canonicalRoute = `/${routePath.replace(/^\/+|\/+$/g, "")}/`;
const localeRoot = routePath.split("/")[0];
const rootRedirect = defaultFlow ? `<script>(function(){var p=location.pathname,s=new URLSearchParams(location.search),r=${JSON.stringify(canonicalRoute)},f=${JSON.stringify(String(defaultFlow))};if(p==='/'||p==='/${localeRoot}'||p==='/${localeRoot}/'){if(!s.has('flow'))s.set('flow',f);location.replace(r+'?'+s.toString())}})();</script>` : "";
for (const output of outputs) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const outputHtml = output === outputs[0] && rootRedirect ? html.replace(/<head>/i, `<head>${rootRedirect}`) : html;
  await fs.writeFile(output, outputHtml);
}

console.log(JSON.stringify({
  outDir,
  outputs,
  runtimeResources: downloaded,
  hydratedManifest: Boolean(arg("--hydrate-manifest")),
  flowHydration: {
    enabled: Boolean(arg("--hydrate-flow")),
    flowFetched: Boolean(flowHydration.flow),
    dynamicIds: flowHydration.ids,
    hydratedIds: flowHydration.hydratedIds,
    unresolved: flowHydration.unresolved,
    downloadedResources: flowHydration.resources.length,
  },
  cssAssets: cssAssets.map((item) => item.pathname),
  hydrationWarnings,
  defaultFlow,
  rootRedirect: Boolean(rootRedirect),
  removedExternalScripts,
}, null, 2));
