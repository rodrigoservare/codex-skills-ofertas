#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

function usage(message) {
  if (message) console.error(`Erro: ${message}\n`);
  console.error(
    "Uso: node baixar-assets.mjs --manifest arquivo.json --out pasta [--concurrency 12] [--force]"
  );
  console.error(
    "Ou:  node baixar-assets.mjs --html index.html --base http://127.0.0.1:4175/ --out assets"
  );
  process.exit(1);
}

function argsFrom(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (key === "force") args.force = true;
    else args[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

function shouldSkip(value) {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed.startsWith("#") ||
    /^(data|blob|javascript|mailto|tel|about):/i.test(trimmed)
  );
}

function resolveUrl(value, base) {
  if (shouldSkip(value)) return null;
  try {
    const url = new URL(value, base);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function canonicalKey(rawUrl) {
  const url = new URL(rawUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|msclkid$|dclid$|_gl$|mc_cid$|mc_eid$)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.href;
}

function extractHtmlAssets(html, base) {
  const values = new Set();
  const attr = /\b(?:src|poster|data-src|data-poster)\s*=\s*["']([^"']+)["']/gi;
  const link = /<link\b([^>]*?)>/gi;
  const srcset = /\b(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi;
  const cssUrl = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

  for (const match of html.matchAll(attr)) values.add(match[1]);
  for (const match of html.matchAll(link)) {
    const tag = match[1];
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const as = tag.match(/\bas\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    if (href && /(?:stylesheet|icon|preload|prefetch|modulepreload|mask-icon)/i.test(`${rel} ${as}`)) {
      values.add(href);
    }
  }
  for (const match of html.matchAll(srcset)) {
    for (const candidate of match[1].split(",")) values.add(candidate.trim().split(/\s+/)[0]);
  }
  for (const match of html.matchAll(cssUrl)) values.add(match[1]);

  return [...values]
    .map((value) => resolveUrl(value, base))
    .filter(Boolean)
    .map((url) => ({ url }));
}

function extractCssAssets(css, base) {
  const values = new Set();
  const cssUrl = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  for (const match of css.matchAll(cssUrl)) values.add(match[1]);
  return [...values]
    .map((value) => resolveUrl(value, base))
    .filter(Boolean)
    .map((url) => ({ url, discoveredFrom: base }));
}

async function discoverCssAssets(entries) {
  const cssEntries = entries.filter((entry) => /\.css(?:[?#]|$)/i.test(entry.url));
  const discovered = [];
  await Promise.all(
    cssEntries.map(async (entry) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(entry.url, { redirect: "follow", signal: controller.signal });
        if (response.ok) discovered.push(...extractCssAssets(await response.text(), response.url));
      } catch {
        // O download principal registrará a falha se o CSS também não estiver acessível.
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return discovered;
}

async function readManifest(args) {
  if (args.manifest) {
    const raw = JSON.parse(await readFile(path.resolve(String(args.manifest)), "utf8"));
    const entries = Array.isArray(raw) ? raw : raw.assets || [];
    return entries
      .map((entry) => (typeof entry === "string" ? { url: entry } : entry))
      .filter((entry) => entry && entry.url)
      .map((entry) => ({ ...entry, url: String(entry.url) }));
  }

  if (args.html && args.base) {
    const html = await readFile(path.resolve(String(args.html)), "utf8");
    return extractHtmlAssets(html, String(args.base));
  }

  usage("informe --manifest ou use --html junto de --base");
}

function hash8(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function safeName(entry, index, contentType) {
  if (entry.name) return String(entry.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const url = new URL(entry.url);
  let base = path.basename(decodeURIComponent(url.pathname)) || `asset-${index + 1}`;
  base = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!path.extname(base)) {
    const extension = String(contentType || "").split("/")[1]?.split(";")[0];
    if (extension && /^[a-z0-9]+$/i.test(extension)) base += `.${extension}`;
  }
  const ext = path.extname(base);
  const stem = path.basename(base, ext).slice(0, 80) || `asset-${index + 1}`;
  return `${stem}-${hash8(entry.url)}${ext}`;
}

async function download(entry, index, outDir, force) {
  const result = { ...entry, index, status: "pending" };
  let response;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      response = await fetch(entry.url, { redirect: "follow", signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      break;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  if (!response) {
    result.status = "error";
    result.error = lastError?.message || "falha de download";
    return result;
  }

  const contentType = response.headers.get("content-type") || "";
  const name = safeName(entry, index, contentType);
  const destination = path.join(outDir, name);
  result.name = name;
  result.contentType = contentType;
  result.finalUrl = response.url;

  if (!force) {
    try {
      const existing = await stat(destination);
      if (existing.size > 0) {
        result.status = "reused";
        result.bytes = existing.size;
        result.localPath = name;
        return result;
      }
    } catch {
      // O arquivo ainda não existe.
    }
  }

  const body = Buffer.from(await response.arrayBuffer());
  const temporary = `${destination}.part`;
  await writeFile(temporary, body);
  await rename(temporary, destination);
  result.status = "downloaded";
  result.bytes = body.length;
  result.localPath = name;
  return result;
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  if (!args.out) usage("informe --out");

  const outDir = path.resolve(String(args.out));
  const concurrency = Math.max(1, Math.min(24, Number(args.concurrency || 12)));
  const rawEntries = await readManifest(args);
  const initial = [];
  for (const entry of rawEntries) {
    const url = resolveUrl(entry.url, args.base || undefined);
    if (url) initial.push({ ...entry, url });
  }
  const allEntries = [...initial, ...(await discoverCssAssets(initial))];
  const unique = new Map();
  for (const entry of allEntries) {
    const url = resolveUrl(entry.url, args.base || undefined);
    const key = url && canonicalKey(url);
    if (url && key && !unique.has(key)) unique.set(key, { ...entry, url });
  }
  const entries = [...unique.values()];
  await mkdir(outDir, { recursive: true });

  let cursor = 0;
  const results = [];
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor++;
      results[index] = await download(entries[index], index, outDir, Boolean(args.force));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length || 1) }, worker));

  const manifest = {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    downloaded: results.filter((item) => item.status === "downloaded").length,
    reused: results.filter((item) => item.status === "reused").length,
    errors: results.filter((item) => item.status === "error").length,
    assets: results,
  };
  await writeFile(path.join(outDir, "asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
  if (manifest.errors > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
