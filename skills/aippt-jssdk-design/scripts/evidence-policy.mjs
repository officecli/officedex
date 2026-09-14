import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CONTRACT = 'jssdk-progressive/v2';
export function loadPolicy(root) {
  const local = path.join(root, 'policy.json');
  const policy = JSON.parse(fs.readFileSync(fs.existsSync(local) ? local : path.join(root, 'design-skill/policy.json'), 'utf8'));
  const admission = policy.source_acceptance;
  if (policy.contract !== CONTRACT || admission?.metric !== 'rawSsim' || admission.operator !== '>' ||
      admission.threshold !== 0.95 || admission.require_exact_reference !== false) throw new Error('Expected progressive Skill source policy: rawSsim > 0.95');
  return policy;
}

// Admission to distillation is separate from the original exact-replication
// verdict. Never rewrite comparison.passed, exactSolution or reviewed hashes.
export function acceptEvidence({fact, program, reportBytes, policy, id = fact.id, family = fact.family}) {
  if (fact.id !== id || fact.family !== family) throw new Error(`${id}: source identity mismatch`);
  for (const [data, digest] of [[program, fact.program_sha256], [reportBytes, fact.verification_sha256]]) {
    if (crypto.createHash('sha256').update(data).digest('hex') !== digest) throw new Error(`${id}: SHA-256 mismatch`);
  }
  const report = JSON.parse(reportBytes);
  const ssim = report.comparison?.rawSsim;
  if (!Number.isFinite(ssim) || ssim <= policy.source_acceptance.threshold || ssim > 1 || report.comparison.sizeMismatch !== false) throw new Error(`${id}: rawSsim must exceed 0.95 with matching image size`);
  if (fact.checks?.jssdk_executed !== true || report.slides !== 1 || !(report.nativeObjects?.count > 0) ||
      report.pptxExport !== 'passed' || report.strictReimport !== 'passed' || !Array.isArray(report.textOverflow) || report.textOverflow.length !== 0 ||
      !Array.isArray(report.render?.errors) || report.render.errors.length !== 0 || !Array.isArray(report.render.outputs) || report.render.outputs.length !== 1 ||
      report.render.outputs.some(o => !Array.isArray(o.textLayout) || o.textLayout.some(t => t.overflow))) throw new Error(`${id}: execution, native structure, render, export or reimport failed`);
  if (report.render.outputs.some(o => {
    const c=o.textLayoutCoverage;
    return c?.version!==2 || c.measurement!=='font_metrics' || !Number.isInteger(c.checked) || c.checked<0 || c.checked!==c.textBodies || c.checked!==o.textLayout.length || !Array.isArray(c.skipped) || c.skipped.length!==0;
  })) throw new Error(`${id}: complete text validation including group children is required; reverify legacy reports`);
  const source = fact.program?.replaceAll('\\', '/'), reported = report.program?.replaceAll('\\', '/');
  if (!source || !(reported === source || reported?.endsWith('/' + source))) throw new Error(`${id}: report/program provenance mismatch`);
  if (!program.toString().includes('export') || !program.toString().includes('build')) throw new Error(`${id}: missing standalone JSSDK build program`);
  return { accepted: true, evidence_class: 'high_similarity_verified', raw_ssim: ssim,
    exact_reference: fact.exact_reference === true && report.exactSolution === true && report.comparison.passed === true,
    source_policy: policy.source_acceptance };
}
