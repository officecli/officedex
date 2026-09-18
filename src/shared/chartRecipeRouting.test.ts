import { describe, expect, it } from "vitest";

import {
  chartRecipeRouteForRelation,
  routeExperimentalChartRecipe,
} from "./chartRecipeRouting";

describe("chartRecipeRouting", () => {
  it("routes structured trend/comparison/distribution relations", () => {
    expect(chartRecipeRouteForRelation("trend")).toMatchObject({
      status: "selected_experimental",
      recipeId: "trend-line-with-takeaway",
      generationReady: true,
    });
    expect(chartRecipeRouteForRelation("comparison")).toMatchObject({
      status: "selected_experimental",
      recipeId: "kpi-plus-column",
    });
    expect(chartRecipeRouteForRelation("distribution")).toMatchObject({
      status: "selected_experimental",
      recipeId: "share-donut-with-callouts",
    });
  });

  it("routes a multi-series unknown relation to dual-panel analysis", () => {
    expect(chartRecipeRouteForRelation("other")).toMatchObject({
      status: "selected_experimental",
      recipeId: "dual-panel-chart-analysis",
      modulePath:
        "skills/aippt-jssdk-design/chart/experimental/dual-panel-chart-analysis.mjs",
    });
  });

  it("does not guess unsupported correlation pages into a chart drawer", () => {
    expect(chartRecipeRouteForRelation("correlation")).toMatchObject({
      status: "needs_source_evidence",
      generationReady: false,
    });
  });

  it("keeps the decision based on normalized capacity, not title text", () => {
    expect(
      routeExperimentalChartRecipe({
        relation: "other",
        chartSpec: {
          visualRole: "chart",
          chartType: "line",
          dataSource: { kind: "table", ref: "sheet1!A1:C5" },
          focalPoint: { kind: "chart", area: "left", weight: 0.62 },
          contentBudget: {
            titleChars: 18,
            categories: 2,
            series: 1,
            annotationLines: 1,
          },
          illustrative: false,
        },
      }),
    ).toMatchObject({
      status: "needs_source_evidence",
    });
  });
});
