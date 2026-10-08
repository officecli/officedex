import { describe, expect, it } from "vitest";
import { usesPresentationCompatibilityProtocol } from "./protocol-mode";

describe("usesPresentationCompatibilityProtocol", () => {
  it("selects the rich workbench protocol for a channelled OfficeDex embed", () => {
    expect(
      usesPresentationCompatibilityProtocol(
        "?officedexEmbed=1&channel=0123456789abcdef&sessionMode=browser-local",
      ),
    ).toBe(true);
  });

  it("keeps the presentation host bridge for the normal component iframe", () => {
    expect(usesPresentationCompatibilityProtocol("?mode=embed")).toBe(false);
    expect(usesPresentationCompatibilityProtocol("?officedexEmbed=1")).toBe(false);
  });
});
