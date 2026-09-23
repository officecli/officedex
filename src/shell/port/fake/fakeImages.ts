import type { FileMeta, ImagePort } from "../../../shared/uiPort";

/**
 * Pictures for the fake port.
 *
 * The fake has no image model, so a "generated" picture is drawn here: an SVG
 * at the requested pixel size, so everything downstream that reads the size
 * off the loaded image (the toolbar's "PNG · 2048 × 1152", the version
 * thumbnails' shape) is exercised with real numbers. Each version gets its own
 * hue so switching versions visibly switches pictures.
 */

export interface FakeImageStore {
  /** Records the pixel size and look of a generated file. */
  register(fileId: string, width: number, height: number, seed: number): void;
  port(getFiles: () => FileMeta[]): ImagePort;
}

const HUES = [148, 206, 32, 268, 350, 96];

export function placeholderSvg(width: number, height: number, seed: number): string {
  const hue = HUES[seed % HUES.length];
  const short = Math.min(width, height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 32% 94%)"/><stop offset="1" stop-color="hsl(${hue} 26% 80%)"/></linearGradient></defs>
<rect width="${width}" height="${height}" fill="url(#g)"/>
<circle cx="${width * 0.34}" cy="${height * 0.56}" r="${short * 0.2}" fill="hsl(${hue} 22% 62%)"/>
<rect x="${width * 0.52}" y="${height * 0.34}" width="${short * 0.34}" height="${short * 0.34}" rx="${short * 0.04}" fill="hsl(${hue} 18% 44%)"/>
<rect x="0" y="${height * 0.8}" width="${width}" height="${height * 0.2}" fill="hsl(${hue} 20% 72%)" opacity="0.7"/>
</svg>`;
}

export function createFakeImageStore(): FakeImageStore {
  const generated = new Map<string, { width: number; height: number; seed: number }>();
  const references = new Map<string, Blob>();
  let sequence = 0;

  return {
    register(fileId, width, height, seed) {
      generated.set(fileId, { width, height, seed });
    },
    port(getFiles) {
      return {
        // No `pickReferences`: a browser has no system picker, so the composer
        // falls back to a file input and `importReference`.
        async importReference(file) {
          sequence += 1;
          const path = `/fake/references/${sequence}-${file.name}`;
          references.set(path, file);
          return path;
        },
        async readPath(path) {
          const blob = references.get(path);
          if (!blob) throw new Error(`No picture at ${path}`);
          return blob;
        },
        async readFile(fileId) {
          const known = generated.get(fileId);
          const file = getFiles().find((entry) => entry.id === fileId);
          if (!file) throw new Error(`Unknown file: ${fileId}`);
          const { width, height, seed } = known ?? { width: 1600, height: 900, seed: 0 };
          return new Blob([placeholderSvg(width, height, seed)], { type: "image/svg+xml" });
        },
        async saveCopy(fileId) {
          const file = getFiles().find((entry) => entry.id === fileId);
          return file ? `~/Downloads/${file.name}` : null;
        },
      };
    },
  };
}
