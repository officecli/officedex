import { paintSlide as paintTrend } from "./experimental/trend-line-with-takeaway.mjs";
import { paintSlide as paintKpi } from "./experimental/kpi-plus-column.mjs";
import { paintSlide as paintDonut } from "./experimental/share-donut-with-callouts.mjs";
import { paintSlide as paintDual } from "./experimental/dual-panel-chart-analysis.mjs";

export const generationMode = "hybrid";
export const family = "chart";
export const variant = "native-chart-test-deck";
export const status = "native_chart_preview";
export const generationReady = true;

const SAMPLE_MATRIX = [
  ["", "类别1", "类别2", "类别3", "类别4"],
  ["系列 1", 4.3, 2.5, 3.5, 4.5],
  ["系列 2", 2.4, 4.4, 1.8, 2.8],
  ["系列 3", 2, 2, 3, 5],
];

const CHART_BOUNDS = {
  left: 210.7,
  top: 114.1,
  width: 538.55,
  height: 311.8,
};

function caption(slide, text) {
  const shape = slide.shapes.addTextBox(text, {
    left: 36,
    top: 508,
    width: 888,
    height: 18,
  });
  shape.name = "test-caption";
  shape.fill.clear();
  shape.lineFormat.visible = false;
  shape.textFrame.textRange.text = text;
  shape.textFrame.textRange.font.size = 9;
  shape.textFrame.textRange.font.color = "#6B7280";
}

function paintLineReconstruction(slide) {
  slide.background.fill.setSolidFill({ color: "#FFFFFF" });
  const chart = slide.shapes.addChart({
    chartType: "line",
    title: "图表标题",
    legendVisible: true,
    legendPosition: "top",
    smooth: true,
    markerVisible: false,
    seriesColors: ["5082FF", "19CD8B", "FDCA2A"],
    chartFillPattern: {
      pattern: "lgGrid",
      backgroundColor: "FFFFFF",
      foregroundColor: "F2F2F2",
    },
    chartLineColor: "DFDFDF",
    chartLineWidth: 0.5,
    plotFillColor: "FFFFFF",
    plotLayout: {
      layoutX: 0.037,
      layoutY: 0.2,
      layoutWidth: 0.941,
      layoutHeight: 0.719,
    },
    plotShadow: {
      color: "000000",
      alpha: 0.2,
      blur: 4,
      distance: 3,
      direction: 45,
    },
    categoryGridlinesVisible: false,
    valueGridlinesVisible: false,
    valueAxisLineVisible: false,
    categoryAxisLineVisible: false,
    textFontSize: 9,
    textColor: "404040",
    chartFontFamily: "Microsoft YaHei",
    titleCenterY: 0.032,
    legendCenterY: 0.092,
    data: SAMPLE_MATRIX,
    seriesLineWidth: 2,
    ...CHART_BOUNDS,
  });
  chart.name = "native_line_chart";
  caption(slide, "1/8  source reconstruction  ·  trend line  ·  rawSsim 0.9589");
}

function paintColumnReconstruction(slide) {
  slide.background.fill.setSolidFill({ color: "#FFFFFF" });
  const chart = slide.shapes.addChart({
    chartType: "column",
    title: "图表标题",
    legendVisible: true,
    legendPosition: "top",
    seriesColors: ["C8997C", "ADBCC2", "81A190"],
    chartFillColor: "F5F5F5",
    chartLineColor: "DFDFDF",
    chartLineWidth: 0.5,
    plotFillColor: "FFFFFF",
    plotLayout: {
      layoutX: 0.022,
      layoutY: 0.2,
      layoutWidth: 0.956,
      layoutHeight: 0.719,
    },
    categoryGridlinesVisible: false,
    valueGridlinesVisible: false,
    valueAxisVisible: false,
    valueAxisLineVisible: false,
    categoryAxisLineColor: "DFDFDF",
    categoryAxisLineWidth: 0.5,
    dataLabelsVisible: true,
    dataLabelPosition: "outsideEnd",
    gapWidth: 360,
    overlap: -30,
    textFontSize: 9,
    textColor: "404040",
    chartFontFamily: "Microsoft YaHei",
    titleCenterY: 0.032,
    legendCenterY: 0.092,
    data: SAMPLE_MATRIX,
    ...CHART_BOUNDS,
  });
  chart.name = "native_column_chart";
  caption(
    slide,
    "2/8  source reconstruction  ·  clustered column  ·  rawSsim 0.9570",
  );
}

function paintDonutReconstruction(slide) {
  slide.background.fill.setSolidFill({ color: "#FFFFFF" });
  const chart = slide.shapes.addChart({
    chartType: "donut",
    title: "销售额",
    legendVisible: false,
    seriesColors: ["FDE2CB", "E4C4D6", "D5BCC4", "89A5CD"],
    chartFillColor: "FFFFFF",
    chartLineColor: "DFDFDF",
    chartLineWidth: 0.5,
    holeSize: 75,
    firstSliceAngle: 136,
    dataLabelsVisible: true,
    textFontSize: 9,
    textColor: "404040",
    chartFontFamily: "Microsoft YaHei",
    titleCenterY: 0.06,
    data: [
      ["", "第一季度", "第二季度", "第三季度", "第四季度"],
      ["销售额", 8.2, 3.2, 1.4, 1.2],
    ],
    ...CHART_BOUNDS,
  });
  chart.name = "native_donut_chart";
  caption(slide, "3/8  source reconstruction  ·  donut  ·  rawSsim 0.9740");
}

function paintComboReconstruction(slide) {
  slide.background.fill.setSolidFill({ color: "#FFFFFF" });
  const chart = slide.shapes.addChart({
    chartType: "combo",
    title: "图表标题",
    legendVisible: true,
    legendPosition: "top",
    seriesColors: ["F2B600", "3787FF", "F08BB4"],
    chartFillColor: "FFFFFF",
    chartLineColor: "DFDFDF",
    chartLineWidth: 0.5,
    plotLayout: {
      layoutX: 0.035,
      layoutY: 0.198,
      layoutWidth: 0.914,
      layoutHeight: 0.728,
    },
    categoryGridlinesVisible: true,
    valueGridlinesVisible: false,
    plotLineColor: "E6E6E6",
    categoryAxisLineColor: "DFDFDF",
    categoryAxisLineWidth: 0.5,
    secondaryValueAxisMajorUnit: 0.5,
    dataLabelsVisible: true,
    dataLabelPosition: "outsideEnd",
    gapWidth: 150,
    overlap: -20,
    textFontSize: 9,
    textColor: "404040",
    chartFontFamily: "Microsoft YaHei",
    comboSeries: [
      {
        chartType: "line",
        axis: "secondary",
        markerVisible: true,
        lineDash: "sysDash",
        lineWidth: 1,
        dataLabelsVisible: false,
      },
      {
        chartType: "column",
        axis: "primary",
        dataLabelsVisible: true,
        lineColor: "005DE9",
        lineWidth: 0.75,
      },
      {
        chartType: "column",
        axis: "primary",
        dataLabelsVisible: true,
        lineColor: "E5377E",
        lineWidth: 0.75,
      },
    ],
    data: SAMPLE_MATRIX,
    ...CHART_BOUNDS,
  });
  chart.name = "native_combo_chart";
  caption(slide, "4/8  source reconstruction  ·  combo  ·  rawSsim 0.9553");
}

const SLIDES = [
  { paint: paintLineReconstruction },
  { paint: paintColumnReconstruction },
  { paint: paintDonutReconstruction },
  { paint: paintComboReconstruction },
  {
    paint: paintTrend,
    data: {
      title: "短视频内容表现持续走高",
      subtitle: "原生折线图承载趋势，右侧只保留一个可验证判断。",
      chartTitle: "播放量与互动量趋势",
      chartMatrix: [
        ["", "1月", "2月", "3月", "4月", "5月", "6月"],
        ["播放量", 118, 160, 208, 236, 304, 358],
        ["互动量", 28, 42, 54, 61, 86, 102],
      ],
      takeawayMetric: "+51%",
      sourceText: "Source: table://tiktok-monthly-performance",
    },
  },
  {
    paint: paintKpi,
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
  },
  {
    paint: paintDonut,
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
  },
  {
    paint: paintDual,
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
  },
];

export async function build(PowerPoint) {
  await PowerPoint.run(async (context) => {
    context.presentation.pageSetup.slideWidth = 960;
    context.presentation.pageSetup.slideHeight = 540;
    for (let index = 0; index < SLIDES.length; index += 1) {
      context.presentation.slides.add();
    }
    await context.sync();
    SLIDES.forEach((entry, index) => {
      entry.paint(context.presentation.slides.getItemAt(index), entry.data);
    });
    await context.sync();
  });
}
