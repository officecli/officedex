export function resolvePptVibeCanvasEnabled(value: unknown, mode: string) {
  if (typeof value === "string" && value.trim()) {
    return /^(1|true|yes|on)$/i.test(value.trim());
  }
  // Keep the dormant implementation covered by its existing test suite.
  // Product builds stay off until VITE_PPT_VIBE_CANVAS is explicitly enabled.
  return mode === "test";
}

export const PPT_VIBE_CANVAS_ENABLED = resolvePptVibeCanvasEnabled(
  import.meta.env.VITE_PPT_VIBE_CANVAS,
  import.meta.env.MODE,
);
