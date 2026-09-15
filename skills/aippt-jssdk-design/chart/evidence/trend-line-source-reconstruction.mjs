export const generationMode = "template_fidelity";
export const family = "chart_trend";
export const variant = "trend-line-source-reconstruction";
export const status = "source_reconstruction_candidate";
export const generationReady = false;

export const layoutSpec = {
  slide: { width: 960, height: 540 },
  source: "sampleall/chart/基础属性/折线图/折线图/幻灯片20.png",
  requiredGeometry: ["native_line_chart"],
  chartBounds: { left: 210, top: 114, width: 540, height: 313 },
  sourceMechanism: "native_line_chart_default_style",
};

const SOURCE_MATRIX = [
  ["", "类别1", "类别2", "类别3", "类别4"],
  ["系列 1", 4.3, 2.5, 3.5, 4.5],
  ["系列 2", 2.4, 4.4, 1.8, 2.8],
  ["系列 3", 2, 2, 3, 5],
];

export async function build(PowerPoint) {
  await PowerPoint.run(async (context) => {
    context.presentation.pageSetup.slideWidth = 960;
    context.presentation.pageSetup.slideHeight = 540;
    context.presentation.slides.add();
    await context.sync();

    const slide = context.presentation.slides.getItemAt(0);
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
      data: SOURCE_MATRIX,
      left: 210.7,
      top: 114.1,
      width: 538.55,
      height: 311.8,
      seriesLineWidth: 2,
    });
    chart.name = "native_line_chart";
    await context.sync();
  });
}
