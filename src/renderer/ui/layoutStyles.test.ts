import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readStyle = (path: string) => readFileSync(`${process.cwd()}/src/renderer/ui/${path}`, "utf8");

describe("Chinese layout safeguards", () => {
  it("keeps shared overlays and controls inside a narrow viewport", () => {
    const components = readStyle("./styles/components.css");
    expect(components).toContain("max-height: calc(100dvh - 48px)");
    expect(components).toContain("overflow-wrap: anywhere");
    expect(components).toContain("flex-wrap: wrap;");
  });

  it("keeps the update banner's actions inside a narrow viewport", () => {
    const updates = readFileSync(`${process.cwd()}/src/renderer/styles/onboarding-update.css`, "utf8");
    expect(updates).toContain(".update-banner-actions { width: 100%; justify-content: flex-end; }");
  });
});
