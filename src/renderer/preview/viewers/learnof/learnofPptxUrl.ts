/**
 * Resolves the base URL of the learnof/pptx editor that hosts the AI-editable
 * PPTX workbench. Configure it at build/dev time with
 * `VITE_LEARNOF_PPTX_URL=http://127.0.0.1:4178/`. During local development a
 * `localStorage` override (`officedex.learnofPptxUrl`) lets a running dev server
 * point at the editor without restarting Vite. Returns `null` when unset.
 */
export const LEARNOF_PPTX_URL_STORAGE_KEY = "officedex.learnofPptxUrl";

export function resolveLearnofPptxBaseUrl(): string | null {
  const fromEnv = typeof import.meta.env.VITE_LEARNOF_PPTX_URL === "string" ? import.meta.env.VITE_LEARNOF_PPTX_URL.trim() : "";
  let fromStorage = "";
  if (import.meta.env.DEV) {
    try {
      fromStorage = window.localStorage.getItem(LEARNOF_PPTX_URL_STORAGE_KEY)?.trim() ?? "";
    } catch {
      fromStorage = "";
    }
  }
  const candidate = fromStorage || fromEnv;
  return candidate || null;
}
