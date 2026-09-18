import { FileText, Presentation, Table2 } from "lucide-react";

import type { FileType } from "../../shared/uiPort";

const GLYPHS = { doc: FileText, sheet: Table2, slides: Presentation } as const;

/**
 * One glyph per document format, tinted with that format's accent so a file
 * reads the same in a tab, in the sidebar and on Home.
 *
 * The prototype drew bespoke format silhouettes. Lucide is already a
 * dependency and carries the same three shapes, so the shell uses those rather
 * than shipping a fourth icon set into the repo.
 */
export function FileTypeIcon({ type, size = 16 }: { type: FileType; size?: number }) {
  const Glyph = GLYPHS[type];
  return (
    <Glyph
      className="shell-file-icon"
      size={size}
      strokeWidth={1.6}
      aria-hidden="true"
      data-file-type={type}
    />
  );
}
