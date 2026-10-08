import { useMemo, type CSSProperties } from "react";

import type { FileType } from "../../shared/uiPort";
import { ICON_BODIES, type IconName } from "./iconBodies";
import { fileIconSvg } from "./fileIcons";

export type { IconName };

/**
 * A workspace function icon: hollow, 24-unit view box, 1.5px stroke.
 *
 * `size` sets the attribute only, as the prototype's `A.icon` does — the box an
 * icon actually occupies comes from the stylesheet (`.dx-icon` is 16px, and a
 * toolbar or tab overrides that), so one glyph can sit in a 12, 16, 18 or 20px
 * slot without the component knowing which.
 */
export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `dx-icon ${className}` : "dx-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON_BODIES[name] }}
    />
  );
}

/** The extension Icon System 1.0 draws for each of the shell's file types. */
const EXT_BY_TYPE: Record<FileType, string> = {
  doc: "docx",
  sheet: "xlsx",
  slides: "pptx",
  image: "image",
};

export function extensionOf(file: { name: string; type: FileType }): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(file.name);
  return match ? match[1].toLowerCase() : EXT_BY_TYPE[file.type];
}

/**
 * A file-type icon from Icon System 1.0.
 *
 * `ext` is an extension or a context type (`folder`, `image`, …). `png` is
 * accepted as a spelling of `image`, which is how the prototype's data names a
 * generated picture.
 */
export function FileIcon({ ext, size = 20, className }: { ext: string; size?: number; className?: string }) {
  const markup = useMemo(
    () => fileIconSvg(ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" ? "image" : ext, {
      size,
      decorative: true,
    }),
    [ext, size],
  );
  return (
    <span
      className={className ? `dx-file-icon ${className}` : "dx-file-icon"}
      style={{ width: size, height: size } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export function FileTypeGlyph({ type, size = 20 }: { type: FileType; size?: number }) {
  return <FileIcon ext={EXT_BY_TYPE[type]} size={size} />;
}
