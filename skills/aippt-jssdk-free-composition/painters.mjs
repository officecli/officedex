import { paintSlide as paintTrend } from "./chart/trend-line-with-takeaway.mjs";
import { paintSlide as paintKpi } from "./chart/kpi-plus-column.mjs";
import { paintSlide as paintDonut } from "./chart/share-donut-with-callouts.mjs";
import { paintSlide as paintDual } from "./chart/dual-panel-chart-analysis.mjs";
import registry from "./registry.json" with { type: "json" };

export const DRAWER_IDS = registry.drawers;
export const DRAWER_ALIASES = registry.aliases;

const ILLUSTRATIVE = "示意数据，用来训练读图，不代表真实后台结果。";
const INK = "#16161D";
const MUTED = "#5E5A64";
const PAPER = "#F7F5F2";
const WHITE = "#FFFFFF";
const PINK = "#FE2C55";
const CYAN = "#25F4EE";
const DARK = "#111318";
const COLORS = ["#FE2C55", "#111318", "#5B8DEF", "#2F6F5E"];

const CHART_PAINTERS = {
  "trend-line-with-takeaway": paintTrend,
  "kpi-plus-column": paintKpi,
  "share-donut-with-callouts": paintDonut,
  "dual-panel-chart-analysis": paintDual,
};

function addText(slide, value, box, size, bold, color, align = "Left") {
  const left = Math.max(6, box.left - 10);
  const width = Math.min(box.width + 36, 954 - left);
  const shape = slide.shapes.addTextBox(value, {
    left,
    top: box.top,
    width,
    height: box.height + 12,
  });
  shape.fill.clear();
  shape.lineFormat.visible = false;
  const frame = shape.textFrame;
  frame.wordWrap = true;
  frame.autoSizeSetting = "AutoSizeNone";
  frame.leftMargin = 4;
  frame.rightMargin = 4;
  frame.topMargin = 2;
  frame.bottomMargin = 4;
  const range = frame.textRange;
  range.text = value;
  range.font.name = "PingFang SC";
  range.font.eastAsianName = "PingFang SC";
  range.font.size = size;
  range.font.bold = bold;
  range.font.color = color;
  range.paragraphFormat.horizontalAlignment = align;
  range.paragraphFormat.lineSpacingMultiple = 1.12;
  return shape;
}

function shape(slide, type, box, color) {
  const item = slide.shapes.addGeometricShape(type, box);
  item.fill.setSolidColor(color);
  item.lineFormat.visible = false;
  return item;
}

function line(slide, box, color, weight = 1.5) {
  const item = slide.shapes.addLine("Line", box);
  item.lineFormat.color = color;
  item.lineFormat.weight = weight;
  return item;
}

function chrome(slide, page, title, subtitle, dark = false) {
  const ink = dark ? WHITE : INK;
  const muted = dark ? "#C9C6D1" : MUTED;
  const accent = dark ? CYAN : PINK;
  slide.background.fill.setSolidFill({ color: dark ? DARK : PAPER });
  addText(slide, page.eyebrow || "OFFICEDEX  ·  自由构图", { left: 48, top: 22, width: 420, height: 20 }, 10, true, muted);
  addText(slide, title, { left: 48, top: 48, width: 860, height: 56 }, 28, true, ink);
  addText(slide, subtitle || "", { left: 48, top: 108, width: 860, height: 40 }, 14, false, muted);
  if (page.total) {
    addText(
      slide,
      `${String(page.slide).padStart(2, "0")}  /  ${String(page.total).padStart(2, "0")}`,
      { left: 780, top: 508, width: 132, height: 20 },
      10,
      false,
      muted,
      "Right",
    );
  }
  line(slide, { left: 48, top: 156, width: 64, height: 0 }, accent, 2.25);
  return { ink, muted, accent };
}

function markerColumns(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const count = Math.max(page.items.length, 1);
  const gap = 28;
  const width = (864 - gap * (count - 1)) / count;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    shape(slide, "Ellipse", { left: x, top: 196, width: 18, height: 18 }, accent);
    addText(slide, heading, { left: x + 28, top: 188, width: width - 28, height: 40 }, 20, true, ink);
    addText(slide, detail, { left: x, top: 240, width, height: 220 }, 15, false, muted);
  });
}

function editorialGrid(slide, page) {
  const { muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const count = Math.max(page.items.length, 1);
  const gap = 16;
  const width = (864 - gap * (count - 1)) / count;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    shape(slide, "Rectangle", { left: x, top: 180, width, height: 292 }, WHITE);
    shape(slide, "Rectangle", { left: x, top: 180, width: 8, height: 292 }, accent);
    addText(slide, heading, { left: x + 24, top: 204, width: width - 40, height: 52 }, 20, true, INK);
    addText(slide, detail, { left: x + 24, top: 264, width: width - 40, height: 180 }, 14, false, MUTED);
  });
}

function numberedRows(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  page.items.forEach(([heading, detail], index) => {
    const y = 176 + index * Math.min(76, 300 / Math.max(page.items.length, 1));
    shape(slide, "Rectangle", { left: 48, top: y + 4, width: 44, height: 44 }, accent);
    addText(slide, String(index + 1).padStart(2, "0"), { left: 48, top: y + 12, width: 44, height: 28 }, 16, true, WHITE, "Center");
    addText(slide, heading, { left: 108, top: y, width: 220, height: 52 }, 18, true, ink);
    addText(slide, detail, { left: 340, top: y, width: 572, height: 60 }, 15, false, muted);
  });
}

function ringLabels(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const colors = [accent, "#111318", "#5B8DEF", "#2F6F5E"];
  const count = Math.max(page.items.length, 1);
  const step = Math.min(280, 800 / count);
  page.items.forEach(([heading, detail], index) => {
    const x = 80 + index * step;
    shape(slide, "Ellipse", { left: x + 48, top: 188, width: 120, height: 120 }, colors[index % colors.length]);
    addText(slide, heading, { left: x + 48, top: 228, width: 120, height: 40 }, 18, true, WHITE, "Center");
    addText(slide, detail, { left: x, top: 328, width: Math.min(216, step - 16), height: 120 }, 14, false, muted, "Center");
  });
}

function linkedStages(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const first = 120;
  const step = page.items.length > 1 ? 720 / (page.items.length - 1) : 0;
  const axisY = 300;
  const labelW = 210;
  if (page.items.length > 1) line(slide, { left: first, top: axisY, width: step * (page.items.length - 1), height: 0 }, accent, 2);
  page.items.forEach(([heading, detail], index) => {
    const x = first + index * step;
    const above = index % 2 === 0;
    const lx = Math.max(48, Math.min(702, x - labelW / 2));
    shape(slide, "Ellipse", { left: x - 18, top: axisY - 18, width: 36, height: 36 }, accent);
    addText(slide, String(index + 1), { left: x - 18, top: axisY - 10, width: 36, height: 22 }, 14, true, WHITE, "Center");
    addText(slide, heading, { left: lx, top: above ? 188 : 336, width: labelW, height: 36 }, 16, true, ink, "Center");
    addText(slide, detail, { left: lx, top: above ? 224 : 372, width: labelW, height: 80 }, 12, false, muted, "Center");
  });
}

function labelColumns(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const count = Math.max(page.items.length, 1);
  const gap = 16;
  const width = (864 - gap * (count - 1)) / count;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    addText(slide, String(index + 1).padStart(2, "0"), { left: x, top: 184, width, height: 28 }, 14, true, accent);
    addText(slide, heading, { left: x, top: 216, width, height: 40 }, 20, true, ink);
    line(slide, { left: x, top: 264, width: 48, height: 0 }, accent, 2);
    addText(slide, detail, { left: x, top: 280, width, height: 160 }, 14, false, muted);
  });
}

function horizontalAxis(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const first = 130;
  const step = page.items.length > 1 ? 700 / (page.items.length - 1) : 0;
  const axisY = 332;
  const labelW = 210;
  if (page.items.length > 1) line(slide, { left: first, top: axisY, width: step * (page.items.length - 1), height: 0 }, accent, 2);
  page.items.forEach(([heading, detail], index) => {
    const x = first + index * step;
    const above = index % 2 === 0;
    const lx = Math.max(48, Math.min(702, x - labelW / 2));
    shape(slide, "Ellipse", { left: x - 8, top: axisY - 8, width: 16, height: 16 }, accent);
    line(slide, { left: x, top: above ? 300 : 340, width: 0, height: 24 }, accent, 1.5);
    addText(slide, heading, { left: lx, top: above ? 196 : 360, width: labelW, height: 36 }, 16, true, ink, "Center");
    addText(slide, detail, { left: lx, top: above ? 236 : 400, width: labelW, height: 80 }, 12, false, muted, "Center");
  });
}

function branchLeft(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const parent = page.items[0] || ["", ""];
  const children = page.items.slice(1);
  shape(slide, "RoundRectangle", { left: 48, top: 250, width: 260, height: 140 }, accent);
  addText(slide, parent[0], { left: 64, top: 268, width: 228, height: 36 }, 18, true, WHITE);
  addText(slide, parent[1], { left: 64, top: 308, width: 228, height: 64 }, 13, false, "#FFE8EE");
  children.forEach(([heading, detail], index) => {
    const y = 176 + index * 108;
    const joinY = y + 36;
    line(slide, { left: 308, top: 320, width: 24, height: 0 }, accent, 1.5);
    line(slide, { left: 332, top: Math.min(320, joinY), width: 0, height: Math.abs(joinY - 320) }, accent, 1.5);
    line(slide, { left: 332, top: joinY, width: 24, height: 0 }, accent, 1.5);
    shape(slide, "RoundRectangle", { left: 356, top: y, width: 556, height: 92 }, WHITE);
    addText(slide, heading, { left: 376, top: y + 10, width: 516, height: 28 }, 16, true, INK);
    addText(slide, detail, { left: 376, top: y + 40, width: 516, height: 40 }, 13, false, MUTED);
  });
}

function separatedTiers(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  page.items.forEach(([heading, detail], index) => {
    const width = 220 + index * 80;
    const x = 48 + (460 - width) / 2;
    const y = 176 + index * 76;
    shape(slide, "Rectangle", { left: x, top: y, width, height: 64 }, index === 0 ? accent : COLORS[index] ?? "#111318");
    addText(slide, heading, { left: 540, top: y + 4, width: 380, height: 24 }, 16, true, ink);
    addText(slide, detail, { left: 540, top: y + 28, width: 380, height: 32 }, 13, false, muted);
  });
}

function ticketPanels(slide, page) {
  const { accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const count = Math.max(page.items.length, 1);
  const gap = 16;
  const width = (864 - gap * (count - 1)) / count;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    shape(slide, "Rectangle", { left: x, top: 196, width, height: 268 }, WHITE);
    shape(slide, "Rectangle", { left: x + 20, top: 184, width: 96, height: 28 }, accent);
    addText(slide, String(index + 1).padStart(2, "0"), { left: x + 20, top: 188, width: 96, height: 20 }, 12, true, WHITE, "Center");
    addText(slide, heading, { left: x + 20, top: 236, width: width - 40, height: 48 }, 20, true, INK);
    line(slide, { left: x + 20, top: 292, width: 48, height: 0 }, accent, 2);
    addText(slide, detail, { left: x + 20, top: 312, width: width - 40, height: 128 }, 14, false, MUTED);
  });
}

function railCallouts(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const step = Math.min(76, 300 / Math.max(page.items.length, 1));
  page.items.forEach(([heading, detail], index) => {
    const y = 176 + index * step;
    shape(slide, "Ellipse", { left: 64, top: y + 8, width: 56, height: 56 }, accent);
    addText(slide, String(index + 1), { left: 64, top: y + 22, width: 56, height: 28 }, 16, true, WHITE, "Center");
    line(slide, { left: 128, top: y + 36, width: 36, height: 0 }, accent, 1.5);
    addText(slide, heading, { left: 176, top: y, width: 220, height: 32 }, 16, true, ink);
    addText(slide, detail, { left: 176, top: y + 32, width: 736, height: 36 }, 14, false, muted);
  });
}

function hexagonColumns(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const count = Math.max(page.items.length, 1);
  const gap = 16;
  const width = (864 - gap * (count - 1)) / count;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    const hex = slide.shapes.addGeometricShape("Hexagon", { left: x + (width - 96) / 2, top: 180, width: 96, height: 88 });
    hex.fill.setSolidColor(index % 2 === 0 ? accent : "#111318");
    hex.lineFormat.visible = false;
    addText(slide, String(index + 1).padStart(2, "0"), { left: x + (width - 96) / 2, top: 206, width: 96, height: 36 }, 16, true, WHITE, "Center");
    addText(slide, heading, { left: x, top: 284, width, height: 40 }, 18, true, ink, "Center");
    addText(slide, detail, { left: x, top: 328, width, height: 132 }, 13, false, muted, "Center");
  });
}

function iconBlocks(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const count = Math.max(page.items.length, 1);
  const gap = 16;
  const width = (864 - gap * (count - 1)) / count;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    shape(slide, "RoundRectangle", { left: x + (width - 100) / 2, top: 184, width: 100, height: 100 }, index === 1 ? "#111318" : accent);
    addText(slide, String(index + 1).padStart(2, "0"), { left: x + (width - 100) / 2, top: 216, width: 100, height: 36 }, 20, true, WHITE, "Center");
    addText(slide, heading, { left: x, top: 304, width, height: 40 }, 18, true, ink, "Center");
    addText(slide, detail, { left: x + 12, top: 348, width: width - 24, height: 110 }, 14, false, muted, "Center");
  });
}

function openRingCallouts(slide, page) {
  const { ink, muted, accent } = chrome(slide, page, page.title, page.subtitle, page.dark);
  const count = Math.max(page.items.length, 1);
  const gap = 16;
  const width = (864 - gap * (count - 1)) / count;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    const ring = slide.shapes.addGeometricShape("Donut", { left: x + (width - 100) / 2, top: 184, width: 100, height: 100 });
    ring.fill.setSolidColor(accent);
    ring.lineFormat.visible = false;
    addText(slide, String(index + 1), { left: x + (width - 100) / 2, top: 216, width: 100, height: 36 }, 18, true, ink, "Center");
    line(slide, { left: x + width / 2, top: 284, width: 0, height: 24 }, accent, 1.5);
    addText(slide, heading, { left: x, top: 312, width, height: 36 }, 18, true, ink, "Center");
    addText(slide, detail, { left: x + 8, top: 352, width: width - 16, height: 110 }, 14, false, muted, "Center");
  });
}

const PAINTERS = {
  "marker-columns": markerColumns,
  "editorial-grid": editorialGrid,
  "numbered-rows": numberedRows,
  "ring-labels": ringLabels,
  "linked-stages": linkedStages,
  "label-columns": labelColumns,
  "horizontal-axis": horizontalAxis,
  "alternating-axis": horizontalAxis,
  "branch-left": branchLeft,
  "branch-left-four": branchLeft,
  "separated-tiers": separatedTiers,
  "filled-tiers": separatedTiers,
  "ticket-panels": ticketPanels,
  "rail-callouts": railCallouts,
  "hexagon-columns": hexagonColumns,
  "icon-blocks": iconBlocks,
  "open-ring-callouts": openRingCallouts,
  "medal-panels": iconBlocks,
  "balanced-pair": editorialGrid,
};

export function resolveDrawer(signature) {
  const id = DRAWER_ALIASES[signature] || signature;
  return { id, paint: PAINTERS[id] || editorialGrid };
}

function chartMatrixFromPage(page) {
  const chart = page.chart || {};
  if (Array.isArray(chart.chartMatrix) && chart.chartMatrix.length >= 2) return chart.chartMatrix;
  const categories = chart.categories || page.items.map(([heading]) => heading);
  const values = chart.values || page.items.map(() => 1);
  return [["", ...categories], [chart.series || "数值", ...values]];
}

function chartRecipe(page) {
  if (page.chart?.recipe && CHART_PAINTERS[page.chart.recipe]) return page.chart.recipe;
  if (CHART_PAINTERS[page.signature]) return page.signature;
  const type = String(page.chart?.type || "").toLowerCase();
  return registry.charts[type] || "kpi-plus-column";
}

function paintChart(slide, page) {
  const recipe = chartRecipe(page);
  const paint = CHART_PAINTERS[recipe];
  const chart = page.chart && typeof page.chart === "object" ? page.chart : {};
  const matrix = chartMatrixFromPage(page);
  const series = Array.isArray(matrix[1]) ? matrix[1].slice(1).map(Number).filter((n) => Number.isFinite(n)) : [];
  const peak = series.length ? Math.max(...series) : "";
  paint(slide, {
    ...chart,
    title: page.title || chart.title,
    subtitle: page.subtitle || chart.subtitle,
    chartTitle: chart.chartTitle || chart.title || page.title,
    chartMatrix: matrix,
    takeawayText: chart.takeawayText || chart.takeaway || page.subtitle || page.items?.[0]?.[1] || "",
    takeawayMetric: chart.takeawayMetric || (peak === "" ? "" : String(peak)),
    centerValue: chart.centerValue || (series.length ? `${Math.round((peak / series.reduce((a, b) => a + b, 0)) * 100)}%` : ""),
    centerLabel: chart.centerLabel || page.items?.[0]?.[0] || "",
    callouts: chart.callouts || (page.items || []).slice(0, 3).map(([label, note], index) => ({
      label,
      value: String(matrix[1]?.[index + 1] ?? ""),
      note,
    })),
    sourceText: chart.sourceText || page.source || ILLUSTRATIVE,
    recipeStamp: false,
  });
}

export function paintPage(slide, page) {
  if (page.chart) {
    paintChart(slide, page);
    return resolveDrawer(page.signature).id;
  }
  const { id, paint } = resolveDrawer(page.signature);
  paint(slide, page);
  return id;
}
