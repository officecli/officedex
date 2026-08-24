import { afterEach, describe, expect, it } from "vitest";
import { applyThemePreference, currentThemeMode, mountTheme } from "./theme";

let teardown: (() => void) | undefined;

afterEach(() => {
  teardown?.();
  teardown = undefined;
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

describe("design system theme bootstrap", () => {
  it("injects the weboffice-design palette variables into the document", () => {
    expect(document.querySelector("style[data-ui-kit-theme]")).toBeNull();

    teardown = mountTheme();

    const style = document.querySelector("style[data-ui-kit-theme]");
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain("--ui-color-text-gray-primary");
    expect(style?.textContent).toContain("--ui-size-radius-s");
  });

  it("removes the injected styles on teardown", () => {
    const dispose = mountTheme();
    dispose();
    expect(document.querySelector("style[data-ui-kit-theme]")).toBeNull();
  });

  it("stamps an explicit preference and clears it for system", () => {
    teardown = mountTheme();

    applyThemePreference("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(currentThemeMode()).toBe("dark");

    applyThemePreference("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(currentThemeMode()).toBe("light");

    applyThemePreference("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
