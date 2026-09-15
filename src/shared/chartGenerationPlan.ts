import {
  chartGenerationSpec,
  normalizeVibeChart,
  vibeChartToJssdkMatrix,
} from "./chartModel";
import {
  chartFormalGenerationGate,
  chartRecipeEvidenceSummary,
} from "./chartRecipeEvidence";
import { routeExperimentalChartRecipe } from "./chartRecipeRouting";
import type {
  VibeChartGenerationPlanItem,
  VibeChartRelation,
  VibeProjectTree,
  VibeProjectTreeNode,
} from "./types";

export interface ChartRelationMap {
  [nodeId: string]: VibeChartRelation | undefined;
}

export interface ChartGenerationPlanJson {
  node_id: string;
  title: string;
  relation: VibeChartRelation;
  visual_role: "chart" | "chart_supporting" | "metric_only";
  chart_spec: {
    chart_type: string;
    data_source: { kind: string; ref?: string };
    focal_point: {
      kind: "chart";
      area: "left" | "center" | "right" | "full";
      weight: number;
    };
    content_budget: {
      title_chars: number;
      categories: number;
      series: number;
      annotation_lines: number;
    };
    illustrative: boolean;
  };
  chart_matrix: Array<Array<string | number>>;
  recipe_route: {
    status: "selected_experimental" | "needs_source_evidence";
    recipe_id?: string;
    module_path?: string;
    generation_ready: boolean;
    reason: string;
  };
  recipe_evidence: {
    status: "high_similarity_verified" | "needs_source_evidence";
    source_kind: "training_fixture";
    source_paths: string[];
    source_digests?: string[];
    raw_ssim?: number;
    missing: string[];
    reason: string;
  };
  generation_gate: {
    status: "blocked" | "allowed" | "preview_allowed";
    allowed: boolean;
    reason: string;
  };
}

function relationForNode(
  node: VibeProjectTreeNode,
  relationMap: ChartRelationMap | undefined,
): VibeChartRelation {
  return relationMap?.[node.id] ?? node.relation ?? "other";
}

/**
 * Build the chart portion of generation-plan from an already structured tree.
 *
 * The caller must provide relation when it is known; this adapter deliberately
 * does not infer trend/comparison/distribution from natural-language text.
 */
export function chartGenerationPlanForNode(
  node: VibeProjectTreeNode,
  relation?: VibeChartRelation,
): VibeChartGenerationPlanItem | undefined {
  if (!node.chart) return undefined;
  const resolvedRelation = relation ?? node.relation ?? "other";
  const chart = normalizeVibeChart(node.chart, `node[${node.id}].chart`);
  const chartSpec = chartGenerationSpec(chart, resolvedRelation);
  return {
    nodeId: node.id,
    title: node.title,
    relation: resolvedRelation,
    visualRole: chartSpec.visualRole,
    chartSpec,
    chartMatrix: vibeChartToJssdkMatrix(chart),
  };
}

export function chartGenerationPlanForTree(
  tree: Pick<VibeProjectTree, "nodes">,
  relationMap?: ChartRelationMap,
): VibeChartGenerationPlanItem[] {
  return tree.nodes.flatMap((node) => {
    const item = chartGenerationPlanForNode(node, relationForNode(node, relationMap));
    return item ? [item] : [];
  });
}

export function chartGenerationPlanItemToJson(
  item: VibeChartGenerationPlanItem,
): ChartGenerationPlanJson {
  const { chartSpec } = item;
  const recipeRoute = routeExperimentalChartRecipe(item);
  const recipeEvidence = recipeRoute.recipeId
    ? chartRecipeEvidenceSummary(recipeRoute.recipeId)
    : undefined;
  const generationGate = recipeRoute.recipeId
    ? chartFormalGenerationGate(recipeRoute.recipeId)
    : {
        status: "blocked" as const,
        allowed: false,
        reason: "No experimental recipe route exists for this chart relation.",
      };
  return {
    node_id: item.nodeId,
    title: item.title,
    relation: item.relation,
    visual_role: item.visualRole,
    chart_spec: {
      chart_type: String(chartSpec.chartType),
      data_source: chartSpec.dataSource,
      focal_point: chartSpec.focalPoint,
      content_budget: {
        title_chars: chartSpec.contentBudget.titleChars,
        categories: chartSpec.contentBudget.categories,
        series: chartSpec.contentBudget.series,
        annotation_lines: chartSpec.contentBudget.annotationLines,
      },
      illustrative: chartSpec.illustrative,
    },
    chart_matrix: item.chartMatrix,
    recipe_route: {
      status: recipeRoute.status,
      ...(recipeRoute.recipeId ? { recipe_id: recipeRoute.recipeId } : {}),
      ...(recipeRoute.modulePath ? { module_path: recipeRoute.modulePath } : {}),
      generation_ready: recipeRoute.generationReady,
      reason: recipeRoute.reason,
    },
    recipe_evidence: recipeEvidence ?? {
      status: "needs_source_evidence",
      source_kind: "training_fixture",
      source_paths: [],
      missing: ["recipe route"],
      reason: "No experimental recipe route exists for this chart relation.",
    },
    generation_gate: generationGate,
  };
}

export function chartGenerationPlanToJson(
  tree: Pick<VibeProjectTree, "nodes">,
  relationMap?: ChartRelationMap,
): ChartGenerationPlanJson[] {
  return chartGenerationPlanForTree(tree, relationMap).map(
    chartGenerationPlanItemToJson,
  );
}
