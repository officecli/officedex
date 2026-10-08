import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReportCapabilityResult } from "../shared/types";

const mockGetReportCapability = vi.fn<() => Promise<ReportCapabilityResult>>();

vi.mock("./bridge", () => ({
  officecli: {
    getReportCapability: (...args: unknown[]) => mockGetReportCapability(...(args as [])),
  },
}));

// The hook caches its result at module level, so we need to reset it between tests
let useReportCapability: () => import("../shared/types").ReportCapabilityResult | null;

describe("useReportCapability", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockGetReportCapability.mockReset();
    const mod = await import("./useReportCapability");
    useReportCapability = mod.useReportCapability;
  });

  it("resolves to enabled capability", async () => {
    mockGetReportCapability.mockResolvedValue({ enabled: true });

    const { result } = renderHook(() => useReportCapability());

    await waitFor(() => {
      expect(result.current).toEqual({ enabled: true });
    });
    expect(mockGetReportCapability).toHaveBeenCalledOnce();
  });

  it("returns disabled capability when bridge returns disabled", async () => {
    mockGetReportCapability.mockResolvedValue({ enabled: false, reason: "cli-missing" });

    const { result } = renderHook(() => useReportCapability());

    await waitFor(() => {
      expect(result.current).toEqual({ enabled: false, reason: "cli-missing" });
    });
  });

  it("returns fallback when bridge call fails", async () => {
    mockGetReportCapability.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useReportCapability());

    await waitFor(() => {
      expect(result.current).toEqual({ enabled: false, reason: "probe-failed" });
    });
  });
});
