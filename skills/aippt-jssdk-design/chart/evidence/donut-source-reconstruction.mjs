export const generationMode = "template_fidelity";
export const family = "chart_distribution";
export const variant = "donut-source-reconstruction";
export const status = "source_reconstruction_candidate";
export const generationReady = false;

export const layoutSpec = {
  slide: { width: 960, height: 540 },
  source: "sampleall/chart/基础属性/圆环圆/圆环图/幻灯片2.png",
  requiredGeometry: ["native_donut_chart"],
  chartBounds: { left: 210.7, top: 114.1, width: 538.55, height: 311.8 },
  sourceMechanism: "native_donut_default_style",
};

const SOURCE_MATRIX = [
  ["", "第一季度", "第二季度", "第三季度", "第四季度"],
  ["销售额", 8.2, 3.2, 1.4, 1.2],
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
      data: SOURCE_MATRIX,
      left: 210.7,
      top: 114.1,
      width: 538.55,
      height: 311.8,
    });
    chart.name = "native_donut_chart";
    await context.sync();
  });
}
