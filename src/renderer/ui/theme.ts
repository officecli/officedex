export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

const THEME_STYLE_ID = "officedex-beautiful-theme";
const THEME_CSS = `
:root {
  --ui-color-text-gray-primary: oklch(24.7% .006 258.361);
  --ui-color-text-gray-secondary: oklch(50.6% .01 264.477);
  --ui-color-text-gray-disable: oklch(69.5% .009 264.505);
  --ui-color-text-gray-inverse: #ffffff;
  --ui-color-background-pagelayer-default: oklch(98.5% .001 286.376);
  --ui-color-background-frame-white: oklch(100% 0 0);
  --ui-color-background-frame-subtle: oklch(96.1% .001 286.375);
  --ui-color-background-frame-muted: oklch(96.1% .002 247.84);
  --ui-color-background-frame-hover: oklch(97% .002 247.839);
  --ui-color-background-frame-selected: oklch(93.3% .003 247.86);
  --ui-color-background-mask-light: rgba(0, 0, 0, .26);
  --ui-color-text-status-guidance-normal: oklch(62.6% .205 254.947);
  --ui-color-text-status-guidance-hover: oklch(55.6% .187 255.617);
  --ui-color-background-accent-blue-muted: oklch(96% .019 252.878);
  --ui-color-background-status-guidance: oklch(62.6% .205 254.947);
  --ui-color-text-status-danger: #c74e5c;
  --ui-color-text-status-warning: #a86d20;
  --ui-color-text-status-success: #2b8e5d;
  --ui-color-border-divider-lighter: oklch(94.6% .003 264.542);
  --ui-color-border-outline-hover: oklch(91.2% .005 258.326);
  --ui-size-radius-xs: 5px;
  --ui-size-radius-s: 8px;
  --ui-size-radius-m: 10px;
  --ui-size-radius-l: 14px;
  --ui-size-radius-circular: 999px;
  --ui-shadow-small: 0 0 0 1px oklch(91.2% .005 258.326), 0 0 4px #0000000a;
  --ui-shadow-medium: 0 0 0 1px oklch(94.6% .003 264.542), 0 18px 47px #00000008, 0 7.5px 19px #00000005;
  --ui-shadow-large: 0 0 0 1px oklch(94.6% .003 264.542), 0 25px 50px #0000000d, 0 12px 24px #0000000a;
  --ui-typography-font-default: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ui-typography-size-xs: 11px;
  --ui-typography-size-s: 12px;
  --ui-typography-size-m: 13px;
  --ui-typography-size-l: 15px;
  --ui-typography-size-xl: 18px;
  --ui-typography-weight-regular: 400;
  --ui-typography-weight-medium: 500;
  --ui-switch-checked-track-color-default: oklch(62.6% .205 254.947);
}
[data-theme="dark"] {
  --ui-color-text-gray-primary: #f5f6f8;
  --ui-color-text-gray-secondary: #969aa5;
  --ui-color-text-gray-disable: #676c76;
  --ui-color-text-gray-inverse: #17181b;
  --ui-color-background-pagelayer-default: #17181b;
  --ui-color-background-frame-white: #1e2024;
  --ui-color-background-frame-subtle: #202228;
  --ui-color-background-frame-muted: #26282e;
  --ui-color-background-frame-hover: #2d3037;
  --ui-color-background-frame-selected: #343743;
  --ui-color-background-mask-light: rgba(0, 0, 0, .54);
  --ui-color-text-status-guidance-normal: #8d82ff;
  --ui-color-text-status-guidance-hover: #b3adff;
  --ui-color-background-accent-blue-muted: rgba(141, 130, 255, .16);
  --ui-color-background-status-guidance: #8d82ff;
  --ui-color-text-status-danger: #ff7f8c;
  --ui-color-text-status-warning: #f4bf69;
  --ui-color-text-status-success: #69d39c;
  --ui-color-border-divider-lighter: rgba(255, 255, 255, .1);
  --ui-color-border-outline-hover: rgba(255, 255, 255, .2);
  --ui-shadow-small: 0 4px 14px rgba(0, 0, 0, .16);
  --ui-shadow-medium: 0 12px 32px rgba(0, 0, 0, .2);
  --ui-shadow-large: 0 24px 64px rgba(0, 0, 0, .28);
  --ui-switch-checked-track-color-default: #8d82ff;
}
`;

export function currentThemeMode(): ThemeMode {
  const explicit = document.documentElement.getAttribute("data-theme");
  return explicit === "dark" ? "dark" : "light";
}

export function mountTheme(): () => void {
  document.getElementById(THEME_STYLE_ID)?.remove();
  const style = document.createElement("style");
  style.id = THEME_STYLE_ID;
  style.dataset.uiKitTheme = "true";
  style.textContent = THEME_CSS;
  document.head.appendChild(style);
  document.documentElement.style.colorScheme = currentThemeMode();
  return () => style.remove();
}

export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "light";
    return;
  }
  root.setAttribute("data-theme", preference);
  root.style.colorScheme = preference;
}
