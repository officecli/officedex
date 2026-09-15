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
const REPORT_ROOT = path.join(
  OFFICEDEX_ROOT,
  "build/aippt-chart-experimental-report",
);

const RECIPES = [
  {
    id: "trend-line-with-takeaway",
    data: {
      title: "短视频内容表现持续走高",
      subtitle: "基于上传表格生成趋势图，结论区只承载一个可验证判断。",
      chartTitle: "播放量与互动量趋势",
      chartMatrix: [
        ["", "1月", "2月", "3月", "4月", "5月", "6月"],
        ["播放量", 118, 160, 208, 236, 304, 358],
        ["互动量", 28, 42, 54, 61, 86, 102],
      ],
      takeawayMetric: "+51%",
      sourceText: "Source: table://tiktok-monthly-performance",
    },
    expectedCharts: 1,
    expectedChartKinds: ["line"],
  },
  {
    id: "kpi-plus-column",
    data: {
      title: "高互动内容，正在拉开差距",
      metricValue: "8.6%",
      chartMatrix: [
        ["", "教程", "案例", "测评", "观点"],
        ["播放量", 220, 310, 265, 188],
        ["互动量", 46, 82, 58, 31],
      ],
      takeaway: "案例类内容同时获得更高播放和互动，优先扩大这一内容组合。",
      sourceText: "Source: table://tiktok-content-benchmark",
    },
    expectedCharts: 1,
    expectedChartKinds: ["bar"],
  },
  {
    id: "share-donut-with-callouts",
    data: {
      title: "内容结构正在向高价值主题集中",
      centerValue: "62%",
      chartMatrix: [
        ["", "教程", "案例", "测评", "观点"],
        ["占比", 34, 28, 21, 17],
      ],
      callouts: [
        { label: "教程", value: "34%", note: "最大内容份额" },
        { label: "案例", value: "28%", note: "互动贡献稳定" },
        { label: "测评", value: "21%", note: "仍有扩张空间" },
      ],
      sourceText: "Source: table://tiktok-content-mix",
    },
    expectedCharts: 1,
    expectedChartKinds: ["doughnut"],
  },
  {
    id: "dual-panel-chart-analysis",
    data: {
      title: "规模增长与质量提升，需要放在一起看",
      leftMatrix: [
        ["", "1月", "2月", "3月", "4月", "5月"],
        ["播放量", 120, 150, 188, 225, 276],
      ],
      rightMatrix: [
        ["", "教程", "案例", "测评", "观点"],
        ["互动率", 5.2, 8.6, 7.1, 4.4],
      ],
      takeaway:
        "规模增长没有牺牲质量：案例类内容既贡献增量，也保持最高互动率。",
      sourceText: "Source: table://tiktok-growth-quality",
    },
    expectedCharts: 2,
    expectedChartKinds: ["line", "bar"],
  },
];

function collect(value, predicate, out = []) {
  if (!value || typeof value !== "object") return out;
  if (predicate(value)) out.push(value);
  for (const child of Object.values(value)) collect(child, predicate, out);
  return out;
}

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

const runId = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const outRoot = path.join(REPORT_ROOT, runId);
await fs.mkdir(outRoot, { recursive: true });

const runtime = await createJssdkNativeRuntime(PRESENTATION_ROOT);
const reports = [];

try {
  for (const recipe of RECIPES) {
    const recipeModulePath = path.join(
      SCRIPT_DIR,
      "experimental",
      `${recipe.id}.mjs`,
    );
    const recipeModule = await import(pathToFileURL(recipeModulePath).href);
    const recipeDir = path.join(outRoot, recipe.id);
    const generated = path.join(recipeDir, "generated.mop");
    const rendered = path.join(recipeDir, "rendered");
    const reimported = path.join(recipeDir, "reimported.mop");
    const pptx = path.join(recipeDir, "generated.pptx");
    await fs.mkdir(recipeDir, { recursive: true });

    await runtime.execute(recipeModule.build, recipe.data, generated);
    const renderResult = await runtime.render(generated, [1], rendered, 960);
    await exportMopDirectory(generated, pptx);
    await importPptxFile(pptx, reimported);

    const content = await readJson(path.join(generated, "content.json"));
    const reopened = await readJson(path.join(reimported, "content.json"));
    const generatedJson = JSON.stringify(content);
    const reopenedJson = JSON.stringify(reopened);
    const chartFrames = collect(
      content,
      (node) =>
        node.type === "graphicFrame" &&
        collect(node, (child) => child.type === "chartSpace").length > 0,
    );
    const chartSpaceCount = countMatches(generatedJson, /"type":"chartSpace"/gu);
    const reopenedChartSpaceCount = countMatches(
      reopenedJson,
      /"type":"chartSpace"/gu,
    );
    const chartKinds = [
      ...new Set(
        [...generatedJson.matchAll(/"chartKind":"([^"]+)"/gu)].map(
          (match) => match[1],
        ),
      ),
    ];

    const checks = {
      generation_ready: recipeModule.generationReady === false,
      status: recipeModule.status === "experimental_chart_recipe",
      render_errors: renderResult.errors.length,
      no_picture_fallback: !generatedJson.includes('"type":"picture"'),
      chart_frames: chartFrames.length,
      chart_space_count: chartSpaceCount,
      reopened_chart_space_count: reopenedChartSpaceCount,
      chart_kinds: chartKinds,
      expected_chart_kinds_present: recipe.expectedChartKinds.every((kind) =>
        chartKinds.includes(kind),
      ),
    };
    const passed =
      checks.generation_ready &&
      checks.status &&
      checks.render_errors === 0 &&
      checks.no_picture_fallback &&
      checks.chart_frames === recipe.expectedCharts &&
      checks.chart_space_count === recipe.expectedCharts &&
      checks.reopened_chart_space_count === recipe.expectedCharts &&
      checks.expected_chart_kinds_present;

    const report = {
      recipe_id: recipe.id,
      passed,
      mode: recipeModule.generationMode,
      status: recipeModule.status,
      generation_ready: recipeModule.generationReady,
      formal_generation_gate: "blocked_until_source_evidence",
      artifact_paths: {
        generated_mop: path.relative(OFFICEDEX_ROOT, generated),
        rendered_svg: path.relative(
          OFFICEDEX_ROOT,
          path.join(rendered, "slide-0001.svg"),
        ),
        pptx: path.relative(OFFICEDEX_ROOT, pptx),
        reimported_mop: path.relative(OFFICEDEX_ROOT, reimported),
      },
      checks,
    };
    reports.push(report);
    await fs.writeFile(
      path.join(recipeDir, "experimental-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
} finally {
  await runtime.close();
}

const manifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  scope:
    "experimental native chart smoke only; not source admission and not registry release",
  report_dir: path.relative(OFFICEDEX_ROOT, outRoot),
  recipes: reports,
};
await fs.writeFile(
  path.join(outRoot, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

console.log(JSON.stringify(manifest, null, 2));

if (!reports.every((report) => report.passed)) {
  throw new Error(`Experimental chart verification failed: ${outRoot}`);
}
