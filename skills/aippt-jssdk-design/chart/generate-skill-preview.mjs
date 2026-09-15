#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createJssdkNativeRuntime } from "../../../../presentation/tools/lib/jssdk-native-runtime.mjs";
import { exportMopDirectory } from "../../../../presentation/tools/lib/mop-converter-client.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../../../");
const OFFICEDEX_ROOT = path.join(REPO_ROOT, "officedex");
const PRESENTATION_ROOT = path.join(REPO_ROOT, "presentation");
const OUTPUT_ROOT = path.join(OFFICEDEX_ROOT, "build/aippt-chart-skill-preview");
const PROGRAM_PATH = path.join(SCRIPT_DIR, "preview-deck.mjs");

const runtime = await createJssdkNativeRuntime(PRESENTATION_ROOT);
try {
  await fs.rm(OUTPUT_ROOT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  const { build } = await import(pathToFileURL(PROGRAM_PATH).href);
  const generated = path.join(OUTPUT_ROOT, "generated.mop");
  const rendered = path.join(OUTPUT_ROOT, "rendered");
  const pptx = path.join(OUTPUT_ROOT, "chart-skill-preview.pptx");
  await runtime.execute(build, null, generated);
  const renderResult = await runtime.render(
    generated,
    [1, 2, 3, 4],
    rendered,
    1920,
  );
  await exportMopDirectory(generated, pptx);
  const summary = {
    pptx: path.relative(OFFICEDEX_ROOT, pptx),
    slides: 4,
    renderErrors: renderResult.errors.length,
    png: [1, 2, 3, 4].map(
      (index) =>
        `build/aippt-chart-skill-preview/rendered/slide-${String(index).padStart(4, "0")}.png`,
    ),
  };
  await fs.writeFile(
    path.join(OUTPUT_ROOT, "preview.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
  if (renderResult.errors.length) {
    throw new Error(renderResult.errors.join("\n"));
  }
} finally {
  await runtime.close();
}
