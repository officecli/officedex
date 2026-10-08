/**
 * OfficeDex Icon System 1.0 — file, container and attachment icons.
 *
 * A port of the frozen `assets/icon-system-1.0/file-icons.js` that the approved
 * prototype ships, and of the one family (`04`, the frameless function glyphs)
 * it takes from `original-icons.js`. The version is frozen by OD-UI-1.2 §06:
 * shapes, palettes and the 16px compact variants are reproduced as written, and
 * nothing here may be "tidied" into another icon set. A new format needs an
 * asset proposal, not a new branch in `symbol()`.
 *
 * The output is SVG markup rather than React elements because that is what the
 * source produces, and a byte-identical string is the cheapest proof that the
 * port did not drift.
 */

interface Palette {
  color: string;
  light: string;
  dark: string;
}

const palettes: Record<string, Palette> = {
  word: { color: "#596F86", light: "#DCE4EC", dark: "#A4BBD2" },
  sheet: { color: "#5C7565", light: "#DFE7DF", dark: "#A5C4AD" },
  slides: { color: "#926B67", light: "#EEDFDA", dark: "#D9A9A1" },
  text: { color: "#6D737B", light: "#E7EAED", dark: "#BEC4CD" },
  markdown: { color: "#656E85", light: "#E4E7F0", dark: "#B2BDD6" },
  richtext: { color: "#796C86", light: "#EAE3EF", dark: "#C4B2D5" },
  html: { color: "#8B7353", light: "#EEE6D9", dark: "#D8C09D" },
  pdf: { color: "#A06364", light: "#F0E0E1", dark: "#E1B0B0" },
  neutral: { color: "#78808A", light: "#E7EBEF", dark: "#BFC7D1" },
};

interface FormatEntry {
  ext: string;
  family?: string;
  name: string;
}

const formats: FormatEntry[] = [
  { ext: "docx", family: "word", name: "Word document" },
  { ext: "xlsx", family: "sheet", name: "Excel workbook" },
  { ext: "pptx", family: "slides", name: "PowerPoint presentation" },
  { ext: "doc", family: "word", name: "Word document (compatibility)" },
  { ext: "xls", family: "sheet", name: "Excel workbook (compatibility)" },
  { ext: "ppt", family: "slides", name: "PowerPoint presentation (compatibility)" },
  { ext: "txt", family: "text", name: "Plain text" },
  { ext: "md", family: "markdown", name: "Markdown" },
  { ext: "rtf", family: "richtext", name: "Rich text" },
  { ext: "html", family: "html", name: "HTML" },
  { ext: "pdf", family: "pdf", name: "PDF" },
];

const contextTypes: FormatEntry[] = [
  { ext: "folder", name: "Folder" },
  { ext: "folder-open", name: "Open folder" },
  { ext: "image", name: "Image" },
  { ext: "audio", name: "Audio" },
  { ext: "video", name: "Video" },
  { ext: "archive", name: "Archive" },
  { ext: "file", name: "File" },
  { ext: "unsupported", name: "Unsupported file" },
];

const escapeText = (value: string) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string,
  );

export function resolveFileFormat(input: string): FormatEntry {
  const ext = String(input || "")
    .split(/[?#]/)[0]
    .split(".")
    .pop()!
    .toLowerCase();
  return (
    formats.find((f) => f.ext === ext) ||
    contextTypes.find((f) => f.ext === ext) ||
    contextTypes.find((f) => f.ext === "file")!
  );
}

/** Family `04` of the original icon library, recoloured by the caller. */
function original04(kind: "doc" | "sheet" | "slides", color: string, light: string): string {
  if (kind === "doc")
    return `<g fill="${color}"><rect x="3" y="5" width="18" height="2.6" rx="1.1"/><rect x="3" y="10" width="14" height="2.6" rx="1.1"/><rect x="3" y="15" width="18" height="2.6" rx="1.1"/><rect x="3" y="20" width="11" height="2.6" rx="1.1"/></g>`;
  if (kind === "sheet")
    return `<rect x="2" y="5" width="20" height="18" rx="2" fill="${color}"/>${[0, 1]
      .flatMap((y) =>
        [0, 1, 2].map(
          (x) => `<rect x="${4 + x * 6}" y="${12 + y * 5}" width="4" height="3" rx=".4" fill="${light}"/>`,
        ),
      )
      .join("")}<path d="M4 9h16" stroke="${light}" stroke-width="1.5"/>`;
  return `<rect x="2" y="5" width="20" height="15" rx="2.4" fill="${color}"/><path d="M12 20v4M8 24h8" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/><path d="m7 15 3-4 3 2 4-5" fill="none" stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function symbol(kind: string, c: string, l: string, compact = false): string {
  const g = (body: string) =>
    `<g fill="none" stroke="${c}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
  if (kind === "word" || kind === "sheet" || kind === "slides") {
    if (compact && kind === "word")
      return `<g fill="${c}"><rect x="3" y="6" width="18" height="3" rx="1"/><rect x="3" y="12" width="18" height="3" rx="1"/><rect x="3" y="18" width="12" height="3" rx="1"/></g>`;
    if (compact && kind === "sheet")
      return `<rect x="2" y="5" width="20" height="18" rx="2" fill="${c}"/><path d="M4 10h16M4 16h16M10 10v11" stroke="${l}" stroke-width="2"/>`;
    return original04(kind === "word" ? "doc" : kind, c, l);
  }
  if (kind === "text") return g('<path d="M4 6h16M12 6v16M8 22h8"/>');
  if (kind === "markdown") return g('<path d="M2.5 21V8l5 6 5-6v13M19 8v13m-3.5-4 3.5 4 3.5-4"/>');
  if (kind === "richtext")
    return `<path d="m4 16 4.5-10h2L15 16h-2.6l-.9-2.3H7l-.9 2.3ZM7.8 11.7h2.9L9.3 8Z" fill="${c}"/>${g('<path d="M18 8h3M18 13h3M4 21h17"/>')}`;
  if (kind === "html") return g('<path d="m7 8-5 6 5 6m10-12 5 6-5 6M14 6l-4 16"/>');
  if (kind === "pdf")
    return `<rect x="3" y="4" width="18" height="21" rx="2" fill="${c}"/><path d="M6.5 9h11M6.5 12.5h8M6.5 16h11" stroke="${l}" stroke-width="1.6" stroke-linecap="round"/><rect x="6.5" y="20" width="11" height="2" rx="1" fill="${l}"/>`;
  if (kind === "folder" || kind === "folder-open")
    return kind === "folder"
      ? `<path d="M2 8a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" fill="${c}"/><path d="M4 12h16" stroke="${l}" stroke-width="1.5"/>`
      : `<path d="M2 9V8a2 2 0 0 1 2-2h5l2 3h9v4H2Z" fill="${c}"/><path d="M3 12h19l-3 11H2Z" fill="${c}" stroke="${l}" stroke-width="1"/>`;
  if (kind === "image")
    return `<rect x="2" y="5" width="20" height="18" rx="2" fill="${c}"/><circle cx="7.5" cy="10" r="1.5" fill="${l}"/><path d="m5 20 4-5 3 3 4-7 3 4" stroke="${l}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (kind === "audio") return g('<path d="M4 12v4M9 7v14M14 4v20M19 9v10M23 12v4"/>');
  if (kind === "video")
    return `<rect x="2" y="6" width="20" height="17" rx="2.5" fill="${c}"/><path d="m10 10 7 4.5-7 4.5Z" fill="${l}"/>`;
  if (kind === "archive")
    return `<rect x="3" y="4" width="18" height="21" rx="2" fill="${c}"/>${[6, 10, 14]
      .map((y) => `<path d="M10 ${y}h4" stroke="${l}" stroke-width="2"/>`)
      .join("")}<rect x="10" y="19" width="4" height="3" rx=".5" fill="${l}"/>`;
  return g(
    '<path d="M5 3h10l5 5v17H5ZM15 3v6h5"/>' +
      (kind === "unsupported" ? '<path d="m9 14 7 7m0-7-7 7"/>' : '<path d="M9 14h7M9 19h5"/>'),
  );
}

export interface FileIconOptions {
  size?: number;
  theme?: "light" | "dark" | "mono";
  decorative?: boolean;
}

/**
 * The icon for a file name or extension, as SVG markup.
 *
 * `size <= 16` selects the compact drawings for documents and workbooks, which
 * is why a tab's icon and a card's icon are not the same shape scaled.
 */
export function fileIconSvg(input: string, { size = 24, theme = "light", decorative = false }: FileIconOptions = {}): string {
  const f = resolveFileFormat(input);
  const p = (f.family && palettes[f.family]) || palettes.neutral;
  const c = theme === "mono" ? "#353B43" : theme === "dark" ? p.dark : p.color;
  const l = theme === "mono" ? "#FFFFFF" : theme === "dark" ? "#23262C" : p.light;
  const body = `<g transform="translate(2 0)">${symbol(f.family || f.ext, c, l, size <= 16)}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28" fill="none" ${
    decorative ? 'aria-hidden="true"' : `role="img" aria-label="${escapeText(f.name)}"`
  }><title>${escapeText(f.name)}</title>${body}</svg>`;
}
