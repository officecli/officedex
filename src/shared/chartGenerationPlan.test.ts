import { describe, expect, it } from "vitest";
import {
  chartGenerationPlanForNode,
  chartGenerationPlanToJson,
  chartGenerationPlanForTree,
} from "./chartGenerationPlan";
import type { VibeProjectTreeNode } from "./types";

const chartNode: VibeProjectTreeNode = {
  id: "slide-2",
  kind: "slide",
  title: "增长趋势",
  relation: "trend",
  chart: {
    type: "line",
    categories: ["一月", "二月"],
    values: [120, 180],
    source: { kind: "table", ref: "sheet1!A1:C2" },
  },
};

describe("chartGenerationPlan", () => {
  it("builds a chart plan item from an explicit structured relation", () => {
    expect(chartGenerationPlanForNode(chartNode)).toMatchObject({
      nodeId: "slide-2",
      title: "增长趋势",
      relation: "trend",
      visualRole: "chart",
      chartSpec: {
        chartType: "line",
        dataSource: { kind: "table", ref: "sheet1!A1:C2" },
      },
      chartMatrix: [
        ["", "一月", "二月"],
        ["系列 1", 120, 180],
      ],
    });
  });

  it("uses the caller-provided relation to select the focal-point spec", () => {
    expect(chartGenerationPlanForNode(chartNode, "trend")).toMatchObject({
      relation: "trend",
      chartSpec: {
        focalPoint: { kind: "chart", area: "right", weight: 0.62 },
      },
    });
  });

  it("uses the node relation when the caller does not provide a relation", () => {
    expect(chartGenerationPlanForNode(chartNode)).toMatchObject({
      relation: "trend",
      chartSpec: {
        focalPoint: { area: "right", weight: 0.62 },
      },
    });
  });

  it("returns only chart-bearing nodes for a tree", () => {
    expect(
      chartGenerationPlanForTree(
        {
          nodes: [
            chartNode,
            { id: "slide-3", kind: "slide", title: "结论" },
          ],
        },
        { "slide-2": "comparison" },
      ),
    ).toMatchObject([
      {
        nodeId: "slide-2",
        relation: "comparison",
        chartSpec: { chartType: "line" },
      },
    ]);
  });

  it("serializes the plan with the snake_case contract used by Skill", () => {
    expect(
      chartGenerationPlanToJson(
        { nodes: [chartNode] },
        { "slide-2": "trend" },
      ),
    ).toEqual([
      {
        node_id: "slide-2",
        title: "增长趋势",
        relation: "trend",
        visual_role: "chart",
        chart_spec: {
          chart_type: "line",
          data_source: { kind: "table", ref: "sheet1!A1:C2" },
          focal_point: { kind: "chart", area: "right", weight: 0.62 },
          content_budget: {
            title_chars: 0,
            categories: 2,
            series: 1,
            annotation_lines: 3,
          },
          illustrative: false,
        },
        chart_matrix: [
          ["", "一月", "二月"],
          ["系列 1", 120, 180],
        ],
        recipe_route: {
          status: "selected_experimental",
          recipe_id: "trend-line-with-takeaway",
          module_path:
            "skills/aippt-jssdk-design/chart/experimental/trend-line-with-takeaway.mjs",
          generation_ready: true,
          reason:
            "structured relation=trend selects the native line trend drawer",
        },
        recipe_evidence: {
          status: "needs_source_evidence",
          source_kind: "training_fixture",
          source_paths: expect.arrayContaining([
            "sampleall/chart/基础属性/折线图/折线图.pptx",
          ]),
          source_digests: expect.arrayContaining([
            "sha256:3bc033dcec50fcd78d48cb975cace7723ea86e0efadcd0dcd73986c2117940cc",
          ]),
          reconstruction_program:
            "skills/aippt-jssdk-design/chart/evidence/trend-line-source-reconstruction.mjs",
          verification_report:
            "skills/aippt-jssdk-design/chart/evidence/trend-line-source-reconstruction.verification.json",
          candidate_raw_ssim: 0.9589008277587888,
          missing: expect.arrayContaining(["visual review"]),
          reason: expect.stringContaining("rawSsim=0.9589"),
        },
        generation_gate: {
          status: "preview_allowed",
          allowed: true,
          reason: expect.stringContaining("Native chart Skill preview"),
        },
      },
    ]);
  });
});
