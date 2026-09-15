#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPolicy, acceptEvidence } from './evidence-policy.mjs';

export const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const aliases = { hierarchy: 'organization', 'part-to-whole': 'pyramid', part_to_whole: 'pyramid' };

export function selectFamily(brief, root = defaultRoot) {
  if (!brief || Array.isArray(brief) || typeof brief !== 'object') throw new Error('Expected a structured brief object');
  const items = Array.isArray(brief.items) ? brief.items.length : brief.items;
  if (!Number.isInteger(items) || items < 1) throw new Error('items must be a positive integer or a nonempty array');
  const requested = String(brief.relation ?? brief.family ?? '').trim().toLowerCase();
  const relation = aliases[requested] ?? requested;
  const density = brief.density ?? 'medium';
  if (!['short', 'medium', 'long'].includes(density)) throw new Error('density must be short, medium, or long');
  const orientation = brief.orientation ?? 'auto';
  if (!['auto', 'horizontal', 'vertical', 'grid'].includes(orientation)) throw new Error('Invalid orientation');
  const registry = read(path.join(root, 'registry.json'));
  const policy = loadPolicy(root);
  const result = {
    family_selected: null, variant_selected: null, family_reason: '',
    family_parameters: { relation, items, density, orientation },
    fallback_family: null, fallback_reason: null, blocked: false,
    status: 'needs_semantics', load_paths: [], source_evidence: [],
    source_policy: policy.source_acceptance,
  };
  if (registry.blocked.includes(relation)) return {
    ...result, status: 'needs_capability_review', blocked: true,
    family_reason: `${relation} has no validated recipe in this registry; inspect current public JSSDK evidence`,
  };
  const family = registry.families.find(f => f.relations.includes(relation));
  if (!family) return { ...result, family_reason: 'Identify the content relation; no automatic list fallback' };
  const checkedPath = relative => {
    const resolved = path.resolve(root, relative);
    const rel = path.relative(path.resolve(root), resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(resolved).isFile()) throw new Error(`Invalid catalog file: ${relative}`);
    return resolved;
  };
  result.family_selected = family.id;
  result.recipe_status = family.status;
  result.load_paths.push(checkedPath(family.recipe));
  if (family.variants) result.load_paths.push(checkedPath(family.variants));
  if (items < family.items.min || items > family.items.max) return {
    ...result, status: 'needs_reflow', family_reason: `${relation}: ${items} items exceed this recipe's range`,
    fallback_reason: 'Recompose or split while preserving the relation and all text; respect fixed page limits',
  };
  if (!family.variants) return {
    ...result, status: 'needs_recipe', family_reason: `${relation} has guidance only; no evidence-backed variant yet`,
  };
  let eligible = read(path.join(root, family.variants)).variants.filter(v => v.items.includes(items) && v.densities.includes(density));
  if (orientation !== 'auto') eligible = eligible.filter(v => v.orientation === orientation);
  if (brief.variant) eligible = eligible.filter(v => v.id === brief.variant);
  if (eligible.length && eligible.every(v => v.generation_ready === false)) return {
    ...result, status: 'needs_source_evidence', blocked: true,
    family_reason: 'Matching source variants need repair or complete text revalidation; they are not eligible for generation',
  };
  eligible = eligible.filter(v => v.generation_ready !== false);
  eligible = rankVariants(eligible, brief);
  const variant = eligible[0];
  if (!variant) return {
    ...result, status: 'needs_reflow', family_reason: `${relation}: no variant satisfies count, density and orientation`,
    fallback_reason: 'Try a different orientation or split within the same relation; do not silently discard a constraint',
  };
  const evidence = variant.source_evidence.map(id => ({ id, facts: checkedPath(`${family.id}/evidence/${id}.json`) }));
  let evidenceError = evidence.length ? null : 'No source evidence declared';
  const previewAdmission = variant.admission === 'native_chart_preview';
  for (const entry of evidence) {
    try {
      const fact = read(entry.facts);
      const stem = entry.facts.slice(0, -5);
      const workspace = path.resolve(root, '../../..');
      const localProgram = stem + '.mjs';
      const skillProgram = fact.program ? path.resolve(root, fact.program) : '';
      entry.program = fs.existsSync(localProgram)
        ? localProgram
        : fs.existsSync(skillProgram)
          ? skillProgram
          : path.resolve(workspace, fact.program ?? '');
      if (previewAdmission) {
        const programText = fs.existsSync(entry.program)
          ? fs.readFileSync(entry.program, 'utf8')
          : '';
        if (!programText.includes('export') || !programText.includes('build')) {
          throw new Error(`${entry.id}: native chart preview requires a standalone JSSDK build program`);
        }
        Object.assign(entry, {
          accepted: true,
          evidence_class: 'native_chart_preview',
          raw_ssim: Number.isFinite(fact.ssim) ? fact.ssim : null,
        });
        continue;
      }
      entry.verification = fs.existsSync(stem + '.verification.json') ? stem + '.verification.json' : path.resolve(workspace, fact.verification);
      Object.assign(entry, acceptEvidence({fact, program: fs.readFileSync(entry.program), reportBytes: fs.readFileSync(entry.verification), policy, id: entry.id, family: family.id}));
    } catch (error) { evidenceError = error.message; break; }
  }
  if (evidenceError) return { ...result, variant_selected: variant.id, status: 'needs_source_evidence', blocked: true, family_reason: evidenceError, source_evidence: evidence };
  return {
    ...result, status: 'selected', variant_selected: variant.id,
    family_reason: `${relation}, ${items} items, ${density} text → ${variant.mechanism}`,
    family_parameters: { ...result.family_parameters, orientation: variant.orientation, capacity_check: 'required_for_actual_text' },
    source_evidence: evidence,
    visual_signature: variant.visual_signature ?? variant.id,
    preserve: variant.preserve ?? variant.mechanism,
    required_geometry: variant.required_geometry ?? {},
    candidate_variants: eligible.map(v => ({id:v.id, score:v.selection_score, mechanism:v.mechanism})),
    selection_reason: "满足语义与容量后，比较视觉意图、全稿使用次数及相邻重复",
  };
}

// Rank only semantically/capacity-compatible candidates. A sole eligible layout
// remains valid: diversity must never falsify relations or silently remove text.
export function rankVariants(variants, brief = {}) {
  const history = brief.history ?? [];
  const intent = new Set(String(brief.visual_intent ?? '').toLowerCase().split(/[\s,]+/));
  return variants.map((v, order) => {
    const signature = v.visual_signature ?? v.id;
    const key = h => h.visual_signature ?? h.variant_selected;
    const uses = history.filter(h => key(h) === signature).length;
    const adjacent = history.length > 0 && key(history.at(-1)) === signature;
    const affinity = (v.visual_tags ?? []).filter(t => intent.has(t)).length;
    return {...v, selection_score: affinity * 12 - uses * 30 - (adjacent ? 80 : 0), selection_order:order};
  }).sort((a,b) => b.selection_score-a.selection_score || a.selection_order-b.selection_order);
}

export function selectDeck(briefs, root = defaultRoot) {
  const slides=[];
  for (const brief of briefs) {
    const selected=selectFamily({...brief,history:slides},root);
    slides.push({...selected,slide:slides.length+1});
    if(selected.status!=='selected')return {status:selected.status,slides};
  }
  const usage={};for(const s of slides)usage[s.visual_signature]=(usage[s.visual_signature]??0)+1;
  return {status:'selected',slides,diversity:{unique_layouts:Object.keys(usage).length,usage,
    adjacent_repeats:slides.slice(1).filter((s,i)=>s.visual_signature===slides[i].visual_signature).length}};
}

export function runCli(args = process.argv.slice(2), root = defaultRoot) {
  try {
    const input = args[0];
    if (!input) throw new Error("Usage: select-family.mjs '<json>' | @brief.json [--out generation-plan.json]");
    const outIndex = args.indexOf('--out');
    if (args.length !== (outIndex === 1 ? 3 : 1)) throw new Error('Invalid command arguments');
    const brief = input.startsWith('@') ? read(path.resolve(input.slice(1))) : JSON.parse(input);
    const result = Array.isArray(brief) ? selectDeck(brief, root) : selectFamily(brief, root);
    const json = JSON.stringify(result, null, 2) + '\n';
    if (outIndex !== -1) fs.writeFileSync(path.resolve(args[outIndex + 1]), json);
    process.stdout.write(json);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli();
