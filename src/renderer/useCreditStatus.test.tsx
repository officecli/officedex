import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { CreditStatus, DesktopAPI } from "../shared/types";
import { deriveCreditInfo, useCreditStatus } from "./useCreditStatus";
import { officecli } from "./bridge";

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeStatus(overrides: Partial<CreditStatus> = {}): CreditStatus {
  return {
    mode: "anonymous",
    accessMode: "",
    planName: "",
    hostedCreditBalance: null,
    freeTrialLimit: 0,
    freeTrialUsed: 0,
    freeTrialRemaining: 0,
    rewardRemaining: 0,
    paidKeyPrefix: "",
    paidKeyTotal: 0,
    paidKeyUsed: 0,
    paidKeyRemaining: 0,
    raw: "",
    ...overrides,
  };
}

let original: DesktopAPI["getCreditStatus"];

beforeEach(() => {
  vi.useFakeTimers();
  original = officecli.getCreditStatus;
});

afterEach(() => {
  officecli.getCreditStatus = original;
  vi.useRealTimers();
});

describe("deriveCreditInfo", () => {
  it("anonymous trial → used/total comes from freeTrial fields", () => {
    const credit = deriveCreditInfo(
      makeStatus({ mode: "anonymous", freeTrialLimit: 100, freeTrialUsed: 25, freeTrialRemaining: 75 }),
    );
    expect(credit).toEqual({ used: 25, total: 100, planLabel: "Free trial" });
  });

  it("logged_in + hostedCreditBalance → 0/balance with plan label", () => {
    const credit = deriveCreditInfo(
      makeStatus({
        mode: "logged_in",
        hostedCreditBalance: 42,
        planName: "Pro",
        accessMode: "hosted",
      }),
    );
    expect(credit).toEqual({ used: 0, total: 42, planLabel: "Pro" });
  });

  it("api_key + paidKeyTotal → uses paid-key burndown", () => {
    const credit = deriveCreditInfo(
      makeStatus({
        mode: "api_key",
        paidKeyPrefix: "sk-abc",
        paidKeyTotal: 1000,
        paidKeyUsed: 100,
        paidKeyRemaining: 900,
      }),
    );
    expect(credit).toEqual({ used: 100, total: 1000, planLabel: "API key sk-abc" });
  });

  it("zero everywhere → 0/0 placeholder with sensible label", () => {
    const credit = deriveCreditInfo(makeStatus({ accessMode: "anonymous" }));
    expect(credit).toEqual({ used: 0, total: 0, planLabel: "anonymous" });
  });
});

describe("useCreditStatus", () => {
  it("fetches on mount and polls every 60 seconds", async () => {
    const spy = vi.fn(async () => makeStatus({ mode: "anonymous", freeTrialLimit: 100, freeTrialUsed: 10 }));
    officecli.getCreditStatus = spy as unknown as DesktopAPI["getCreditStatus"];

    const { result } = renderHook(() => useCreditStatus());
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.credit).toEqual({ used: 10, total: 100, planLabel: "Free trial" });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("refresh fires an extra fetch on demand", async () => {
    const spy = vi.fn(async () => makeStatus());
    officecli.getCreditStatus = spy as unknown as DesktopAPI["getCreditStatus"];

    const { result } = renderHook(() => useCreditStatus());
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.refresh();
    });
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("preserves last credit when fetch rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const spy = vi
      .fn<() => Promise<CreditStatus>>()
      .mockResolvedValueOnce(makeStatus({ mode: "anonymous", freeTrialLimit: 50, freeTrialUsed: 5 }))
      .mockRejectedValueOnce(new Error("boom"));
    officecli.getCreditStatus = spy as unknown as DesktopAPI["getCreditStatus"];

    const { result } = renderHook(() => useCreditStatus());
    await flush();
    expect(result.current.credit).toEqual({ used: 5, total: 50, planLabel: "Free trial" });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
    // Last successful credit is preserved when the second fetch fails.
    expect(result.current.credit).toEqual({ used: 5, total: 50, planLabel: "Free trial" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
