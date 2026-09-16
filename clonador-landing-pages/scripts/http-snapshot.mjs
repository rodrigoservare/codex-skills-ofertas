#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 " +
  "LandingSnapshot/1.0";

function usage(message) {
  if (message) console.error(`Erro: ${message}\n`);
  console.error("Uso: node http-snapshot.mjs --url https://exemplo.com/pagina --out /caminho/do/projeto [--max-bytes 12000000]");
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function skipUrl(value) {
  const item = decodeHtml(String(value || "").trim());
  return !item || /^(?:#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(item);
}

function resolveUrl(value, base) {
  if (skipUrl(value)) return null;
  try {
    const url = new URL(decodeHtml(value), base);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || null;
}

function addResource(resources, value, base, kind, source) {
  const url = resolveUrl(value, base);
  if (url) resources.push({ url, kind, source });
}

function parseSnapshot(html, baseUrl) {
  const resources = [];
  const scripts = [];
  const tagRe = /<(img|video|source|iframe|audio|script|link)\b[^>]*>/gi;

  for (const match of html.matchAll(tagRe)) {
    const tag = match[0];
    const name = match[1].toLowerCase();
    if (name === "script") {
      const src = attr(tag, "src");
      if (src) addResource(scripts, src, baseUrl, "script", "script[src]");
      continue;
    }
    if (name === "link") {
      const rel = attr(tag, "rel") || "";
      const as = attr(tag, "as") || "";
      if (!/(?:stylesheet|icon|preload|prefetch|modulepreload|mask-icon)/i.test(`${rel} ${as}`)) continue;
      addResource(resources, attr(tag, "href"), baseUrl, "link", `link[rel=${rel}]`);
      continue;
    }
    addResource(resources, attr(tag, "src"), baseUrl, name, `${name}[src]`);
    addResource(resources, attr(tag, "poster"), baseUrl, "poster", `${name}[poster]`);
    addResource(resources, attr(tag, "data-src"), baseUrl, name, `${name}[data-src]`);
    const srcset = attr(tag, "srcset") || attr(tag, "data-srcset");
    if (srcset) {
      for (const candidate of srcset.split(",")) {
        addResource(resources, candidate.trim().split(/\s+/)[0], baseUrl, "srcset", `${name}[srcset]`);
      }
    }
  }

  const cssUrlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  for (const match of html.matchAll(cssUrlRe)) addResource(resources, match[1], baseUrl, "css-url", "inline-css");

  const unique = (items) => [...new Map(items.map((item) => [item.url, item])).values()];
  const assets = unique(resources);
  const scriptList = unique(scripts);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
  const lang = html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1] || "";
  const viewport = html.match(/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i)?.[1] || null;
  const canonical = html.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || null;
  return { title, lang, viewport, canonical: resolveUrl(canonical, baseUrl), assets, scripts: scriptList };
}

async function fetchDocument(url, maxBytes) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        signal: controller.signal,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      clearTimeout(timer);
      return { response, bytes };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("falha de transporte");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.out) usage("informe --url e --out");
  const requestedUrl = String(args.url);
  const outDir = path.resolve(String(args.out));
  const maxBytes = Math.max(100_000, Number(args["max-bytes"] || 12_000_000));
  const started = Date.now();
  let fetched;

  try {
    fetched = await fetchDocument(requestedUrl, maxBytes);
  } catch (error) {
    const result = { status: "blocked", requestedUrl, error: error.message, elapsedMs: Date.now() - started };
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "reference.http.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2;
    return;
  }

  const { response, bytes } = fetched;
  const finalUrl = response.url;
  const truncated = bytes.length > maxBytes;
  const body = (truncated ? bytes.subarray(0, maxBytes) : bytes).toString("utf8");
  const contentType = response.headers.get("content-type") || "";
  const parsed = parseSnapshot(body, finalUrl);
  const bodyMarkup = body.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || body;
  const bodyTextChars = bodyMarkup
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
  const structuralSignals = /<(?:main|section|article|h1|h2|h3|img|video|form)\b/i.test(bodyMarkup);
  const usefulDocument = /<html\b|<body\b/i.test(body) && body.length > 500 && (bodyTextChars > 120 || structuralSignals);
  const status = response.status >= 400 ? "blocked" : usefulDocument ? "document" : "shell";
  const result = {
    status,
    requestedUrl,
    finalUrl,
    httpStatus: response.status,
    contentType,
    bytes: body.length,
    bodyTextChars,
    structuralSignals,
    truncated,
    elapsedMs: Date.now() - started,
    ...parsed,
  };

  await mkdir(path.join(outDir, "assets"), { recursive: true });
  await writeFile(path.join(outDir, "reference-http.html"), body);
  await writeFile(path.join(outDir, "reference.http.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(outDir, "reference.assets.json"), `${JSON.stringify({ baseUrl: finalUrl, assets: parsed.assets }, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (status === "blocked") process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
