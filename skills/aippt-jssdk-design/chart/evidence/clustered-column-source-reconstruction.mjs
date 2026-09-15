export const generationMode = "template_fidelity";
export const family = "chart_comparison";
export const variant = "clustered-column-source-reconstruction";
export const status = "source_reconstruction_candidate";
export const generationReady = false;

export const layoutSpec = {
  slide: { width: 960, height: 540 },
  source: "sampleall/chart/基础属性/簇状柱形图/簇状柱形图/幻灯片20.png",
  requiredGeometry: ["native_column_chart"],
  chartBounds: { left: 210.7, top: 114.1, width: 538.55, height: 311.8 },
  sourceMechanism: "native_clustered_column_default_style",
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
      data: SOURCE_MATRIX,
      left: 210.7,
      top: 114.1,
      width: 538.55,
      height: 311.8,
    });
    chart.name = "native_column_chart";
    await context.sync();
  });
}
