export const generationMode = "template_fidelity";
export const family = "chart_analysis";
export const variant = "combo-source-reconstruction";
export const status = "source_reconstruction_candidate";
export const generationReady = false;

export const layoutSpec = {
  slide: { width: 960, height: 540 },
  source:
    "sampleall/chart/基础属性/簇状柱形图&次坐标轴上的折线图/簇状柱形图&次坐标轴上的折线图/幻灯片2.png",
  requiredGeometry: ["native_combo_chart"],
  chartBounds: { left: 210.7, top: 114.1, width: 538.55, height: 311.8 },
  sourceMechanism: "native_combo_column_line_secondary_axis",
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
      data: SOURCE_MATRIX,
      left: 210.7,
      top: 114.1,
      width: 538.55,
      height: 311.8,
    });
    chart.name = "native_combo_chart";
    await context.sync();
  });
}
