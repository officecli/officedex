/**
 * Selection shape shared by the DOCX stage adapter and the editor surface.
 * The full block index is intentionally owned by the editor integration; the
 * stage contract only needs an opaque block id and optional editor positions.
 */
export interface DocxSelection {
  readonly from?: number;
  readonly to?: number;
  readonly blockId?: string;
}
