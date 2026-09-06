import type { WorkbookSnapshot } from "./workbookClientTools";

/** Stable, dependency-free fingerprint for the workbook data used by output
 * lineage. It is deliberately deterministic across sessions and cheap enough
 * to calculate after a save. */
export function workbookFingerprint(snapshot: WorkbookSnapshot): string {
  const canonical = JSON.stringify(snapshot.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, rows: sheet.rows })));
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
