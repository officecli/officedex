import { paintSlide as paintTrend } from "./experimental/trend-line-with-takeaway.mjs";
import { paintSlide as paintKpi } from "./experimental/kpi-plus-column.mjs";
import { paintSlide as paintDonut } from "./experimental/share-donut-with-callouts.mjs";
import { paintSlide as paintDual } from "./experimental/dual-panel-chart-analysis.mjs";

export const generationMode = "hybrid";
export const family = "chart";
export const variant = "skill-preview-deck";
export const status = "native_chart_preview";
export const generationReady = true;

const SLIDES = [
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

export async function build(PowerPoint, data = {}) {
  const slides = Array.isArray(data?.slides) ? data.slides : SLIDES;
  await PowerPoint.run(async (context) => {
    context.presentation.pageSetup.slideWidth = 960;
    context.presentation.pageSetup.slideHeight = 540;
    for (let index = 0; index < slides.length; index += 1) {
      context.presentation.slides.add();
    }
    await context.sync();
    slides.forEach((entry, index) => {
      entry.paint(context.presentation.slides.getItemAt(index), entry.data);
    });
    await context.sync();
  });
}
