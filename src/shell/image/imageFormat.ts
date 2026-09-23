/**
 * The three facts the image surfaces state about a file, derived rather than
 * stored: what to call it, what format it is, and what shape it came out.
 *
 * The shape is read off the picture once it has loaded — `naturalWidth` /
 * `naturalHeight` — and not from the request that produced it. A run asks for
 * "16:9 at 2K" and the provider returns what it returns; a caption repeating
 * the request would be describing the order rather than the picture.
 */

/** "MO launch image.png" → "MO launch image". */
export function fileBaseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** "MO launch image.png" → "PNG". Null when the name carries no extension. */
export function fileFormat(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toUpperCase();
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * "16:9" when the picture reduces to something a person would recognise as a
 * ratio, and its pixel size when it does not. Null while the size is unknown,
 * which is every moment before the picture has loaded.
 */
export function aspectLabel(width: number, height: number): string | null {
  if (!width || !height) return null;
  const divisor = gcd(width, height) || 1;
  const w = Math.round(width / divisor);
  const h = Math.round(height / divisor);
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  return `${width} × ${height}`;
}
