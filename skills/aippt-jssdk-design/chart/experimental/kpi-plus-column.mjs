export const generationMode = "hybrid";
export const family = "chart_comparison";
export const variant = "kpi-plus-column";
export const status = "experimental_chart_recipe";
export const generationReady = false;
export const requiresVisualReview = true;

export const layoutSpec = {
  slide: { width: 960, height: 540 },
  visualRole: "chart",
  relation: "comparison",
  sourceMechanism: "free_composition_kpi_plus_native_chart",
  visualIntent: "single metric anchor with a comparison chart",
  focalPoint: { kind: "chart", area: "right", weight: 0.58 },
  requiredGeometry: [
    "metric_anchor",
    "native_column_chart",
    "comparison_takeaway",
    "source_caption",
  ],
};

const DEFAULT_DATA = {
  eyebrow: "CONTENT BENCHMARK",
  title: "高互动内容，正在拉开差距",
  subtitle: "把一个核心指标和分组比较放在同一阅读路径里。",
  metricLabel: "最高互动率",
  metricValue: "8.6%",
  metricNote: "较基线高 2.1 个百分点",
  chartTitle: "内容类型对比",
  chartMatrix: [
    ["", "教程", "案例", "测评", "观点"],
    ["播放量", 220, 310, 265, 188],
    ["互动量", 46, 82, 58, 31],
  ],
  takeaway: "案例类内容同时获得更高播放和互动，优先扩大这一内容组合。",
  sourceText: "Source: uploaded table / illustrative sample",
};

function pickText(data, key) {
  return typeof data?.[key] === "string" && data[key].trim()
    ? data[key].trim()
    : DEFAULT_DATA[key];
}

function pickMatrix(data) {
  return Array.isArray(data?.chartMatrix) && data.chartMatrix.length >= 2
    ? data.chartMatrix
    : DEFAULT_DATA.chartMatrix;
}

function addText(slide, text, bounds, options = {}) {
  const shape = slide.shapes.addTextBox(text, bounds);
  if (options.name) shape.name = options.name;
  shape.fill.clear();
  shape.lineFormat.visible = false;
  shape.textFrame.textRange.text = text;
  if (options.size) shape.textFrame.textRange.font.size = options.size;
  if (options.color) shape.textFrame.textRange.font.color = options.color;
  if (options.bold !== undefined)
    shape.textFrame.textRange.font.bold = options.bold;
  return shape;
}

export function paintSlide(slide, data = {}) {
    slide.background.fill.setSolidFill({ color: "#F7F4EE" });

    addText(
      slide,
      pickText(data, "eyebrow").toUpperCase(),
      { left: 62, top: 38, width: 250, height: 20 },
      {
        name: "comparison-eyebrow",
        size: 8,
        color: "#8A6B42",
        bold: true,
      },
    );
    addText(
      slide,
      pickText(data, "title"),
      { left: 62, top: 65, width: 700, height: 44 },
      {
        name: "comparison-title",
        size: 26,
        color: "#29251E",
        bold: true,
      },
    );
    addText(
      slide,
      pickText(data, "subtitle"),
      { left: 64, top: 112, width: 680, height: 28 },
      {
        name: "comparison-subtitle",
        size: 11,
        color: "#766F64",
      },
    );

    const metricAnchor = slide.shapes.addGeometricShape("Rectangle", {
      left: 62,
      top: 168,
      width: 242,
      height: 235,
    });
    metricAnchor.name = "metric_anchor";
    metricAnchor.fill.setSolidColor("#2D5147");
    metricAnchor.lineFormat.visible = false;

    addText(
      slide,
      pickText(data, "metricLabel"),
      { left: 86, top: 195, width: 180, height: 24 },
      {
        name: "metric-label",
        size: 11,
        color: "#CFE1D4",
        bold: true,
      },
    );
    addText(
      slide,
      pickText(data, "metricValue"),
      { left: 82, top: 231, width: 188, height: 68 },
      {
        name: "metric-value",
        size: 44,
        color: "#F4E7BB",
        bold: true,
      },
    );
    addText(
      slide,
      pickText(data, "metricNote"),
      { left: 86, top: 322, width: 164, height: 42 },
      {
        name: "metric-note",
        size: 11,
        color: "#E8F0E8",
      },
    );

    const chart = slide.shapes.addChart({
      chartType: "column",
      title: pickText(data, "chartTitle"),
      legendVisible: true,
      legendPosition: "bottom",
      data: pickMatrix(data),
      left: 338,
      top: 162,
      width: 560,
      height: 290,
    });
    chart.name = "native_column_chart";

    const takeawayRule = slide.shapes.addLine("Line", {
      left: 338,
      top: 468,
      width: 72,
      height: 0,
    });
    takeawayRule.name = "comparison-takeaway-rule";
    takeawayRule.lineFormat.color = "#A9824D";
    takeawayRule.lineFormat.weight = 2;
    addText(
      slide,
      pickText(data, "takeaway"),
      { left: 430, top: 454, width: 432, height: 38 },
      {
        name: "comparison_takeaway",
        size: 11,
        color: "#51483D",
        bold: true,
      },
    );
    addText(
      slide,
      pickText(data, "sourceText"),
      { left: 64, top: 486, width: 340, height: 18 },
      {
        name: "source_caption",
        size: 8,
        color: "#8B8378",
      },
    );
    addText(
      slide,
      "CHART RECIPE",
      { left: 710, top: 505, width: 188, height: 16 },
      {
        name: "experimental-status",
        size: 7,
        color: "#8B8378",
        bold: true,
      },
    );
}

export async function build(PowerPoint, data = {}) {
  await PowerPoint.run(async (context) => {
    context.presentation.pageSetup.slideWidth = 960;
    context.presentation.pageSetup.slideHeight = 540;
    context.presentation.slides.add();
    await context.sync();
    paintSlide(context.presentation.slides.getItemAt(0), data);
    await context.sync();
  });
}
