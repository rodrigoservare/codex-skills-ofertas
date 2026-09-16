#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

const manifestPath = path.resolve(required("--manifest"));
const outDir = path.resolve(required("--out"));
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const rootDir = path.dirname(manifestPath);
const concurrency = Math.max(1, Math.min(48, Number(arg("--concurrency", "32")) || 32));
const force = process.argv.includes("--force");
const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
const pageByKey = new Map(pages.map((page) => [page.key, page.outputPath]));
const resourceByKey = new Map(resources.map((resource) => [resource.key, resource.outputPath]));
const missingSourceKeys = new Set((manifest.errors || []).map((error) => error.key).filter(Boolean));
const siteHost = String(manifest.host || new URL(manifest.origin).host).toLowerCase();
const transplantVersion = 2;
const sourceManifestHash = crypto.createHash("sha1")
  .update(await fs.readFile(manifestPath))
  .digest("hex");

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function mapLimit(items, limit, task) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}

const existingManifestPath = path.join(outDir, "site-manifest.json");
if (!force && await exists(existingManifestPath)) {
  try {
    const existing = JSON.parse(await fs.readFile(existingManifestPath, "utf8"));
    if (
      existing.transplantVersion === transplantVersion &&
      existing.sourceManifestHash === sourceManifestHash &&
      existing.pages?.length === pages.length &&
      existing.resources?.length === resources.length &&
      await exists(path.join(outDir, "index.html"))
    ) {
      console.log(JSON.stringify({
        status: "reused",
        pages: pages.length,
        resources: resources.length,
        out: outDir,
      }, null, 2));
      process.exit(0);
    }
  } catch {
    // O material existente será reconstruído.
  }
}

function isSkippable(value) {
  const text = String(value || "").trim();
  return !text || text.startsWith("#") || /^(data|blob|javascript|mailto|tel|about):/i.test(text);
}

function normalizeKey(raw, baseUrl) {
  if (isSkippable(raw)) return null;
  try {
    const url = new URL(String(raw).replaceAll("&amp;", "&"), baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|msclkid$|dclid$|_gl$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname === "/index.php") url.pathname = "/";
    return `${url.origin}${url.pathname || "/"}${url.search}`;
  } catch {
    return null;
  }
}

function relativeFrom(currentOutput, targetOutput) {
  const current = currentOutput.split("/");
  current.pop();
  let relative = path.posix.relative(current.join("/") || ".", targetOutput);
  if (!relative) relative = path.posix.basename(targetOutput);
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function mappedReference(raw, pageUrl, currentOutput) {
  if (isSkippable(raw)) return raw;
  let parsed;
  try {
    parsed = new URL(String(raw).replaceAll("&amp;", "&"), pageUrl);
  } catch {
    return raw;
  }
  if (!/^https?:$/i.test(parsed.protocol) || parsed.host.toLowerCase() !== siteHost) return raw;
  const fragment = parsed.hash || "";
  const key = normalizeKey(raw, pageUrl);
  const target = pageByKey.get(key) || resourceByKey.get(key);
  if (!target) {
    if (/^\/admin(?:\/|$)/i.test(parsed.pathname)) return `${parsed.href}${fragment}`;
    return raw;
  }
  return `${relativeFrom(currentOutput, target)}${fragment}`;
}

function rewriteSrcset(value, pageUrl, currentOutput) {
  return String(value)
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (parts[0]) parts[0] = mappedReference(parts[0], pageUrl, currentOutput);
      return parts.join(" ");
    })
    .join(", ");
}

function rewriteCssText(text, baseUrl, currentOutput, missingKeys = new Set()) {
  return String(text).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, value) => {
    const key = normalizeKey(value, baseUrl);
    const hasMapping = pageByKey.has(key) || resourceByKey.has(key);
    const rewritten = !hasMapping && missingKeys.has(key)
      ? "data:application/octet-stream;base64,"
      : mappedReference(value, baseUrl, currentOutput);
    return `url(${quote}${rewritten}${quote})`;
  });
}

function isTrackingScript(attrs, body) {
  const source = `${attrs}\n${body}`;
  return /googletagmanager|google-analytics|google\.com\/recaptcha|connect\.facebook\.net|facebook\.net|gtag\s*\(|fbq\s*\(|dataLayer|clarity\s*\(/i.test(source);
}

function rewriteHtml(text, page, currentOutput) {
  const pageUrl = page.finalUrl || page.url;
  let html = String(text).replace(/<base\b[^>]*>/gi, "");
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, body) => {
    if (isTrackingScript(attrs, body)) return "";
    const rewrittenAttrs = attrs.replace(/(\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (full, prefix, quote, value) => `${prefix}${quote}${mappedReference(value, pageUrl, currentOutput)}${quote}`);
    return `<script${rewrittenAttrs}>${body}</script>`;
  });
  html = html.replace(/<script\b([^>]*)\/>/gi, (match, attrs) => (isTrackingScript(attrs, "") ? "" : match));
  html = html.replace(/<([a-z0-9:-]+)\b([^>]*?)>/gi, (match, tag, attrs) => {
    const rewrittenAttrs = attrs
      .replace(/(\b(?:href|src|poster|data-src|data-poster|action|formaction)\s*=\s*)(["'])([^"']+)\2/gi, (full, prefix, quote, value) => `${prefix}${quote}${mappedReference(value, pageUrl, currentOutput)}${quote}`)
      .replace(/(\b(?:srcset|data-srcset)\s*=\s*)(["'])([^"']+)\2/gi, (full, prefix, quote, value) => `${prefix}${quote}${rewriteSrcset(value, pageUrl, currentOutput)}${quote}`)
      .replace(/(\bstyle\s*=\s*)(["'])([^"']*)\2/gi, (full, prefix, quote, value) => `${prefix}${quote}${rewriteCssText(value, pageUrl, currentOutput)}${quote}`);
    return `<${tag}${rewrittenAttrs}>`;
  });
  return html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (match, open, body, close) => `${open}${rewriteCssText(body, pageUrl, currentOutput)}${close}`);
}

await fs.mkdir(path.join(outDir, "assets"), { recursive: true });
await fs.mkdir(path.join(outDir, "pages"), { recursive: true });

const startedAt = Date.now();
await mapLimit(resources, concurrency, async (resource) => {
  const source = path.join(rootDir, resource.localSource);
  const target = path.join(outDir, resource.outputPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (resource.kind === "css") {
    const body = await fs.readFile(source);
    const rewritten = rewriteCssText(body.toString("utf8"), resource.finalUrl || resource.url, resource.outputPath, missingSourceKeys);
    await fs.writeFile(target, rewritten);
  } else {
    try {
      await fs.copyFile(source, target, fsConstants.COPYFILE_FICLONE || 0);
    } catch {
      await fs.copyFile(source, target);
    }
  }
});

await mapLimit(pages, concurrency, async (page) => {
  const source = path.join(rootDir, page.localSource);
  const target = path.join(outDir, page.outputPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const html = await fs.readFile(source, "utf8");
  await fs.writeFile(target, rewriteHtml(html, page, page.outputPath));
});

await fs.writeFile(path.join(outDir, "site-manifest.json"), `${JSON.stringify({
  transplantVersion,
  sourceManifestHash,
  generatedAt: new Date().toISOString(),
  source: manifest.requestedUrl,
  pages: pages.map((page) => ({ url: page.finalUrl || page.url, file: page.outputPath, title: page.title || "" })),
  resources: resources.map((resource) => ({ url: resource.finalUrl || resource.url, file: resource.outputPath, kind: resource.kind })),
  external: manifest.external || [],
}, null, 2)}\n`);

console.log(JSON.stringify({
  status: "ok",
  pages: pages.length,
  resources: resources.length,
  concurrency,
  durationMs: Date.now() - startedAt,
  out: outDir,
}, null, 2));
