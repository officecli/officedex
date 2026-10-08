import { describe, expect, it } from "vitest";
import {
  chartGenerationSpec,
  normalizeVibeChart,
  vibeChartToJssdkMatrix,
  VibeChartModelError,
} from "./chartModel";

describe("normalizeVibeChart", () => {
  it("upgrades the legacy categories and values form to one series", () => {
    expect(
      normalizeVibeChart({
        type: "line",
        categories: ["一月", "二月"],
        values: [12, 18],
        title: "播放量趋势",
      }),
    ).toMatchObject({
      type: "line",
      categories: ["一月", "二月"],
      series: [{ name: "系列 1", values: [12, 18], axis: "primary" }],
      source: { kind: "manual" },
    });
  });

  it("normalizes chart options without losing semantic aliases", () => {
    expect(
      normalizeVibeChart({
        categories: ["A", "B"],
        series: [{ name: "转化率", values: [0.2, 0.4], axis: "secondary" }],
        options: {
          legend: "bottom",
          dataLabels: "value",
          stacked: true,
        },
        source: { kind: "table", ref: "sheet1!A1:C2" },
      }),
    ).toMatchObject({
      type: "column",
      options: {
        legend: "bottom",
        legendVisible: true,
        legendPosition: "bottom",
        dataLabels: "value",
        showValueLabels: true,
        stacked: true,
      },
      source: { kind: "table", ref: "sheet1!A1:C2" },
    });
  });

  it("rejects mismatched categories and series values", () => {
    expect(() =>
      normalizeVibeChart({
        categories: ["A", "B"],
        series: [{ name: "销量", values: [1] }],
      }),
    ).toThrow(VibeChartModelError);
  });

  it("rejects an unsupported chart type instead of silently falling back", () => {
    expect(() =>
      normalizeVibeChart({
        type: "unsupported-chart",
        values: [1, 2],
      }),
    ).toThrow(/supported native chart types/u);
  });

  it("creates an addChart matrix with categories and series names", () => {
    const chart = normalizeVibeChart({
      type: "column",
      categories: ["一月", "二月"],
      series: [
        { name: "播放量", values: [120, 180] },
        { name: "互动量", values: [42, 66] },
      ],
    });
    expect(vibeChartToJssdkMatrix(chart)).toEqual([
      ["", "一月", "二月"],
      ["播放量", 120, 180],
      ["互动量", 42, 66],
    ]);
  });

  it("creates a page-level chart generation spec", () => {
    expect(
      chartGenerationSpec(
        {
          type: "line",
          categories: ["一月", "二月", "三月"],
          values: [10, 18, 24],
          source: { kind: "table", ref: "sheet1!A1:D2" },
          illustrative: true,
        },
        "trend",
      ),
    ).toMatchObject({
      visualRole: "chart",
      chartType: "line",
      dataSource: { kind: "table", ref: "sheet1!A1:D2" },
      focalPoint: { kind: "chart", area: "right", weight: 0.62 },
      contentBudget: { categories: 3, series: 1 },
      illustrative: true,
    });
  });
});
