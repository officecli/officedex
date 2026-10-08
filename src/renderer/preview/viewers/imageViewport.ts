export interface ImageViewport { scale: number; x: number; y: number }
export function fitImage(width: number, height: number, viewportWidth: number, viewportHeight: number, rotation = 0): ImageViewport {
  const swapped = rotation % 180 !== 0;
  return { scale: Math.max(0.001, Math.min(1, Math.max(1, viewportWidth - 64) / (swapped ? height : width), Math.max(1, viewportHeight - 64) / (swapped ? width : height))), x: 0, y: 0 };
}
export function zoomImage(view: ImageViewport, scale: number, anchorX = 0, anchorY = 0): ImageViewport {
  const next = Math.max(.001, Math.min(8, scale));
  return { scale: next, x: anchorX - (anchorX - view.x) * next / view.scale, y: anchorY - (anchorY - view.y) * next / view.scale };
}
export const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
};
export function isImagePreview(type?: string) { return Object.hasOwn(IMAGE_MIME_TYPES, (type ?? '').toLowerCase().replace(/^\./, '')); }
