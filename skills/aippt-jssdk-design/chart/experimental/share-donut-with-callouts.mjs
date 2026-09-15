export const generationMode = "hybrid";
export const family = "chart_dashboard";
export const variant = "share-donut-with-callouts";
export const status = "experimental_chart_recipe";
export const generationReady = false;
export const requiresVisualReview = true;

export const layoutSpec = {
  slide: { width: 960, height: 540 },
  visualRole: "chart",
  relation: "distribution",
  sourceMechanism: "free_composition_donut_with_external_callouts",
  visualIntent: "distribution chart with three evidence-linked callouts",
  focalPoint: { kind: "chart", area: "center", weight: 0.62 },
  requiredGeometry: [
    "native_donut_chart",
    "center_label",
    "external_callouts",
    "source_caption",
  ],
};

const DEFAULT_DATA = {
  eyebrow: "CONTENT MIX",
  title: "内容结构正在向高价值主题集中",
  subtitle: "环图呈现内容占比，外部标注保留最重要的三条读图证据。",
  chartTitle: "内容主题占比",
  chartMatrix: [
    ["", "教程", "案例", "测评", "观点"],
    ["占比", 34, 28, 21, 17],
  ],
  centerValue: "62%",
  centerLabel: "高价值主题",
  callouts: [
    { label: "教程", value: "34%", note: "最大内容份额" },
    { label: "案例", value: "28%", note: "互动贡献稳定" },
    { label: "测评", value: "21%", note: "仍有扩张空间" },
  ],
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

function pickCallouts(data) {
  return Array.isArray(data?.callouts) && data.callouts.length > 0
    ? data.callouts.slice(0, 3)
    : DEFAULT_DATA.callouts;
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
  if (options.alignment)
    shape.textFrame.textRange.paragraphFormat.horizontalAlignment =
      options.alignment;
  return shape;
}

export function paintSlide(slide, data = {}) {
    slide.background.fill.setSolidFill({ color: "#F3F6F6" });

    addText(
      slide,
      pickText(data, "eyebrow").toUpperCase(),
      { left: 62, top: 38, width: 220, height: 20 },
      { name: "distribution-eyebrow", size: 8, color: "#3B7775", bold: true },
    );
    addText(
      slide,
      pickText(data, "title"),
      { left: 62, top: 65, width: 730, height: 44 },
      {
        name: "distribution-title",
        size: 25,
        color: "#203E3C",
        bold: true,
      },
    );
    addText(
      slide,
      pickText(data, "subtitle"),
      { left: 64, top: 112, width: 700, height: 28 },
      { name: "distribution-subtitle", size: 11, color: "#6D7D7C" },
    );

    const chart = slide.shapes.addChart({
      chartType: "donut",
      title: pickText(data, "chartTitle"),
      legendVisible: false,
      data: pickMatrix(data),
      left: 72,
      top: 158,
      width: 490,
      height: 300,
    });
    chart.name = "native_donut_chart";

    addText(
      slide,
      pickText(data, "centerValue"),
      { left: 252, top: 258, width: 160, height: 52 },
      {
        name: "center_label-value",
        size: 32,
        color: "#203E3C",
        bold: true,
        alignment: "Center",
      },
    );
    addText(
      slide,
      pickText(data, "centerLabel"),
      { left: 252, top: 307, width: 160, height: 26 },
      {
        name: "center_label-caption",
        size: 11,
        color: "#607A77",
        bold: true,
        alignment: "Center",
      },
    );

    const callouts = pickCallouts(data);
    const positions = [
      { top: 184, color: "#2E7D7A" },
      { top: 274, color: "#C67D46" },
      { top: 364, color: "#7B8F50" },
    ];
    callouts.forEach((callout, index) => {
      const position = positions[index];
      const rule = slide.shapes.addLine("Line", {
        left: 590,
        top: position.top + 18,
        width: 40,
        height: 0,
      });
      rule.name = `callout-rule-${index + 1}`;
      rule.lineFormat.color = position.color;
      rule.lineFormat.weight = 2;

      addText(
        slide,
        String(callout.label ?? ""),
        { left: 648, top: position.top, width: 90, height: 24 },
        {
          name: `callout-${index + 1}-label`,
          size: 11,
          color: "#385653",
          bold: true,
        },
      );
      addText(
        slide,
        String(callout.value ?? ""),
        { left: 748, top: position.top - 4, width: 86, height: 32 },
        {
          name: `callout-${index + 1}-value`,
          size: 20,
          color: position.color,
          bold: true,
        },
      );
      addText(
        slide,
        String(callout.note ?? ""),
        { left: 648, top: position.top + 30, width: 220, height: 22 },
        {
          name: `callout-${index + 1}-note`,
          size: 10,
          color: "#778683",
        },
      );
    });

    addText(
      slide,
      pickText(data, "sourceText"),
      { left: 64, top: 486, width: 360, height: 18 },
      { name: "source_caption", size: 8, color: "#7A8987" },
    );
    addText(
      slide,
      "CHART RECIPE",
      { left: 710, top: 505, width: 188, height: 16 },
      {
        name: "experimental-status",
        size: 7,
        color: "#7A8987",
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
