import type {
  VibeChartGenerationPlanItem,
  VibeChartRelation,
} from "./types";

export type ExperimentalChartRecipeId =
  | "trend-line-with-takeaway"
  | "kpi-plus-column"
  | "share-donut-with-callouts"
  | "dual-panel-chart-analysis";

export interface ChartRecipeRoute {
  status: "selected_experimental" | "needs_source_evidence";
  recipeId?: ExperimentalChartRecipeId;
  modulePath?: string;
  generationReady: boolean;
  reason: string;
}

const MODULE_ROOT =
  "skills/aippt-jssdk-design/chart/experimental";

const ROUTES: Record<ExperimentalChartRecipeId, string> = {
  "trend-line-with-takeaway": `${MODULE_ROOT}/trend-line-with-takeaway.mjs`,
  "kpi-plus-column": `${MODULE_ROOT}/kpi-plus-column.mjs`,
  "share-donut-with-callouts": `${MODULE_ROOT}/share-donut-with-callouts.mjs`,
  "dual-panel-chart-analysis": `${MODULE_ROOT}/dual-panel-chart-analysis.mjs`,
};

function selected(
  recipeId: ExperimentalChartRecipeId,
  reason: string,
): ChartRecipeRoute {
  return {
    status: "selected_experimental",
    recipeId,
    modulePath: ROUTES[recipeId],
    generationReady: true,
    reason,
  };
}

function blocked(reason: string): ChartRecipeRoute {
  return {
    status: "needs_source_evidence",
    generationReady: false,
    reason,
  };
}

/**
 * Route a structured chart plan to an experimental free/hybrid drawer.
 *
 * This intentionally uses only relation and normalized chart capacity. It
 * never guesses from a title or silently promotes an experimental drawer to
 * a generation-ready registry recipe.
 */
export function routeExperimentalChartRecipe(
  item: Pick<
    VibeChartGenerationPlanItem,
    "relation" | "chartSpec"
  >,
): ChartRecipeRoute {
  const { relation, chartSpec } = item;
  if (relation === "trend") {
    return selected(
      "trend-line-with-takeaway",
      "structured relation=trend selects the native line trend drawer",
    );
  }
  if (relation === "comparison") {
    return selected(
      "kpi-plus-column",
      "structured relation=comparison selects the KPI plus native column drawer",
    );
  }
  if (relation === "distribution") {
    return selected(
      "share-donut-with-callouts",
      "structured relation=distribution selects the native donut callout drawer",
    );
  }
  if (
    relation === "other" &&
    chartSpec.contentBudget.series >= 2 &&
    chartSpec.contentBudget.categories >= 3
  ) {
    return selected(
      "dual-panel-chart-analysis",
      "multi-series chart capacity selects the dual-panel analysis drawer",
    );
  }
  return blocked(
    `No evidence-backed experimental drawer for relation=${relation}; chart registry remains blocked`,
  );
}

export function chartRecipeRouteForRelation(
  relation: VibeChartRelation,
): ChartRecipeRoute {
  return routeExperimentalChartRecipe({
    relation,
    chartSpec: {
      visualRole: "chart",
      chartType: relation === "distribution" ? "donut" : "line",
      dataSource: { kind: "manual" },
      focalPoint: { kind: "chart", area: "full", weight: 0.6 },
      contentBudget: {
        titleChars: 18,
        categories: relation === "other" ? 4 : 6,
        series: relation === "other" ? 2 : 1,
        annotationLines: 3,
      },
      illustrative: true,
    },
  });
}
