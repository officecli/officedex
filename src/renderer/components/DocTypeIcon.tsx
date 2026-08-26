import { MaterialSymbol } from "./Shell";

// Single source of truth for how a document format is represented anywhere in
// the app: one icon and one identity color per format (see --od-doc-* tokens).
// Never pick a per-screen icon or tint for a format — render a DocTypeIcon.

const DOC_TYPE_SYMBOLS: Record<string, string> = {
  pptx: "slideshow",
  docx: "description",
  xlsx: "table_chart",
  img: "image",
  gif: "image",
  report: "analytics",
};

export function docTypeKey(documentType: string | undefined): string {
  const type = (documentType ?? "").toLowerCase();
  return DOC_TYPE_SYMBOLS[type] ? type : "generic";
}

export function docTypeFromPath(path: string): string {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  if (extension === "ppt" || extension === "pptx" || extension === "potx") return "pptx";
  if (extension === "doc" || extension === "docx" || extension === "md" || extension === "txt") return "docx";
  if (extension === "xls" || extension === "xlsx" || extension === "xlsm" || extension === "csv") return "xlsx";
  if (["png", "jpg", "jpeg", "webp", "avif", "bmp", "svg"].includes(extension)) return "img";
  if (extension === "gif") return "gif";
  return "generic";
}

export interface DocTypeIconProps {
  type: string | undefined;
  /** chip renders the 34px tinted square used in file lists; default is a bare colored icon. */
  chip?: boolean;
}

export function DocTypeIcon({ type, chip = false }: DocTypeIconProps) {
  const key = docTypeKey(type);
  const symbol = DOC_TYPE_SYMBOLS[key] ?? "description";
  return (
    <span className={`${chip ? "doc-type-chip" : "doc-type-icon"} doc-type--${key}`} aria-hidden="true">
      <MaterialSymbol name={symbol} />
    </span>
  );
}
