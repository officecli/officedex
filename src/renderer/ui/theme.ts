import { getDocumentThemeMode, mountFullThemeCss, subscribeThemeMode, syncThemeAttribute } from "weboffice-design/theme";

export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

const THEME_STYLE_ID = "officedex-weboffice-theme";

export function currentThemeMode(): ThemeMode {
  return getDocumentThemeMode() === "dark" ? "dark" : "light";
}

/**
 * Injects the weboffice-design theme variables (`--ui-*`) into the document and
 * keeps the `data-theme` stamp in sync with the active mode. `tokens.css` maps
 * those variables onto the app-level `--od-*` names, so this must run before the
 * first render. Returns a teardown that removes both the styles and the listener.
 */
export function mountTheme(): () => void {
  const unmountCss = mountFullThemeCss(THEME_STYLE_ID);
  syncThemeAttribute(currentThemeMode() === "dark");
  const unsubscribe = subscribeThemeMode(() => {
    syncThemeAttribute(currentThemeMode() === "dark");
  });
  return () => {
    unsubscribe();
    unmountCss();
  };
}

/**
 * Applies an explicit preference. "system" clears the stamp so the document
 * follows `prefers-color-scheme` again.
 */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "";
    syncThemeAttribute(currentThemeMode() === "dark");
    return;
  }
  root.setAttribute("data-theme", preference);
  root.style.colorScheme = preference;
  syncThemeAttribute(preference === "dark");
}
