#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "wails.json",
  "package.json",
  "scripts/build-frontend-with-presentation.sh",
  "scripts/build-frontend-desktop.sh",
  "scripts/build-embedded-presentation.sh",
  "scripts/build-local-app.sh",
  "scripts/build-local-latest.sh",
  "scripts/stage-presentation-runtime.mjs",
  "presentation-component/vite.config.ts",
  "main.go",
  "app.go",
];

const forbidden = [
  "../pptx",
  'filepath.Join(cwd, "pptx")',
  'filepath.Join(repoRoot, "pptx")',
];

const violations = [];
for (const relative of files) {
  const content = await readFile(path.join(root, relative), "utf8");
  for (const needle of forbidden) {
    if (content.includes(needle)) violations.push(`${relative}: ${needle}`);
  }
}

if (violations.length) {
  console.error("legacy PPTX source references found:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("presentation source guard passed: fegit presentation is the only default PPT editor source");
