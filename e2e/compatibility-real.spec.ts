import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { attachHostReport, fixturePath, hostControl, preparePage, recordScenario } from "./support/real-e2e";

test.describe("OfficeDex D/E compatibility canaries", () => {
  test.skip(process.env.OFFICEDEX_E2E_COMPAT !== "1", "Set OFFICEDEX_E2E_COMPAT=1 to run compatibility canaries against the managed real bridge.");

  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("keeps legacy and versioned stage capabilities visible", async ({ page }) => {
    await preparePage(page);
    await hostControl("/rpc/Initialize", { method: "POST", body: "null" });
    const result = await hostControl<string>("/rpc/GetCapabilities", { method: "POST", body: "null" });
    const capabilities = typeof result === "string" ? result : JSON.stringify(result);
    expect(capabilities).toContain("office.modify");
    expect(capabilities).toContain("artifact_stage_edit.v1");
    expect(capabilities).toContain("pptx");
    expect(capabilities).toContain("docx");
    expect(capabilities).toContain("xlsx");
    await recordScenario({ uiScenario: "compatibility-capabilities", runtime: capabilities });
  });

  test("serves deterministic provider-free PPTX and image fixtures", async ({ page }) => {
    await preparePage(page);
    const fixture = await fixturePath("blank.pptx");
    const bytes = await readFile(fixture);
    expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(fixture.toLowerCase()).toMatch(/\.pptx$/);
    await recordScenario({ uiScenario: "compatibility-fixtures", documentType: "pptx", artifactPath: fixture, fileSize: bytes.length });
  });
});
