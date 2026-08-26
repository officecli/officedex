import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";

const bridge = vi.hoisted(() => ({
	listAgentRuns: vi.fn(),
	cancelAgentRun: vi.fn(),
	retryAgentRun: vi.fn(),
	respondAgentRun: vi.fn(),
	approveAgentRun: vi.fn(),
}));
vi.mock("../bridge", () => ({ officecli: bridge }));

import { isExternalAgentRuntimeRun, isHistoricalRuntimeRun } from "./DataScreens";

afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const mock of Object.values(bridge)) mock.mockReset(); });

describe("runtime run audience", () => {
  it("separates the external-agent surface from retired legacy runs", () => {
    // The two prefixes are orthogonal: "agent." says who calls it, "legacy."
    // says it is retired. Collapsing them would resurrect the audit mistake
    // where an external-agent workflow read as unfinished product work.
    expect(isExternalAgentRuntimeRun({ workflow: "agent.office.render" })).toBe(true);
    expect(isHistoricalRuntimeRun({ workflow: "agent.office.render" })).toBe(false);

    expect(isHistoricalRuntimeRun({ workflow: "legacy.office-generate" })).toBe(true);
    expect(isExternalAgentRuntimeRun({ workflow: "legacy.office-generate" })).toBe(false);

    // Product-surface workflows belong to neither bucket.
    for (const workflow of ["catalog.cleanup.v1", "liquipedia.sync.v1", "office.generate"]) {
      expect(isExternalAgentRuntimeRun({ workflow })).toBe(false);
      expect(isHistoricalRuntimeRun({ workflow })).toBe(false);
    }
  });
});
