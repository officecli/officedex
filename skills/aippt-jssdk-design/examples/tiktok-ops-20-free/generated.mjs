import pages from "./content.json" with { type: "json" };
import { paintSlide as paintTrend } from "../../chart/experimental/trend-line-with-takeaway.mjs";
import { paintSlide as paintKpi } from "../../chart/experimental/kpi-plus-column.mjs";
import { paintSlide as paintDonut } from "../../chart/experimental/share-donut-with-callouts.mjs";
import { paintSlide as paintDual } from "../../chart/experimental/dual-panel-chart-analysis.mjs";

export const generationMode = "free_composition";
export const family = "deck";
export const variant = "tiktok-ops-20-free";

const ILLUSTRATIVE = "示意数据，用来训练读图，不代表真实后台结果。";
const INK = "#16161D";
const MUTED = "#5E5A64";
const PAPER = "#F7F5F2";
const WHITE = "#FFFFFF";
const PINK = "#FE2C55";
const CYAN = "#25F4EE";
const DARK = "#111318";
const COLORS = ["#FE2C55", "#111318", "#5B8DEF", "#2F6F5E"];

function addText(slide, value, box, size, bold, color, align = "Left") {
  const shape = slide.shapes.addTextBox(value, box);
  shape.fill.clear();
  shape.lineFormat.visible = false;
  const frame = shape.textFrame;
  frame.wordWrap = true;
  frame.autoSizeSetting = "AutoSizeNone";
  frame.leftMargin = 2;
  frame.rightMargin = 2;
  frame.topMargin = 2;
  frame.bottomMargin = 2;
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
  addText(slide, "TIKTOK  ·  自由构图", { left: 48, top: 22, width: 420, height: 20 }, 10, true, muted);
  addText(slide, title, { left: 48, top: 48, width: 860, height: 56 }, 28, true, ink);
  addText(slide, subtitle, { left: 48, top: 108, width: 860, height: 40 }, 14, false, muted);
  addText(
    slide,
    `${String(page).padStart(2, "0")}  /  20`,
    { left: 780, top: 508, width: 132, height: 20 },
    10,
    false,
    muted,
    "Right",
  );
  line(slide, { left: 48, top: 156, width: 64, height: 0 }, accent, 2.25);
  return { ink, muted, accent };
}

function markerColumns(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const gap = 28;
  const width = (864 - gap * 2) / 3;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    shape(slide, "Ellipse", { left: x, top: 196, width: 18, height: 18 }, accent);
    addText(slide, heading, { left: x + 28, top: 188, width: width - 28, height: 40 }, 20, true, ink);
    addText(slide, detail, { left: x, top: 240, width, height: 220 }, 15, false, muted);
  });
}

function editorialGrid(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const gap = 16;
  const width = (864 - gap * 2) / 3;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    shape(slide, "Rectangle", { left: x, top: 180, width, height: 292 }, WHITE);
    shape(slide, "Rectangle", { left: x, top: 180, width: 8, height: 292 }, accent);
    addText(slide, heading, { left: x + 24, top: 204, width: width - 40, height: 52 }, 20, true, ink);
    addText(slide, detail, { left: x + 24, top: 264, width: width - 40, height: 180 }, 14, false, muted);
  });
}

function numberedRows(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  page.items.forEach(([heading, detail], index) => {
    const y = 176 + index * 76;
    shape(slide, "Rectangle", { left: 48, top: y + 4, width: 44, height: 44 }, accent);
    addText(slide, String(index + 1).padStart(2, "0"), { left: 48, top: y + 12, width: 44, height: 28 }, 16, true, WHITE, "Center");
    addText(slide, heading, { left: 108, top: y, width: 220, height: 52 }, 18, true, ink);
    addText(slide, detail, { left: 340, top: y, width: 572, height: 60 }, 15, false, muted);
    if (index < page.items.length - 1) {
      line(slide, { left: 108, top: y + 66, width: 804, height: 0 }, "#E6E1DC", 1);
    }
  });
}

function ringLabels(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const colors = [accent, "#111318", "#5B8DEF"];
  page.items.forEach(([heading, detail], index) => {
    const x = 80 + index * 280;
    shape(slide, "Ellipse", { left: x + 48, top: 188, width: 120, height: 120 }, colors[index]);
    addText(slide, heading, { left: x + 48, top: 228, width: 120, height: 40 }, 18, true, WHITE, "Center");
    addText(slide, detail, { left: x, top: 328, width: 216, height: 120 }, 14, false, muted, "Center");
  });
}

function linkedStages(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const first = 96;
  const step = 232;
  const axisY = 300;
  line(slide, { left: first, top: axisY, width: step * (page.items.length - 1), height: 0 }, accent, 2);
  page.items.forEach(([heading, detail], index) => {
    const x = first + index * step;
    const above = index % 2 === 0;
    shape(slide, "Ellipse", { left: x - 18, top: axisY - 18, width: 36, height: 36 }, accent);
    addText(slide, String(index + 1), { left: x - 18, top: axisY - 10, width: 36, height: 22 }, 14, true, WHITE, "Center");
    addText(slide, heading, { left: x - 100, top: above ? 188 : 336, width: 200, height: 36 }, 16, true, ink, "Center");
    addText(slide, detail, { left: x - 100, top: above ? 224 : 372, width: 200, height: 64 }, 13, false, muted, "Center");
  });
}

function labelColumns(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const width = 200;
  const gap = 16;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + gap);
    addText(slide, String(index + 1).padStart(2, "0"), { left: x, top: 184, width: width, height: 28 }, 14, true, accent);
    addText(slide, heading, { left: x, top: 216, width, height: 40 }, 20, true, ink);
    line(slide, { left: x, top: 264, width: 48, height: 0 }, accent, 2);
    addText(slide, detail, { left: x, top: 280, width, height: 160 }, 14, false, muted);
  });
}

function horizontalAxis(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const first = 120;
  const step = 220;
  const axisY = 332;
  line(slide, { left: first, top: axisY, width: step * (page.items.length - 1), height: 0 }, accent, 2);
  page.items.forEach(([heading, detail], index) => {
    const x = first + index * step;
    const above = index % 2 === 0;
    shape(slide, "Ellipse", { left: x - 8, top: axisY - 8, width: 16, height: 16 }, accent);
    line(slide, { left: x, top: above ? 300 : 340, width: 0, height: above ? 24 : 24 }, accent, 1.5);
    addText(slide, heading, { left: x - 100, top: above ? 196 : 360, width: 200, height: 36 }, 16, true, ink, "Center");
    addText(slide, detail, { left: x - 100, top: above ? 236 : 400, width: 200, height: 72 }, 13, false, muted, "Center");
  });
}

function branchLeft(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const parent = page.items[0];
  const children = page.items.slice(1);
  shape(slide, "RoundRectangle", { left: 48, top: 250, width: 260, height: 140 }, accent);
  addText(slide, parent[0], { left: 64, top: 268, width: 228, height: 36 }, 18, true, WHITE);
  addText(slide, parent[1], { left: 64, top: 308, width: 228, height: 64 }, 13, false, "#FFE8EE");
  children.forEach(([heading, detail], index) => {
    const y = 176 + index * 108;
    const joinY = y + 36;
    line(slide, { left: 308, top: 320, width: 24, height: 0 }, accent, 1.5);
    line(
      slide,
      {
        left: 332,
        top: Math.min(320, joinY),
        width: 0,
        height: Math.abs(joinY - 320),
      },
      accent,
      1.5,
    );
    line(slide, { left: 332, top: joinY, width: 24, height: 0 }, accent, 1.5);
    shape(slide, "RoundRectangle", { left: 356, top: y, width: 556, height: 92 }, WHITE);
    addText(slide, heading, { left: 376, top: y + 10, width: 516, height: 28 }, 16, true, ink);
    addText(slide, detail, { left: 376, top: y + 40, width: 516, height: 40 }, 13, false, muted);
  });
}

function separatedTiers(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const widths = [220, 300, 380, 460];
  page.items.forEach(([heading, detail], index) => {
    const width = widths[index];
    const x = 48 + (460 - width) / 2;
    const y = 176 + index * 76;
    shape(slide, "Rectangle", { left: x, top: y, width, height: 64 }, index === 0 ? accent : COLORS[index] ?? "#111318");
    addText(slide, heading, { left: 540, top: y + 4, width: 380, height: 24 }, 16, true, ink);
    addText(slide, detail, { left: 540, top: y + 28, width: 380, height: 32 }, 13, false, muted);
  });
}

function ticketPanels(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const width = 272;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + 16);
    shape(slide, "Rectangle", { left: x, top: 196, width, height: 268 }, WHITE);
    shape(slide, "Rectangle", { left: x + 20, top: 184, width: 96, height: 28 }, accent);
    addText(slide, String(index + 1).padStart(2, "0"), { left: x + 20, top: 188, width: 96, height: 20 }, 12, true, WHITE, "Center");
    addText(slide, heading, { left: x + 20, top: 236, width: width - 40, height: 48 }, 20, true, ink);
    line(slide, { left: x + 20, top: 292, width: 48, height: 0 }, accent, 2);
    addText(slide, detail, { left: x + 20, top: 312, width: width - 40, height: 128 }, 14, false, muted);
  });
}

function railCallouts(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  page.items.forEach(([heading, detail], index) => {
    const y = 176 + index * 76;
    shape(slide, "Ellipse", { left: 64, top: y + 8, width: 56, height: 56 }, accent);
    addText(slide, String(index + 1), { left: 64, top: y + 22, width: 56, height: 28 }, 16, true, WHITE, "Center");
    line(slide, { left: 128, top: y + 36, width: 36, height: 0 }, accent, 1.5);
    addText(slide, heading, { left: 176, top: y, width: 220, height: 32 }, 16, true, ink);
    addText(slide, detail, { left: 176, top: y + 32, width: 736, height: 36 }, 14, false, muted);
  });
}

function hexagonColumns(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const width = 200;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + 16);
    const hex = slide.shapes.addGeometricShape("Hexagon", { left: x + 52, top: 180, width: 96, height: 88 });
    hex.fill.setSolidColor(index % 2 === 0 ? accent : "#111318");
    hex.lineFormat.visible = false;
    addText(slide, String(index + 1).padStart(2, "0"), { left: x + 52, top: 206, width: 96, height: 36 }, 16, true, WHITE, "Center");
    addText(slide, heading, { left: x, top: 284, width, height: 40 }, 18, true, ink, "Center");
    addText(slide, detail, { left: x, top: 328, width, height: 132 }, 13, false, muted, "Center");
  });
}

function iconBlocks(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const width = 272;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + 16);
    shape(slide, "RoundRectangle", { left: x + 86, top: 184, width: 100, height: 100 }, index === 1 ? "#111318" : accent);
    addText(slide, String(index + 1).padStart(2, "0"), { left: x + 86, top: 216, width: 100, height: 36 }, 20, true, WHITE, "Center");
    addText(slide, heading, { left: x, top: 304, width, height: 40 }, 18, true, ink, "Center");
    addText(slide, detail, { left: x + 12, top: 348, width: width - 24, height: 110 }, 14, false, muted, "Center");
  });
}

function openRingCallouts(slide, page) {
  const { ink, muted, accent } = chrome(slide, page.slide, page.title, page.subtitle, page.dark);
  const width = 272;
  page.items.forEach(([heading, detail], index) => {
    const x = 48 + index * (width + 16);
    const ring = slide.shapes.addGeometricShape("Donut", { left: x + 86, top: 184, width: 100, height: 100 });
    ring.fill.setSolidColor(accent);
    ring.lineFormat.visible = false;
    addText(slide, String(index + 1), { left: x + 86, top: 216, width: 100, height: 36 }, 18, true, ink, "Center");
    line(slide, { left: x + 136, top: 284, width: 0, height: 24 }, accent, 1.5);
    addText(slide, heading, { left: x, top: 312, width, height: 36 }, 18, true, ink, "Center");
    addText(slide, detail, { left: x + 8, top: 352, width: width - 16, height: 110 }, 14, false, muted, "Center");
  });
}

const CHARTS = {
  "trend-line-with-takeaway": {
    paint: paintTrend,
    data: {
      eyebrow: "TREND REVIEW",
      title: "完播拉起来后，播放量还在抬升",
      subtitle: "把近六周播放和互动放在同一张原生折线图里，只留一个可执行判断。",
      chartTitle: "周播放量与互动量",
      chartMatrix: [
        ["", "W1", "W2", "W3", "W4", "W5", "W6"],
        ["播放量", 86, 112, 148, 176, 214, 268],
        ["互动量", 18, 24, 31, 38, 49, 62],
      ],
      takeawayLabel: "核心判断",
      takeawayMetric: "+48%",
      takeawayText: "后三周播放量加速，互动同步上升。下一轮优先加码高完播的拆解栏目。",
      sourceText: ILLUSTRATIVE,
      recipeStamp: false,
    },
  },
  "kpi-plus-column": {
    paint: paintKpi,
    data: {
      eyebrow: "CONTENT BENCHMARK",
      title: "拆解类内容，正在拉开差距",
      subtitle: "左侧 KPI，右侧原生簇状柱图，不能把柱图改成等大卡片。",
      metricLabel: "最高互动率",
      metricValue: "8.4%",
      metricNote: "来自拆解栏目，较口播高 3.1 个百分点",
      chartTitle: "栏目播放与互动",
      chartMatrix: [
        ["", "教程", "拆解", "剧情", "口播"],
        ["播放量", 210, 286, 198, 164],
        ["互动量", 41, 72, 39, 28],
      ],
      takeaway: "拆解同时拿到更高播放和互动，下一周把同类钩子再做两支。",
      sourceText: ILLUSTRATIVE,
      recipeStamp: false,
    },
  },
  "share-donut-with-callouts": {
    paint: paintDonut,
    data: {
      eyebrow: "CONTENT MIX",
      title: "内容结构正在向可复用栏目集中",
      subtitle: "中心原生环图，右侧三条外部证据引线。",
      chartTitle: "近一个月内容结构",
      chartMatrix: [
        ["", "教程", "拆解", "剧情", "口播"],
        ["占比", 36, 27, 22, 15],
      ],
      centerValue: "63%",
      centerLabel: "可复用栏目",
      callouts: [
        { label: "教程", value: "36%", note: "最大产能，适合系列化" },
        { label: "拆解", value: "27%", note: "互动贡献最高" },
        { label: "剧情", value: "22%", note: "完播波动大，需控片头" },
      ],
      sourceText: ILLUSTRATIVE,
      recipeStamp: false,
    },
  },
  "dual-panel-chart-analysis": {
    paint: paintDual,
    data: {
      eyebrow: "CHART ANALYSIS",
      title: "规模增长和质量，要放在一起看",
      subtitle: "左右两张原生图，底部一条共用结论。",
      leftTitle: "周播放量",
      leftMatrix: [
        ["", "W1", "W2", "W3", "W4", "W5"],
        ["播放量", 86, 112, 148, 176, 214],
      ],
      rightTitle: "栏目互动率",
      rightMatrix: [
        ["", "教程", "拆解", "剧情", "口播"],
        ["互动率", 5.2, 8.4, 4.9, 5.3],
      ],
      takeaway: "播放量在涨，但增量主要来自拆解。扩产能时不要把口播比例抬回去。",
      sourceText: ILLUSTRATIVE,
      recipeStamp: false,
    },
  },
};

const PAINTERS = {
  "marker-columns": markerColumns,
  "editorial-grid": editorialGrid,
  "numbered-rows": numberedRows,
  "ring-labels": ringLabels,
  "linked-stages": linkedStages,
  "label-columns": labelColumns,
  "horizontal-axis": horizontalAxis,
  "branch-left": branchLeft,
  "separated-tiers": separatedTiers,
  "ticket-panels": ticketPanels,
  "rail-callouts": railCallouts,
  "hexagon-columns": hexagonColumns,
  "icon-blocks": iconBlocks,
  "open-ring-callouts": openRingCallouts,
};

export async function build(PowerPoint) {
  await PowerPoint.run(async (context) => {
    context.presentation.pageSetup.slideWidth = 960;
    context.presentation.pageSetup.slideHeight = 540;
    for (let index = 0; index < pages.pages.length; index += 1) {
      context.presentation.slides.add();
    }
    await context.sync();
    for (const page of pages.pages) {
      const slide = context.presentation.slides.getItemAt(page.slide - 1);
      if (page.chart) {
        const chart = CHARTS[page.signature];
        chart.paint(slide, chart.data);
        continue;
      }
      PAINTERS[page.signature](slide, page);
    }
    await context.sync();
  });
}
