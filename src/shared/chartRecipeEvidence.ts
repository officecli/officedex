import type { ExperimentalChartRecipeId } from "./chartRecipeRouting";

export type ChartRecipeEvidenceStatus =
  | "high_similarity_verified"
  | "needs_source_evidence";

export interface ChartRecipeEvidenceRecord {
  recipeId: ExperimentalChartRecipeId;
  sourceKind: "training_fixture";
  status: ChartRecipeEvidenceStatus;
  sourcePaths: string[];
  sourceDigests?: string[];
  reconstructionProgram?: string;
  verificationReport?: string;
  candidateRawSsim?: number;
  rawSsim?: number;
  missing: string[];
  reason: string;
}

export interface ChartFormalGenerationGate {
  status: "blocked" | "allowed" | "preview_allowed";
  allowed: boolean;
  reason: string;
}

const TRAINING_FIXTURE_ROOT = "sampleall/chart/基础属性";

/**
 * Training assets are visual references only until a standalone JSSDK
 * reconstruction has a verified source report and visual review.
 */
const EVIDENCE: Record<ExperimentalChartRecipeId, ChartRecipeEvidenceRecord> = {
  "trend-line-with-takeaway": {
    recipeId: "trend-line-with-takeaway",
    sourceKind: "training_fixture",
    status: "needs_source_evidence",
    sourcePaths: [
      `${TRAINING_FIXTURE_ROOT}/折线图/折线图.pptx`,
      `${TRAINING_FIXTURE_ROOT}/折线图/折线图/幻灯片20.png`,
    ],
    sourceDigests: [
      "sha256:3bc033dcec50fcd78d48cb975cace7723ea86e0efadcd0dcd73986c2117940cc",
      "sha256:f957df2001a3652644385729dd3b312e47f3896f38a054ad11133ee285fa109f",
    ],
    reconstructionProgram:
      "skills/aippt-jssdk-design/chart/evidence/trend-line-source-reconstruction.mjs",
    verificationReport:
      "skills/aippt-jssdk-design/chart/evidence/trend-line-source-reconstruction.verification.json",
    candidateRawSsim: 0.9589008277587888,
    missing: ["visual review"],
    reason:
      "Native reconstruction rawSsim=0.9589 exceeds 0.95; visual review is still required before high_similarity_verified.",
  },
  "kpi-plus-column": {
    recipeId: "kpi-plus-column",
    sourceKind: "training_fixture",
    status: "needs_source_evidence",
    sourcePaths: [
      `${TRAINING_FIXTURE_ROOT}/簇状柱形图/簇状柱形图.pptx`,
      `${TRAINING_FIXTURE_ROOT}/簇状柱形图/簇状柱形图/幻灯片20.png`,
    ],
    sourceDigests: [
      "sha256:deb25cb67ff43e7473ee2ff81902ed0ffd9f47a3a6d094ef3a8e2612b09a8576",
      "sha256:2c2d87ee1a42f068685a76e2f8dff655a78c4da86ff816b6ae7d5ab87853ced8",
    ],
    reconstructionProgram:
      "skills/aippt-jssdk-design/chart/evidence/clustered-column-source-reconstruction.mjs",
    verificationReport:
      "skills/aippt-jssdk-design/chart/evidence/clustered-column-source-reconstruction.verification.json",
    candidateRawSsim: 0.9569992909247667,
    missing: ["visual review"],
    reason:
      "Native reconstruction rawSsim=0.9570 exceeds 0.95; visual review is still required because source bars use gradient fills.",
  },
  "share-donut-with-callouts": {
    recipeId: "share-donut-with-callouts",
    sourceKind: "training_fixture",
    status: "needs_source_evidence",
    sourcePaths: [
      `${TRAINING_FIXTURE_ROOT}/圆环圆/圆环图.pptx`,
      `${TRAINING_FIXTURE_ROOT}/圆环圆/圆环图/幻灯片2.png`,
    ],
    sourceDigests: [
      "sha256:93b1f6b7c6548ddb0ae8a442318d86f6ece68561172da982afd1398ce2857a50",
      "sha256:1696483e1c4bcd74e9c23c12fe4a78ea823ad4c8d39df09ffdc72c2e19368b29",
    ],
    reconstructionProgram:
      "skills/aippt-jssdk-design/chart/evidence/donut-source-reconstruction.mjs",
    verificationReport:
      "skills/aippt-jssdk-design/chart/evidence/donut-source-reconstruction.verification.json",
    candidateRawSsim: 0.9740458406794126,
    missing: ["visual review"],
    reason:
      "Native reconstruction rawSsim=0.9740 exceeds 0.95; visual review is still required because labels sit on light slices and the source inner hole ring is a plotArea blipFill.",
  },
  "dual-panel-chart-analysis": {
    recipeId: "dual-panel-chart-analysis",
    sourceKind: "training_fixture",
    status: "needs_source_evidence",
    sourcePaths: [
      `${TRAINING_FIXTURE_ROOT}/簇状柱形图&折线图 /簇状柱形图&折线图.pptx`,
      `${TRAINING_FIXTURE_ROOT}/簇状柱形图&次坐标轴上的折线图/簇状柱形图&次坐标轴上的折线图.pptx`,
      `${TRAINING_FIXTURE_ROOT}/簇状柱形图&次坐标轴上的折线图/簇状柱形图&次坐标轴上的折线图/幻灯片2.png`,
    ],
    sourceDigests: [
      "sha256:2e3339a6d49606f3bd9b5a50629615de97578c05c948fce09b6ff938cef5eb52",
      "sha256:e31e33df55715e68a4b2911754052bc4a90ab6121be840bf3cd7429d1fbd0947",
      "sha256:4c4bf9627e7e2c7f05b363e9f22ef47bc487839e00e6fc16dbb87fa9c991f1da",
    ],
    reconstructionProgram:
      "skills/aippt-jssdk-design/chart/evidence/combo-source-reconstruction.mjs",
    verificationReport:
      "skills/aippt-jssdk-design/chart/evidence/combo-source-reconstruction.verification.json",
    candidateRawSsim: 0.9553334810489724,
    missing: ["visual review"],
    reason:
      "Native reconstruction rawSsim=0.9553 exceeds 0.95; visual review is still required because source columns use 3D/gradient contours rather than solid fills.",
  },
};

export function chartRecipeEvidenceFor(
  recipeId: ExperimentalChartRecipeId,
): ChartRecipeEvidenceRecord {
  return EVIDENCE[recipeId];
}

export function chartRecipeEvidenceSummary(
  recipeId: ExperimentalChartRecipeId,
) {
  const evidence = chartRecipeEvidenceFor(recipeId);
  return {
    status: evidence.status,
    source_kind: evidence.sourceKind,
    source_paths: evidence.sourcePaths,
    ...(evidence.sourceDigests
      ? { source_digests: evidence.sourceDigests }
      : {}),
    ...(evidence.reconstructionProgram
      ? { reconstruction_program: evidence.reconstructionProgram }
      : {}),
    ...(evidence.verificationReport
      ? { verification_report: evidence.verificationReport }
      : {}),
    ...(evidence.candidateRawSsim === undefined
      ? {}
      : { candidate_raw_ssim: evidence.candidateRawSsim }),
    ...(evidence.rawSsim === undefined ? {} : { raw_ssim: evidence.rawSsim }),
    missing: evidence.missing,
    reason: evidence.reason,
  };
}

/** Formal Skill generation stays blocked until the evidence record is admitted. */
export function chartFormalGenerationGate(
  recipeId: ExperimentalChartRecipeId,
): ChartFormalGenerationGate {
  const evidence = chartRecipeEvidenceFor(recipeId);
  const admitted =
    evidence.status === "high_similarity_verified" && evidence.missing.length === 0;
  if (admitted) {
    return {
      status: "allowed",
      allowed: true,
      reason: "Source evidence is admitted and all required checks are present.",
    };
  }
  return {
    status: "preview_allowed",
    allowed: true,
    reason:
      "Native chart Skill preview is enabled; source SSIM is not yet admitted as high_similarity_verified.",
  };
}
