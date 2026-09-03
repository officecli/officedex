/**
 * Resolves the base URL of the embedded presentation editor that hosts the AI-editable
 * PPTX workbench. Configure it at build/dev time with
 * `VITE_PRESENTATION_EDITOR_URL=http://127.0.0.1:4178/`. During local development
 * a `localStorage` override (`officedex.presentationEditorUrl`) lets a running
 * dev server point at the editor without restarting Vite. Packaged builds use
 * the editor staged under `/presentation/`.
 */
export const PRESENTATION_EDITOR_URL_STORAGE_KEY = "officedex.presentationEditorUrl";
/** Base path used by packaged builds for the editor staged under public/presentation. */
export const EMBEDDED_PRESENTATION_PATH = "/presentation/";

export function resolvePresentationEditorBaseUrl(): string | null {
  const fromEnv = typeof import.meta.env.VITE_PRESENTATION_EDITOR_URL === "string" ? import.meta.env.VITE_PRESENTATION_EDITOR_URL.trim() : "";
  let fromStorage = "";
  if (import.meta.env.DEV) {
    try {
      fromStorage = window.localStorage.getItem(PRESENTATION_EDITOR_URL_STORAGE_KEY)?.trim() ?? "";
    } catch {
      fromStorage = "";
    }
  }
  const candidate = fromStorage || fromEnv || EMBEDDED_PRESENTATION_PATH;
  return candidate || null;
}
