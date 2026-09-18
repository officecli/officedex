import type { CSSProperties } from "react";

import type { FileType } from "../../shared/uiPort";

/**
 * One accent and one titlebar tint per document format, matching the
 * prototype's measured values.
 *
 * Editor mode wears the file's colour; Agent mode keeps a single neutral
 * titlebar, so the format identity reads as "you are editing this" rather than
 * as ambient decoration.
 */
const ACCENTS: Record<FileType, { accent: string; tint: string }> = {
  doc: { accent: "var(--shell-doc-accent)", tint: "var(--shell-doc-tint)" },
  sheet: { accent: "var(--shell-sheet-accent)", tint: "var(--shell-sheet-tint)" },
  slides: { accent: "var(--shell-slides-accent)", tint: "var(--shell-slides-tint)" },
};

export function fileTypeAccentStyle(type: FileType | null | undefined): CSSProperties {
  const entry = ACCENTS[type ?? "doc"];
  return { "--shell-accent": entry.accent, "--shell-tint": entry.tint } as CSSProperties;
}

export const FILE_TYPE_LABELS: Record<FileType, string> = {
  doc: "Document",
  sheet: "Workbook",
  slides: "Presentation",
};
