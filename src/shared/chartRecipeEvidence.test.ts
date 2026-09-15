import { describe, expect, it } from "vitest";
import { accessSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  chartFormalGenerationGate,
  chartRecipeEvidenceFor,
  chartRecipeEvidenceSummary,
} from "./chartRecipeEvidence";
import type { ExperimentalChartRecipeId } from "./chartRecipeRouting";

const OFFICEDEX_ROOT = process.cwd();
const REPO_ROOT = resolve(OFFICEDEX_ROOT, "..");
const INVENTORY_PATH = join(
  OFFICEDEX_ROOT,
  "skills/aippt-jssdk-design/chart/evidence-inventory.json",
);

interface InventoryRecipe {
  recipe_id: ExperimentalChartRecipeId;
  status: "needs_source_evidence";
  source_kind: "training_fixture";
  source_paths: string[];
  source_digests: string[];
  missing: string[];
}

interface EvidenceInventory {
  recipes: InventoryRecipe[];
}

function loadInventory(): EvidenceInventory {
  return JSON.parse(readFileSync(INVENTORY_PATH, "utf8")) as EvidenceInventory;
}

describe("chartRecipeEvidence", () => {
  it("indexes training fixtures without treating them as admitted evidence", () => {
    const evidence = chartRecipeEvidenceFor("trend-line-with-takeaway");
    expect(evidence.sourceKind).toBe("training_fixture");
    expect(evidence.sourcePaths).toEqual(
      expect.arrayContaining([
        "sampleall/chart/基础属性/折线图/折线图.pptx",
      ]),
    );
    expect(evidence.status).toBe("needs_source_evidence");
    expect(evidence.reconstructionProgram).toContain(
      "trend-line-source-reconstruction.mjs",
    );
    expect(evidence.candidateRawSsim).toBeGreaterThan(0.95);
    expect(evidence.missing).toEqual(
      expect.arrayContaining(["visual review"]),
    );
  });

  it("serializes a plan-safe evidence summary", () => {
    expect(chartRecipeEvidenceSummary("share-donut-with-callouts")).toMatchObject({
      status: "needs_source_evidence",
      source_kind: "training_fixture",
      reconstruction_program:
        "skills/aippt-jssdk-design/chart/evidence/donut-source-reconstruction.mjs",
      candidate_raw_ssim: 0.9740458406794126,
      missing: expect.arrayContaining(["visual review"]),
    });
    expect(chartRecipeEvidenceSummary("share-donut-with-callouts").missing).toEqual(
      ["visual review"],
    );
  });

  it("allows Skill preview generation while source SSIM is still a candidate", () => {
    expect(chartFormalGenerationGate("kpi-plus-column")).toEqual({
      status: "preview_allowed",
      allowed: true,
      reason: expect.stringContaining("Native chart Skill preview"),
    });
  });

  it("keeps runtime evidence aligned with the static inventory", () => {
    for (const inventoryRecipe of loadInventory().recipes) {
      const evidence = chartRecipeEvidenceFor(inventoryRecipe.recipe_id);
      expect(evidence.status).toBe(inventoryRecipe.status);
      expect(evidence.sourceKind).toBe(inventoryRecipe.source_kind);
      expect(evidence.sourcePaths).toEqual(inventoryRecipe.source_paths);
      expect(evidence.sourceDigests).toEqual(inventoryRecipe.source_digests);
      expect(evidence.missing).toEqual(inventoryRecipe.missing);
      for (const sourcePath of evidence.sourcePaths) {
        expect(() => accessSync(join(REPO_ROOT, sourcePath))).not.toThrow();
      }
    }
  });
});
