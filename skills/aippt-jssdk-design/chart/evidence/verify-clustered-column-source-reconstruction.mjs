#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createJssdkNativeRuntime } from "../../../../../presentation/tools/lib/jssdk-native-runtime.mjs";
import {
  exportMopDirectory,
  importPptxFile,
} from "../../../../../presentation/tools/lib/mop-converter-client.mjs";
import { comparePngBuffers } from "../../../../../presentation/quality/visual/mop-parity-lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../../../../");
const OFFICEDEX_ROOT = path.join(REPO_ROOT, "officedex");
const PRESENTATION_ROOT = path.join(REPO_ROOT, "presentation");
const PROGRAM_RELATIVE =
  "skills/aippt-jssdk-design/chart/evidence/clustered-column-source-reconstruction.mjs";
const PROGRAM_PATH = path.join(OFFICEDEX_ROOT, PROGRAM_RELATIVE);
const REFERENCE_PATH = path.join(
  REPO_ROOT,
  "sampleall/chart/基础属性/簇状柱形图/簇状柱形图/幻灯片20.png",
);
const OUTPUT_BASE = path.join(
  OFFICEDEX_ROOT,
  "build/aippt-chart-source-evidence/clustered-column-source-reconstruction",
);
const RUN_ID = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const OUTPUT_ROOT = path.join(OUTPUT_BASE, RUN_ID);
const GENERATED = path.join(OUTPUT_ROOT, "generated.mop");
const RENDERED = path.join(OUTPUT_ROOT, "rendered");
const REIMPORTED = path.join(OUTPUT_ROOT, "reimported.mop");
const REIMPORTED_RENDERED = path.join(OUTPUT_ROOT, "reimported-rendered");
const PPTX = path.join(OUTPUT_ROOT, "generated.pptx");
const VERIFICATION = path.join(
  OFFICEDEX_ROOT,
  "skills/aippt-jssdk-design/chart/evidence/clustered-column-source-reconstruction.verification.json",
);
const FACTS = path.join(
  OFFICEDEX_ROOT,
  "skills/aippt-jssdk-design/chart/evidence/clustered-column-source-reconstruction.json",
);

function collect(value, predicate, out = []) {
  if (!value || typeof value !== "object") return out;
  if (predicate(value)) out.push(value);
  for (const child of Object.values(value)) collect(child, predicate, out);
  return out;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

const sourceBytes = await fs.readFile(REFERENCE_PATH);
const runtime = await createJssdkNativeRuntime(PRESENTATION_ROOT);

try {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  const { build } = await import(pathToFileURL(PROGRAM_PATH).href);
  const model = await runtime.execute(build, null, GENERATED);
  const renderResult = await runtime.render(GENERATED, [1], RENDERED, 1920);

  await exportMopDirectory(GENERATED, PPTX);
  await importPptxFile(PPTX, REIMPORTED);
  const reimportedRenderResult = await runtime.render(
    REIMPORTED,
    [1],
    REIMPORTED_RENDERED,
    1920,
  );

  const generatedBytes = await fs.readFile(
    path.join(RENDERED, "slide-0001.png"),
  );
  const reimportedBytes = await fs.readFile(
    path.join(REIMPORTED_RENDERED, "slide-0001.png"),
  );
  const originalComparison = comparePngBuffers(sourceBytes, generatedBytes, 8);
  const exportComparison = comparePngBuffers(
    generatedBytes,
    reimportedBytes,
    8,
  );
  const content = await readJson(path.join(GENERATED, "content.json"));
  const reopened = await readJson(path.join(REIMPORTED, "content.json"));
  const nativeNodes = collect(content, (node) => typeof node.type === "string");
  const chartSpaces = collect(content, (node) => node.type === "chartSpace");
  const reopenedChartSpaces = collect(
    reopened,
    (node) => node.type === "chartSpace",
  );
  const chartKinds = collect(
    content,
    (node) => typeof node.chartKind === "string",
  ).map((node) => node.chartKind);
  const textLayout = renderResult.outputs[0]?.textLayout ?? [];
  const textOverflow = textLayout.filter((entry) => entry.overflow);
  const textCoverage = renderResult.outputs[0]?.textLayoutCoverage ?? {
    version: 2,
    measurement: "font_metrics",
    checked: textLayout.length,
    textBodies: textLayout.length,
    skipped: [],
  };

  const report = {
    schemaVersion: 1,
    program: PROGRAM_RELATIVE,
    reference: path.relative(REPO_ROOT, REFERENCE_PATH),
    creationEntrypoint: "independent JSSDK build(PowerPoint) from an empty presentation",
    host: "MopEditorPowerPointHost",
    slides: 1,
    nativeObjects: {
      count: nativeNodes.length,
      types: nativeNodes.map((node) => node.type),
    },
    comparison: {
      rawSsim: originalComparison.ssim,
      sizeMismatch: originalComparison.sizeMismatch,
      passed: originalComparison.ssim > 0.95 && !originalComparison.sizeMismatch,
    },
    exportComparison: {
      rawSsim: exportComparison.ssim,
      sizeMismatch: exportComparison.sizeMismatch,
      decodedPixelsEqual: generatedBytes.equals(reimportedBytes),
    },
    pptxExport: "passed",
    strictReimport:
      reopenedChartSpaces.length === chartSpaces.length ? "passed" : "failed",
    textOverflow,
    render: {
      outputs: [
        {
          index: 1,
          textLayout,
          textLayoutCoverage: textCoverage,
        },
      ],
      errors: [...renderResult.errors, ...reimportedRenderResult.errors],
    },
    chart: {
      generated: chartSpaces.length,
      reimported: reopenedChartSpaces.length,
      kind: chartKinds[0] ?? null,
    },
    exactSolution: false,
    sourceSha256: `sha256:${sha256(sourceBytes)}`,
    programSha256: `sha256:${sha256(await fs.readFile(PROGRAM_PATH))}`,
  };
  const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
  await fs.writeFile(VERIFICATION, reportBytes);

  const facts = {
    id: "clustered-column-source-reconstruction",
    family: "chart_comparison",
    source:
      "sampleall/chart/基础属性/簇状柱形图/簇状柱形图.pptx",
    page: 20,
    program: PROGRAM_RELATIVE,
    verification:
      "skills/aippt-jssdk-design/chart/evidence/clustered-column-source-reconstruction.verification.json",
    observed_items: 3,
    mechanism: "native-clustered-column-default-style",
    source_fact:
      "浅灰底 16:9 画布中央放置原生簇状柱形图，标题居中，顶部图例，柱顶数据标签，无数值轴。",
    transfer_hypothesis:
      "保留原生簇状柱、标题、顶部图例和柱顶数值标签；自由页面可在外层增加 KPI，但不能把柱图退化为等大色块。",
    visual_review: "pending",
    state: "source_reconstruction_candidate",
    source_admission: "needs_source_evidence",
    ssim: report.comparison.rawSsim,
    exact_reference: false,
    source_sha256: report.sourceSha256,
    program_sha256: report.programSha256,
    verification_sha256: `sha256:${sha256(reportBytes)}`,
    preview: path.relative(REPO_ROOT, REFERENCE_PATH),
    checks: {
      jssdk_executed: true,
      native_objects: report.nativeObjects,
      text_overflow: textOverflow.length,
      render_errors: report.render.errors.length,
      pptx_export: report.pptxExport,
      strict_reimport: report.strictReimport,
      text_coverage_version: textCoverage.version,
      text_measurement: textCoverage.measurement,
    },
    canvas_pt: [960, 540],
  };
  await fs.writeFile(FACTS, JSON.stringify(facts, null, 2) + "\n");

  console.log(
    JSON.stringify(
      {
        facts: path.relative(OFFICEDEX_ROOT, FACTS),
        verification: path.relative(OFFICEDEX_ROOT, VERIFICATION),
        rawSsim: report.comparison.rawSsim,
        exportSsim: report.exportComparison.rawSsim,
        chart: report.chart,
        textOverflow: textOverflow.length,
        renderErrors: report.render.errors.length,
      },
      null,
      2,
    ),
  );
} finally {
  await runtime.close();
}
