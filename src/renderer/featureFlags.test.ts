import { describe, expect, it } from "vitest";
import { resolvePptVibeCanvasEnabled } from "./featureFlags";

describe("PPT Vibe canvas feature flag", () => {
  it("is disabled by default in product builds", () => {
    expect(resolvePptVibeCanvasEnabled(undefined, "development")).toBe(false);
    expect(resolvePptVibeCanvasEnabled(undefined, "production")).toBe(false);
  });

  it("can be restored without deleting the implementation", () => {
    expect(resolvePptVibeCanvasEnabled("1", "production")).toBe(true);
    expect(resolvePptVibeCanvasEnabled("true", "development")).toBe(true);
    expect(resolvePptVibeCanvasEnabled("0", "test")).toBe(false);
  });
});
