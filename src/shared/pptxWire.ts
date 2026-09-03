/** Wire shape for streamed Vibe presentation slides. Kept stable for the
 * production pipeline; editor-specific PPTist protocol types were removed. */
export interface PptistSlide {
  id: string;
  elements: unknown[];
  background?: Record<string, unknown>;
  [key: string]: unknown;
}
