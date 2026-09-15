export const generationMode = "hybrid";
export const family = "chart_analysis";
export const variant = "dual-panel-chart-analysis";
export const status = "experimental_chart_recipe";
export const generationReady = false;
export const requiresVisualReview = true;

export const layoutSpec = {
  slide: { width: 960, height: 540 },
  visualRole: "chart",
  relation: "other",
  sourceMechanism: "free_composition_dual_native_chart_analysis",
  visualIntent: "two related charts with one shared analytical takeaway",
  focalPoint: { kind: "chart", area: "full", weight: 0.78 },
  requiredGeometry: [
    "native_left_chart",
    "native_right_chart",
    "shared_takeaway",
    "source_caption",
  ],
};

const DEFAULT_DATA = {
  eyebrow: "CHART ANALYSIS",
  title: "规模增长与质量提升，需要放在一起看",
  subtitle: "左侧看趋势，右侧看结构，结论只从两张图的交集里提炼。",
  leftTitle: "月度播放量趋势",
  leftMatrix: [
    ["", "1月", "2月", "3月", "4月", "5月"],
    ["播放量", 120, 150, 188, 225, 276],
  ],
  rightTitle: "内容类型互动率",
  rightMatrix: [
    ["", "教程", "案例", "测评", "观点"],
    ["互动率", 5.2, 8.6, 7.1, 4.4],
  ],
  takeaway: "规模增长没有牺牲质量：案例类内容既贡献增量，也保持最高互动率。",
  sourceText: "Source: uploaded table / illustrative sample",
};

function pickText(data, key) {
  return typeof data?.[key] === "string" && data[key].trim()
    ? data[key].trim()
    : DEFAULT_DATA[key];
}

function pickMatrix(data, key) {
  return Array.isArray(data?.[key]) && data[key].length >= 2
    ? data[key]
    : DEFAULT_DATA[key];
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
    slide.background.fill.setSolidFill({ color: "#142A33" });

    addText(
      slide,
      pickText(data, "eyebrow").toUpperCase(),
      { left: 62, top: 34, width: 230, height: 18 },
      { name: "analysis-eyebrow", size: 8, color: "#B9D9C3", bold: true },
    );
    addText(
      slide,
      pickText(data, "title"),
      { left: 62, top: 62, width: 790, height: 44 },
      {
        name: "analysis-title",
        size: 25,
        color: "#F2F4EA",
        bold: true,
      },
    );
    addText(
      slide,
      pickText(data, "subtitle"),
      { left: 64, top: 110, width: 760, height: 26 },
      { name: "analysis-subtitle", size: 11, color: "#A5B9B5" },
    );

    const leftPanel = slide.shapes.addGeometricShape("Rectangle", {
      left: 54,
      top: 154,
      width: 410,
      height: 268,
    });
    leftPanel.name = "left-chart-panel";
    leftPanel.fill.setSolidColor("#F7FAF5");
    leftPanel.lineFormat.visible = false;

    const rightPanel = slide.shapes.addGeometricShape("Rectangle", {
      left: 496,
      top: 154,
      width: 410,
      height: 268,
    });
    rightPanel.name = "right-chart-panel";
    rightPanel.fill.setSolidColor("#F7FAF5");
    rightPanel.lineFormat.visible = false;

    const leftChart = slide.shapes.addChart({
      chartType: "line",
      title: pickText(data, "leftTitle"),
      legendVisible: false,
      data: pickMatrix(data, "leftMatrix"),
      left: 62,
      top: 166,
      width: 394,
      height: 250,
    });
    leftChart.name = "native_left_chart";

    const rightChart = slide.shapes.addChart({
      chartType: "column",
      title: pickText(data, "rightTitle"),
      legendVisible: false,
      data: pickMatrix(data, "rightMatrix"),
      left: 504,
      top: 166,
      width: 394,
      height: 250,
    });
    rightChart.name = "native_right_chart";

    const rule = slide.shapes.addLine("Line", {
      left: 62,
      top: 458,
      width: 72,
      height: 0,
    });
    rule.name = "shared-takeaway-rule";
    rule.lineFormat.color = "#B9D9C3";
    rule.lineFormat.weight = 2;
    addText(
      slide,
      pickText(data, "takeaway"),
      { left: 154, top: 444, width: 690, height: 40 },
      {
        name: "shared_takeaway",
        size: 12,
        color: "#F1F5E9",
        bold: true,
      },
    );
    addText(
      slide,
      pickText(data, "sourceText"),
      { left: 64, top: 498, width: 360, height: 16 },
      { name: "source_caption", size: 8, color: "#8FA8A2" },
    );
    addText(
      slide,
      "CHART RECIPE",
      { left: 704, top: 498, width: 194, height: 16 },
      {
        name: "experimental-status",
        size: 7,
        color: "#8FA8A2",
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
