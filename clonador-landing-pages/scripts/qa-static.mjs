#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

function isExternal(value) {
  return /^(?:https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i.test(value.trim());
}

function references(text) {
  const found = new Set();
  const add = (value) => {
    const clean = String(value || "").trim();
    if (!isExternal(clean)) found.add(clean.split("?")[0].split("#")[0]);
  };
  for (const match of text.matchAll(/\b(?:src|href|poster|data-src|data-poster)\s*=\s*["']([^"']+)["']/gi)) {
    add(match[1]);
  }
  for (const match of text.matchAll(/\b(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const item of match[1].split(",")) add(item.trim().split(/\s+/)[0]);
  }
  for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    add(match[1]);
  }
  return [...found].filter(Boolean);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(root, predicate) {
  const files = [];
  if (!(await exists(root))) return files;
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (!predicate || predicate(full)) files.push(full);
    }
  }
  await walk(root);
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) throw new Error("Uso: node qa-static.mjs --project /caminho/do/projeto");

  const project = path.resolve(String(args.project));
  const errors = [];
  const warnings = [];
  const checked = [];
  const indexPath = path.join(project, "index.html");

  if (!(await exists(indexPath))) errors.push("index.html ausente");
  if (!(await exists(path.join(project, "assets")))) warnings.push("pasta assets/ ausente");

  if (await exists(indexPath)) {
    const html = await readFile(indexPath, "utf8");
    checked.push("index.html");
    if (!/^\s*<!doctype html>/i.test(html)) warnings.push("DOCTYPE HTML ausente");
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) warnings.push("meta viewport ausente");

    for (const reference of references(html)) {
      const file = path.resolve(project, reference.replace(/^\/+/, ""));
      if (!(await exists(file))) errors.push(`referência ausente: ${reference}`);
    }
  }

  for (const name of ["styles.css", "app.js"]) {
    const file = path.join(project, name);
    if (!(await exists(file))) continue;
    const content = await readFile(file, "utf8");
    checked.push(name);
    for (const reference of references(content)) {
      const target = path.resolve(project, reference.replace(/^\/+/, ""));
      if (!(await exists(target))) errors.push(`referência ausente em ${name}: ${reference}`);
    }
    if (name === "app.js") {
      const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      if (check.status !== 0) errors.push(`sintaxe inválida em app.js: ${(check.stderr || check.stdout).trim()}`);
    }
  }

  const pageFiles = (await collectFiles(path.join(project, "pages"), (file) => /\.html?$/i.test(file))).sort();
  for (const file of pageFiles) {
    const html = await readFile(file, "utf8");
    checked.push(path.relative(project, file));
    for (const reference of references(html)) {
      const target = path.resolve(path.dirname(file), reference.replace(/^\/+/, ""));
      if (!(await exists(target))) errors.push(`referência ausente em ${path.relative(project, file)}: ${reference}`);
    }
  }

  const cssFiles = (await collectFiles(path.join(project, "assets"), (file) => /\.css$/i.test(file))).sort();
  for (const file of cssFiles) {
    const css = await readFile(file, "utf8");
    checked.push(path.relative(project, file));
    for (const reference of references(css)) {
      const target = path.resolve(path.dirname(file), reference.replace(/^\/+/, ""));
      if (!(await exists(target))) errors.push(`referência ausente em ${path.relative(project, file)}: ${reference}`);
    }
  }

  const scriptFiles = (await collectFiles(path.join(project, "assets"), (file) => /\.m?js$/i.test(file))).sort();
  for (const file of scriptFiles) {
    const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (check.status !== 0) errors.push(`sintaxe inválida em ${path.relative(project, file)}: ${(check.stderr || check.stdout).trim()}`);
  }

  const result = {
    status: errors.length ? "failed" : "passed",
    project,
    checked,
    errors,
    warnings,
    note: "Este gate valida integridade local; geometria e comportamento ainda exigem comparação no navegador.",
  };
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
