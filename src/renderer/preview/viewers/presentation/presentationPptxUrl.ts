/**
 * Resolves the base URL of the embedded presentation editor that hosts the AI-editable
 * PPTX workbench. Configure it at build/dev time with
 * `VITE_PRESENTATION_EDITOR_URL=http://127.0.0.1:4178/`. During local development
 * a `localStorage` override (`officedex.presentationEditorUrl`) lets a running
 * dev server point at the editor without restarting Vite. Packaged builds use
 * the editor staged under `/presentation/`.
 */
export const PRESENTATION_EDITOR_URL_STORAGE_KEY = "officedex.presentationEditorUrl";
/**
 * Explicit editor entry staged under public/presentation. Vite treats a bare
 * `/presentation/` request as an SPA navigation and serves OfficeDex's root
 * index during desktop dev, recursively booting the host app inside the iframe.
 */
export const EMBEDDED_PRESENTATION_PATH = "/presentation/index.html";

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
