#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

import { createJssdkNativeRuntime } from "../../../../presentation/tools/lib/jssdk-native-runtime.mjs";
import {
  exportMopDirectory,
  importPptxFile,
} from "../../../../presentation/tools/lib/mop-converter-client.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(SCRIPT_DIR, "..");
const OFFICEDEX_ROOT = path.resolve(SKILL_ROOT, "../..");
const REPO_ROOT = path.resolve(OFFICEDEX_ROOT, "..");
const PRESENTATION_ROOT = path.join(REPO_ROOT, "presentation");
const DECK_ROOT = path.join(SKILL_ROOT, "examples/tiktok-ops-20-free");
const OUTPUT_ROOT = path.join(OFFICEDEX_ROOT, "build/aippt-tiktok-ops-20-free");
const SLIDE_COUNT = 20;
const SLIDE_INDEXES = Array.from({ length: SLIDE_COUNT }, (_unused, index) => index + 1);

function collect(value, predicate, out = []) {
  if (!value || typeof value !== "object") return out;
  if (predicate(value)) out.push(value);
  for (const child of Object.values(value)) collect(child, predicate, out);
  return out;
}

function relativize(value) {
  if (typeof value === "string") {
    if (value.startsWith(SKILL_ROOT)) {
      return path.relative(SKILL_ROOT, value);
    }
    if (value.startsWith(OFFICEDEX_ROOT)) {
      return path.relative(OFFICEDEX_ROOT, value);
    }
  }
  if (Array.isArray(value)) return value.map(relativize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, relativize(child)]),
    );
  }
  return value;
}

await fs.rm(OUTPUT_ROOT, { recursive: true, force: true });
await fs.mkdir(OUTPUT_ROOT, { recursive: true });

const planBytes = execFileSync(
  process.execPath,
  [
    path.join(SCRIPT_DIR, "select-family.mjs"),
    `@${path.join(DECK_ROOT, "briefs.json")}`,
  ],
  { encoding: "utf8" },
);
const plan = JSON.parse(planBytes);
if (plan.status !== "selected") {
  throw new Error(`Skill select-family blocked: ${plan.status}`);
}
const relativePlan = {
  schema_version: 2,
  contract: "jssdk-progressive/v2",
  generation_mode: "free_composition",
  skill: "aippt-jssdk-design",
  ...relativize(plan),
};
await fs.writeFile(
  path.join(OUTPUT_ROOT, "generation-plan.json"),
  JSON.stringify(relativePlan, null, 2) + "\n",
);

const runtime = await createJssdkNativeRuntime(PRESENTATION_ROOT);
try {
  const generated = path.join(OUTPUT_ROOT, "generated.mop");
  const rendered = path.join(OUTPUT_ROOT, "rendered");
  const reimported = path.join(OUTPUT_ROOT, "reimported.mop");
  const pptx = path.join(OUTPUT_ROOT, "TikTok运营实践-自由构图-20页.pptx");
  const { build } = await import(
    pathToFileURL(path.join(DECK_ROOT, "generated.mjs")).href
  );
  await runtime.execute(build, null, generated);
  const renderResult = await runtime.render(
    generated,
    SLIDE_INDEXES,
    rendered,
    1600,
  );
  await exportMopDirectory(generated, pptx);
  await importPptxFile(pptx, reimported);
  const content = JSON.parse(
    await fs.readFile(path.join(generated, "content.json"), "utf8"),
  );
  const reopened = JSON.parse(
    await fs.readFile(path.join(reimported, "content.json"), "utf8"),
  );
  const charts = collect(content, (node) => node.type === "chartSpace");
  const kinds = collect(
    content,
    (node) => typeof node.chartKind === "string",
  ).map((node) => node.chartKind);
  const reimportedCharts = collect(
    reopened,
    (node) => node.type === "chartSpace",
  );
  const summary = {
    mode: "free_composition",
    skill: "aippt-jssdk-design",
    contract: "jssdk-progressive/v2",
    host: "MopEditorPowerPointHost",
    pptx: path.relative(OFFICEDEX_ROOT, pptx),
    slides: SLIDE_COUNT,
    unique_layouts: plan.diversity?.unique_layouts ?? null,
    nativeCharts: charts.length,
    reimportedCharts: reimportedCharts.length,
    chartKinds: kinds,
    renderErrors: renderResult.errors.length,
  };
  await fs.writeFile(
    path.join(OUTPUT_ROOT, "jssdk-evidence.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
  if (renderResult.errors.length) {
    throw new Error(renderResult.errors.join("\n"));
  }
  if (charts.length < 4) {
    throw new Error(`expected at least 4 native charts, got ${charts.length}`);
  }
  if (reimportedCharts.length !== charts.length) {
    throw new Error(
      `reimport lost charts: ${charts.length} -> ${reimportedCharts.length}`,
    );
  }
} finally {
  await runtime.close();
}
