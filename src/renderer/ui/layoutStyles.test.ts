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

  it("uses mobile-safe layouts for settings, home attention rows, and updates", () => {
    const settings = readFileSync(`${process.cwd()}/src/renderer/styles/settings.css`, "utf8");
    const home = readFileSync(`${process.cwd()}/src/renderer/styles/home.css`, "utf8");
    const updates = readFileSync(`${process.cwd()}/src/renderer/styles/onboarding-update.css`, "utf8");
    expect(settings).toContain("@media (max-width: 900px) and (min-width: 761px)");
    expect(settings).toContain(".effective-row { align-items: flex-start; flex-direction: column;");
    expect(home).toContain(".home-attention-row--runtime { grid-template-areas:");
    expect(updates).toContain(".update-banner-actions { width: 100%; justify-content: flex-end; }");
  });

  it("keeps compact document icons centered in the full sidebar row", () => {
    const home = readFileSync(`${process.cwd()}/src/renderer/styles/home.css`, "utf8");
    expect(home).toContain(".project-sidebar__document-open { display: grid; width: 100%;");
    expect(home).toContain(".project-sidebar[data-compact=\"true\"] .project-sidebar__document-open { grid-template-columns: 1fr; justify-items: center; padding: 0; }");
  });
});
