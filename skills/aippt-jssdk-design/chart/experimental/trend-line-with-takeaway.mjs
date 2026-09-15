export const generationMode = "hybrid";
export const family = "chart_trend";
export const variant = "trend-line-with-takeaway";
export const status = "experimental_chart_recipe";
export const generationReady = false;
export const requiresVisualReview = true;

export const layoutSpec = {
  slide: { width: 960, height: 540 },
  visualRole: "chart",
  relation: "trend",
  sourceMechanism: "free_composition_native_chart",
  visualIntent: "large trend chart with one editorial takeaway panel",
  focalPoint: { kind: "chart", area: "left", weight: 0.64 },
  requiredGeometry: [
    "native_line_chart",
    "takeaway_panel",
    "source_caption",
  ],
};

const DEFAULT_DATA = {
  eyebrow: "TREND REVIEW",
  title: "内容表现正在加速",
  subtitle: "原生折线图承载趋势，右侧只保留一个可追溯结论。",
  chartTitle: "播放量与互动量趋势",
  chartMatrix: [
    ["", "1月", "2月", "3月", "4月", "5月", "6月"],
    ["播放量", 120, 168, 214, 238, 310, 365],
    ["互动量", 32, 46, 58, 63, 88, 104],
  ],
  takeawayLabel: "核心结论",
  takeawayMetric: "+52%",
  takeawayText: "播放量在 4-6 月继续抬升，互动量同步增长，适合放大高互动内容主题。",
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

function setText(shape, text, options = {}) {
  const range = shape.textFrame.textRange;
  range.text = text;
  if (options.size) range.font.size = options.size;
  if (options.color) range.font.color = options.color;
  if (options.bold !== undefined) range.font.bold = options.bold;
  if (options.alignment)
    range.paragraphFormat.horizontalAlignment = options.alignment;
}

function addText(slide, text, bounds, options = {}) {
  const shape = slide.shapes.addTextBox(text, bounds);
  if (options.name) shape.name = options.name;
  shape.fill.clear();
  shape.lineFormat.visible = false;
  setText(shape, text, options);
  return shape;
}

export function paintSlide(slide, data = {}) {
    slide.background.fill.setSolidFill({ color: "#F6F8F2" });

    const eyebrow = pickText(data, "eyebrow").toUpperCase();
    addText(
      slide,
      eyebrow,
      { left: 62, top: 42, width: 210, height: 22 },
      {
        name: "chart-trend-eyebrow",
        size: 8,
        color: "#547366",
        bold: true,
      },
    );

    addText(
      slide,
      pickText(data, "title"),
      { left: 62, top: 70, width: 520, height: 48 },
      {
        name: "chart-trend-title",
        size: 27,
        color: "#233A34",
        bold: true,
      },
    );

    addText(
      slide,
      pickText(data, "subtitle"),
      { left: 64, top: 120, width: 520, height: 34 },
      {
        name: "chart-trend-subtitle",
        size: 11,
        color: "#66756F",
      },
    );

    const accent = slide.shapes.addLine("Line", {
      left: 64,
      top: 166,
      width: 86,
      height: 0,
    });
    accent.name = "chart-trend-accent-rule";
    accent.lineFormat.color = "#2E6B5A";
    accent.lineFormat.weight = 2.25;

    const chart = slide.shapes.addChart({
      chartType: "line",
      title: pickText(data, "chartTitle"),
      legendVisible: true,
      legendPosition: "bottom",
      data: pickMatrix(data),
      left: 58,
      top: 178,
      width: 620,
      height: 292,
    });
    chart.name = "native_line_chart";

    const panel = slide.shapes.addGeometricShape("Rectangle", {
      left: 708,
      top: 128,
      width: 190,
      height: 286,
    });
    panel.name = "takeaway_panel";
    panel.fill.setSolidColor("#17322C");
    panel.lineFormat.visible = false;

    addText(
      slide,
      pickText(data, "takeawayLabel"),
      { left: 732, top: 154, width: 140, height: 24 },
      {
        name: "takeaway-label",
        size: 10,
        color: "#C7D8C7",
        bold: true,
      },
    );

    addText(
      slide,
      pickText(data, "takeawayMetric"),
      { left: 730, top: 188, width: 148, height: 54 },
      {
        name: "takeaway-metric",
        size: 38,
        color: "#EAF1DA",
        bold: true,
      },
    );

    const divider = slide.shapes.addLine("Line", {
      left: 732,
      top: 255,
      width: 92,
      height: 0,
    });
    divider.name = "takeaway-divider";
    divider.lineFormat.color = "#8DAC92";
    divider.lineFormat.weight = 1;

    addText(
      slide,
      pickText(data, "takeawayText"),
      { left: 730, top: 276, width: 132, height: 88 },
      {
        name: "takeaway-body",
        size: 12,
        color: "#EEF3E8",
      },
    );

    addText(
      slide,
      pickText(data, "sourceText"),
      { left: 64, top: 488, width: 380, height: 18 },
      {
        name: "source_caption",
        size: 8,
        color: "#7D8983",
      },
    );

    addText(
      slide,
      "CHART RECIPE",
      { left: 718, top: 438, width: 180, height: 18 },
      {
        name: "experimental-status",
        size: 7,
        color: "#6E8178",
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
