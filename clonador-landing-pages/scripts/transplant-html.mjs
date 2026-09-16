#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

const htmlPath = required("--html");
const manifestPath = required("--manifest");
const outPath = required("--out");
const appPath = arg("--app", path.join(path.dirname(outPath), "app.js"));

const [htmlSource, manifestSource] = await Promise.all([
  fs.readFile(htmlPath, "utf8"),
  fs.readFile(manifestPath, "utf8"),
]);

const manifest = JSON.parse(manifestSource);
const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
let html = htmlSource;
let replaced = 0;

const replacements = assets
  .filter((asset) => asset?.status === "downloaded" && asset?.url && (asset.localPath || asset.name))
  .map((asset) => ({
    source: String(asset.url),
    local: `assets/${asset.localPath || asset.name}`,
  }))
  .sort((a, b) => b.source.length - a.source.length);

for (const { source, local } of replacements) {
  const variants = [source, source.replaceAll("&", "&amp;")];
  try {
    const pathname = new URL(source).pathname;
    variants.push(pathname, pathname.replace(/^\/+/, ""));
  } catch {
    // Keep the absolute-URL replacements when a manifest entry is not a URL.
  }
  for (const variant of variants) {
    if (!html.includes(variant)) continue;
    html = html.split(variant).join(local);
    replaced += 1;
  }
}

html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
html = html.replace(/<script\b[^>]*\/>/gi, "");
html = html.replace(/<div\s+id=["']codex-browser-sidebar-comments-root["'][^>]*>[\s\S]*?<\/div>/gi, "");

const appScript = `<script src="${path.basename(appPath)}" defer></script>`;
if (!html.includes(appScript)) {
  html = /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${appScript}</body>`)
    : `${html}\n${appScript}\n`;
}

const app = `(() => {
  const titles = document.querySelectorAll(".atomicat-title, .a-ac-t");
  const setState = (title, open) => {
    const item = title.closest(".a-ac-i");
    if (!item) return;
    const content = item.querySelector(".atomicat-content");
    if (!content) return;
    title.classList.toggle("a-ac-t-active", open);
    content.classList.toggle("a-c-inactive", !open);
    content.style.display = open ? "" : "none";
  };
  titles.forEach((title) => {
    const content = title.closest(".a-ac-i")?.querySelector(".atomicat-content");
    if (content && (content.classList.contains("a-c-inactive") || content.style.display === "none")) {
      setState(title, false);
    }
    title.addEventListener("click", () => {
      const content = title.closest(".a-ac-i")?.querySelector(".atomicat-content");
      const open = !!content && !content.classList.contains("a-c-inactive") && content.style.display !== "none";
      setState(title, !open);
    });
  });
})();
`;

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, html);
await fs.writeFile(appPath, app);

console.log(JSON.stringify({
  html: outPath,
  app: appPath,
  assetsConsidered: replacements.length,
  assetVariantsReplaced: replaced,
  scriptsRemoved: true,
}, null, 2));
