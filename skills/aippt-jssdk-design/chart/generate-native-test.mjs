#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createJssdkNativeRuntime } from "../../../../presentation/tools/lib/jssdk-native-runtime.mjs";
import {
  exportMopDirectory,
  importPptxFile,
} from "../../../../presentation/tools/lib/mop-converter-client.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../../../");
const OFFICEDEX_ROOT = path.join(REPO_ROOT, "officedex");
const PRESENTATION_ROOT = path.join(REPO_ROOT, "presentation");
const OUTPUT_ROOT = path.join(OFFICEDEX_ROOT, "build/aippt-chart-native-test");
const PROGRAM_PATH = path.join(SCRIPT_DIR, "native-test-deck.mjs");
const SLIDE_INDEXES = [1, 2, 3, 4, 5, 6, 7, 8];

function collect(value, predicate, out = []) {
  if (!value || typeof value !== "object") return out;
  if (predicate(value)) out.push(value);
  for (const child of Object.values(value)) collect(child, predicate, out);
  return out;
}

const runtime = await createJssdkNativeRuntime(PRESENTATION_ROOT);
try {
  await fs.rm(OUTPUT_ROOT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  const { build } = await import(pathToFileURL(PROGRAM_PATH).href);
  const generated = path.join(OUTPUT_ROOT, "generated.mop");
  const rendered = path.join(OUTPUT_ROOT, "rendered");
  const reimported = path.join(OUTPUT_ROOT, "reimported.mop");
  const pptx = path.join(OUTPUT_ROOT, "native-chart-test.pptx");
  await runtime.execute(build, null, generated);
  const renderResult = await runtime.render(
    generated,
    SLIDE_INDEXES,
    rendered,
    1920,
  );
  await exportMopDirectory(generated, pptx);
  await importPptxFile(pptx, reimported);
  const content = JSON.parse(
    await fs.readFile(path.join(generated, "content.json"), "utf8"),
  );
  const reopened = JSON.parse(
    await fs.readFile(path.join(reimported, "content.json"), "utf8"),
  );
  const chartSpaces = collect(content, (node) => node.type === "chartSpace");
  const reopenedCharts = collect(
    reopened,
    (node) => node.type === "chartSpace",
  );
  const kinds = collect(
    content,
    (node) => typeof node.chartKind === "string",
  ).map((node) => node.chartKind);
  const summary = {
    pptx: path.relative(OFFICEDEX_ROOT, pptx),
    slides: SLIDE_INDEXES.length,
    nativeCharts: chartSpaces.length,
    reimportedCharts: reopenedCharts.length,
    chartKinds: kinds,
    renderErrors: renderResult.errors.length,
    png: SLIDE_INDEXES.map(
      (index) =>
        `build/aippt-chart-native-test/rendered/slide-${String(index).padStart(4, "0")}.png`,
    ),
  };
  await fs.writeFile(
    path.join(OUTPUT_ROOT, "test-report.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
  if (renderResult.errors.length) {
    throw new Error(renderResult.errors.join("\n"));
  }
  if (reopenedCharts.length !== chartSpaces.length) {
    throw new Error(
      `reimport lost native charts: generated ${chartSpaces.length}, reimported ${reopenedCharts.length}`,
    );
  }
} finally {
  await runtime.close();
}
