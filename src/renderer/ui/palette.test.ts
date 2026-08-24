import { createThemeVars } from "weboffice-design/theme";
import { describe, expect, it } from "vitest";
import { retint } from "../../../scripts/vite/weboffice-design-palette";

/**
 * The retint runs as a Vite transform, so these assertions exercise it from
 * both ends: the pure function, and the design system as the app actually
 * loads it (vitest inlines the package, so the transform has already applied).
 */
describe("design-system retint", () => {
  it("maps the guidance blue onto the accent green", () => {
    expect(retint("color: #5DA4E3;")).toBe("color: #007A55;");
    expect(retint("color: #3686D6;")).toBe("color: #006543;");
  });

  it("keeps neutral alpha steps but drops the hue cast", () => {
    expect(retint("rgba(65,70,75,0.1)")).toBe("rgba(23,23,23,0.1)");
    expect(retint("rgba(65, 70, 75, 0.6)")).toBe("rgba(23,23,23, 0.6)");
  });

  it("leaves the loaded design system with no Shimo blue or hue-cast neutral", () => {
    for (const mode of ["light", "dark"] as const) {
      const values = Object.values(createThemeVars(mode)).map(String).join(" ");
      expect(values).not.toMatch(/#5DA4E3/i);
      expect(values).not.toMatch(/#41464B/i);
      expect(values).not.toMatch(/rgba\(65,\s*70,\s*75/i);
    }
  });

  it("gives the switch and guidance tokens the accent colour", () => {
    const light = createThemeVars("light");
    expect(light["--ui-color-text-status-guidance-normal"]).toBe("#007A55");
    expect(light["--ui-switch-checked-track-color-default"]).toBe("#007A55");
  });
});
