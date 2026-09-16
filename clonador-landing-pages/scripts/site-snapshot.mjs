#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

const startUrl = new URL(required("--url"));
const outDir = path.resolve(required("--out"));
const maxPages = Math.max(1, Number(arg("--max-pages", "2000")) || 2000);
const concurrency = Math.max(1, Math.min(48, Number(arg("--concurrency", "32")) || 32));
const timeoutMs = Math.max(5_000, Number(arg("--timeout-ms", "20_000")) || 20_000);
const excludePattern = new RegExp(arg("--exclude-path", "^/admin(?:/|$)"), "i");
const siteHost = startUrl.host.toLowerCase();
const siteOrigin = startUrl.origin;
const refRoot = path.join(outDir, "reference-site");
const pageSourceRoot = path.join(refRoot, "pages");
const resourceSourceRoot = path.join(refRoot, "resources");
const cacheDir = path.resolve(arg("--cache-dir", path.join(refRoot, ".cache")));
const cacheEnabled = !process.argv.includes("--no-cache");
const cacheTtlMs = Math.max(0, Number(arg("--cache-ttl-ms", "86400000")) || 86_400_000);

await fs.mkdir(pageSourceRoot, { recursive: true });
await fs.mkdir(resourceSourceRoot, { recursive: true });
if (cacheEnabled) await fs.mkdir(cacheDir, { recursive: true });

function isSkippable(value) {
  const text = String(value || "").trim();
  return !text || text.startsWith("#") || /^(data|blob|javascript|mailto|tel|about):/i.test(text);
}

function stripTrackingParams(url) {
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|msclkid$|dclid$|_gl$|mc_cid$|mc_eid$)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
}

function canonicalUrl(raw, base) {
  if (isSkippable(raw)) return null;
  let url;
  try {
    url = new URL(String(raw).replaceAll("&amp;", "&"), base);
  } catch {
    return null;
  }
  if (!/^https?:$/i.test(url.protocol)) return null;
  url.hash = "";
  stripTrackingParams(url);
  if (url.pathname === "/index.php") url.pathname = "/";
  return url;
}

function keyFor(url) {
  const value = url instanceof URL ? url : new URL(url);
  return `${value.origin}${value.pathname || "/"}${value.search}`;
}

function isAllowedSiteUrl(url) {
  return url.host.toLowerCase() === siteHost && !excludePattern.test(url.pathname || "/");
}

function hash8(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function cleanName(value) {
  return String(value || "resource")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "resource";
}

function extensionFor(contentType) {
  const type = String(contentType || "").split(";", 1)[0].toLowerCase();
  return {
    "text/css": ".css",
    "text/javascript": ".js",
    "application/javascript": ".js",
    "application/json": ".json",
    "image/svg+xml": ".svg",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "font/woff2": ".woff2",
    "font/woff": ".woff",
    "application/pdf": ".pdf",
  }[type] || ".bin";
}

function resourceName(url, contentType) {
  const parsed = new URL(url);
  let basename = path.basename(decodeURIComponent(parsed.pathname)) || "resource";
  basename = cleanName(basename);
  if (!path.extname(basename)) basename += extensionFor(contentType);
  const ext = path.extname(basename);
  const stem = path.basename(basename, ext).slice(0, 70) || "resource";
  return `${stem}-${hash8(keyFor(parsed))}${ext}`;
}

function cachePaths(key) {
  const token = hash8(key);
  return {
    body: path.join(cacheDir, `${token}.body`),
    meta: path.join(cacheDir, `${token}.json`),
  };
}

async function readCache(key) {
  if (!cacheEnabled) return null;
  try {
    const paths = cachePaths(key);
    const metadata = JSON.parse(await fs.readFile(paths.meta, "utf8"));
    if (cacheTtlMs > 0 && Date.now() - Number(metadata.cachedAt || 0) > cacheTtlMs) return null;
    const bytes = await fs.readFile(paths.body);
    return { ...metadata, bytes, fromCache: true };
  } catch {
    return null;
  }
}

async function writeCache(key, payload) {
  if (!cacheEnabled || !payload.ok) return;
  const paths = cachePaths(key);
  const bodyTemp = `${paths.body}.part`;
  const metaTemp = `${paths.meta}.part`;
  await fs.writeFile(bodyTemp, payload.bytes);
  await fs.rename(bodyTemp, paths.body);
  await fs.writeFile(metaTemp, `${JSON.stringify({
    cachedAt: Date.now(),
    status: payload.status,
    ok: payload.ok,
    contentType: payload.contentType,
    finalUrl: payload.finalUrl,
  })}\n`);
  await fs.rename(metaTemp, paths.meta);
}

function pageName(url) {
  const parsed = new URL(url);
  if (parsed.pathname === "/" && !parsed.search) return "index.html";
  const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "") || "home";
  const pathPart = cleanName(pathname.replace(/\//g, "--").replace(/\.php$/i, ""));
  const queryPart = [...parsed.searchParams.entries()]
    .map(([key, value]) => `${cleanName(key)}-${cleanName(value)}`)
    .join("--");
  const slug = [pathPart, queryPart].filter(Boolean).join("--").slice(0, 120) || "page";
  return path.posix.join("pages", `${slug}-${hash8(keyFor(parsed))}.html`);
}

function kindFor(contentType, url) {
  const type = String(contentType || "").toLowerCase();
  if (/html|xhtml/.test(type) || /\.(?:php|html?|aspx?)(?:$|\?)/i.test(new URL(url).pathname)) return "html";
  if (/css/.test(type) || /\.css(?:$|\?)/i.test(new URL(url).pathname)) return "css";
  if (/javascript|ecmascript/.test(type) || /\.m?js(?:$|\?)/i.test(new URL(url).pathname)) return "script";
  if (/^image\//.test(type) || /\.(?:png|jpe?g|gif|webp|svg|ico|avif)(?:$|\?)/i.test(new URL(url).pathname)) return "image";
  if (/font|woff|opentype|truetype/.test(type)) return "font";
  if (/pdf|word|excel|zip|octet-stream/.test(type) || /\.(?:pdf|docx?|xlsx?|zip)(?:$|\?)/i.test(new URL(url).pathname)) return "document";
  return "other";
}

function extractReferences(text) {
  const values = [];
  const attr = /\b(?:href|src|poster|data-src|data-poster|action|formaction)\s*=\s*["']([^"']+)["']/gi;
  const srcset = /\b(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi;
  const cssUrl = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  for (const match of text.matchAll(attr)) values.push(match[1]);
  for (const match of text.matchAll(srcset)) {
    for (const candidate of match[1].split(",")) values.push(candidate.trim().split(/\s+/)[0]);
  }
  for (const match of text.matchAll(cssUrl)) values.push(match[1]);
  return values;
}

function titleOf(text) {
  return text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
}

const pageQueue = [];
const resourceQueue = [];
const queued = new Set([keyFor(startUrl)]);
const records = new Map();
const external = new Set();

function isLikelyResource(url) {
  const pathname = new URL(url).pathname;
  return /\.(?:avif|bmp|css|csv|docx?|gif|ico|jpe?g|js|json|mjs|mp3|mp4|pdf|png|svg|webm|webp|woff2?|xml|xlsx?|zip)(?:$|\/)/i.test(pathname);
}

function enqueueItem(item) {
  if (isLikelyResource(item.url)) resourceQueue.push(item);
  else pageQueue.push(item);
}

enqueueItem({ url: startUrl.href, discoveredFrom: null });

function nextItem() {
  return pageQueue.shift() || resourceQueue.shift() || null;
}

function enqueue(raw, baseUrl, from) {
  const url = canonicalUrl(raw, baseUrl);
  if (!url) return;
  if (!isAllowedSiteUrl(url)) {
    if (url.host.toLowerCase() !== siteHost) external.add(url.href);
    return;
  }
  const key = keyFor(url);
  if (queued.has(key) || records.has(key) || pageQueue.length + resourceQueue.length >= maxPages) return;
  queued.add(key);
  enqueueItem({ url: url.href, discoveredFrom: from });
}

async function fetchOne(item) {
  const requestedUrl = new URL(item.url);
  const key = keyFor(requestedUrl);
  const record = {
    key,
    url: requestedUrl.href,
    discoveredFrom: item.discoveredFrom,
    status: 0,
    ok: false,
    kind: "other",
  };
  try {
    let payload = await readCache(key);
    if (!payload) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(requestedUrl.href, {
          redirect: "follow",
          signal: controller.signal,
          headers: { "user-agent": "Codex site snapshot/1.0" },
        });
      } finally {
        clearTimeout(timer);
      }
      const contentType = response.headers.get("content-type") || "";
      const bytes = Buffer.from(await response.arrayBuffer());
      payload = {
        status: response.status,
        ok: response.ok,
        contentType,
        finalUrl: response.url || requestedUrl.href,
        bytes,
      };
      await writeCache(key, payload);
    }
    const contentType = payload.contentType || "";
    const bytes = payload.bytes;
    const finalUrl = canonicalUrl(payload.finalUrl || requestedUrl.href, requestedUrl) || requestedUrl;
    record.finalUrl = finalUrl.href;
    record.status = payload.status;
    record.ok = payload.ok;
    record.contentType = contentType;
    record.bytes = bytes.length;
    record.fromCache = Boolean(payload.fromCache);
    record.kind = kindFor(contentType, finalUrl.href);
    if (!payload.ok) return record;

    if (record.kind === "html") {
      record.localSource = path.posix.join("reference-site", "pages", `${hash8(key)}.html`);
      await fs.writeFile(path.join(outDir, record.localSource), bytes);
      const text = bytes.toString("utf8");
      record.title = titleOf(text);
      for (const reference of extractReferences(text)) enqueue(reference, finalUrl.href, key);
    } else {
      const name = resourceName(finalUrl.href, contentType);
      record.name = name;
      record.localSource = path.posix.join("reference-site", "resources", name);
      await fs.writeFile(path.join(outDir, record.localSource), bytes);
      if (record.kind === "css") {
        for (const reference of extractReferences(bytes.toString("utf8"))) enqueue(reference, finalUrl.href, key);
      }
    }
  } catch (error) {
    record.error = error?.message || String(error);
  }
  return record;
}

async function runPool() {
  while (records.size < maxPages) {
    const batch = [];
    while (batch.length < concurrency && records.size + batch.length < maxPages) {
      const item = nextItem();
      if (!item) break;
      const key = keyFor(new URL(item.url));
      if (records.has(key)) continue;
      batch.push(fetchOne(item).then((record) => {
        records.set(key, record);
      }));
    }
    if (!batch.length) break;
    await Promise.all(batch);
  }
}

const startedAt = Date.now();
await runPool();

const pages = [];
const resources = [];
for (const record of records.values()) {
  if (!record.ok) continue;
  if (record.kind === "html") {
    pages.push({
      ...record,
      outputPath: pageName(record.finalUrl || record.url),
    });
  } else {
    resources.push({
      ...record,
      outputPath: path.posix.join("assets", record.name),
    });
  }
}
pages.sort((a, b) => a.outputPath.localeCompare(b.outputPath));
resources.sort((a, b) => a.outputPath.localeCompare(b.outputPath));

const manifest = {
  generatedAt: new Date().toISOString(),
  requestedUrl: startUrl.href,
  origin: siteOrigin,
  host: siteHost,
  maxPages,
  concurrency,
  timeoutMs,
  cache: {
    enabled: cacheEnabled,
    ttlMs: cacheTtlMs,
    dir: cacheDir,
    hits: [...records.values()].filter((record) => record.fromCache).length,
  },
  durationMs: Date.now() - startedAt,
  crawled: records.size,
  queued: queued.size,
  pages,
  resources,
  external: [...external].sort(),
  errors: [...records.values()].filter((record) => record.error || (record.status && !record.ok)),
};

await fs.writeFile(path.join(outDir, "reference.site.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  status: "ok",
  pages: pages.length,
  resources: resources.length,
  crawled: records.size,
  queued: queued.size,
  external: external.size,
  errors: manifest.errors.length,
  cacheHits: manifest.cache.hits,
  durationMs: manifest.durationMs,
  manifest: path.join(outDir, "reference.site.json"),
}, null, 2));
