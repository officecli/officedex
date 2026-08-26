import type { ComponentType } from "react";
import { FileOutlined, FileTextOutlined, GridOutlined, MonitorPlayOutlined, PictureOutlined } from "../ui/icons";
import { DocTypeGlyph } from "./DocTypeGlyph";

// Single source of truth for how a document format is represented anywhere in
// the app: one identity color per format (see --od-doc-* tokens) and two ways
// to draw it. A file row is big enough for the document miniature; inline
// placements get the line icon, where the miniature would only smudge.
// Never pick a per-screen icon or tint for a format — render a DocTypeIcon.

const DOC_TYPE_ICONS: Record<string, ComponentType<{ "aria-hidden"?: boolean }>> = {
  pptx: MonitorPlayOutlined,
  docx: FileTextOutlined,
  xlsx: GridOutlined,
  img: PictureOutlined,
  gif: PictureOutlined,
  report: FileTextOutlined,
};

export function docTypeKey(documentType: string | undefined): string {
  const type = (documentType ?? "").toLowerCase();
  return DOC_TYPE_ICONS[type] ? type : "generic";
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
  /** chip renders the document miniature used in file lists; default is the inline line icon. */
  chip?: boolean;
}

export function DocTypeIcon({ type, chip = false }: DocTypeIconProps) {
  const key = docTypeKey(type);
  const Icon = DOC_TYPE_ICONS[key] ?? FileOutlined;
  return (
    <span className={`${chip ? "doc-type-chip" : "doc-type-icon"} doc-type--${key}`} aria-hidden="true">
      {chip ? <DocTypeGlyph type={key} /> : <Icon aria-hidden />}
    </span>
  );
}
