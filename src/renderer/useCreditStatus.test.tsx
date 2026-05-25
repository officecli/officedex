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
    anonymousCreditAvailable: null,
    anonymousCreditReserved: null,
    anonymousCreditBalance: null,
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
  it("anonymous credits → used = total - available, total = balance", () => {
    const credit = deriveCreditInfo(
      makeStatus({
        mode: "anonymous",
        anonymousCreditAvailable: 75,
        anonymousCreditReserved: 25,
        anonymousCreditBalance: 100,
      }),
    );
    expect(credit).toEqual({ displayMode: "quota", used: 25, total: 100, planLabel: "Credits" });
  });

  it("anonymous credits at full balance → 0/100", () => {
    const credit = deriveCreditInfo(
      makeStatus({
        mode: "anonymous",
        anonymousCreditAvailable: 100,
        anonymousCreditReserved: 0,
        anonymousCreditBalance: 100,
      }),
    );
    expect(credit).toEqual({ displayMode: "quota", used: 0, total: 100, planLabel: "Credits" });
  });

  it("logged_in + hostedCreditBalance → balance display, ignores any anonymous credits", () => {
    const credit = deriveCreditInfo(
      makeStatus({
        mode: "logged_in",
        hostedCreditBalance: 42,
        planName: "Pro",
        accessMode: "hosted",
        anonymousCreditAvailable: 5,
        anonymousCreditReserved: 0,
        anonymousCreditBalance: 5,
      }),
    );
    expect(credit).toEqual({ displayMode: "balance", used: 0, total: 42, planLabel: "Pro" });
  });

  it("logged_in + hostedCreditBalance without planName → falls back to 'Hosted credits'", () => {
    const credit = deriveCreditInfo(
      makeStatus({
        mode: "logged_in",
        hostedCreditBalance: 12,
        accessMode: "",
      }),
    );
    expect(credit).toEqual({ displayMode: "balance", used: 0, total: 12, planLabel: "Hosted credits" });
  });

  it("anonymous with no anonymous-credits line → 0/0 fallback with 'Credits' label", () => {
    const credit = deriveCreditInfo(
      makeStatus({
        mode: "anonymous",
        anonymousCreditBalance: null,
      }),
    );
    expect(credit).toEqual({ displayMode: "quota", used: 0, total: 0, planLabel: "Credits" });
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
    expect(credit).toEqual({ displayMode: "quota", used: 100, total: 1000, planLabel: "API key sk-abc" });
  });

  it("zero everywhere → 0/0 placeholder with sensible label", () => {
    const credit = deriveCreditInfo(makeStatus({ accessMode: "anonymous" }));
    expect(credit).toEqual({ displayMode: "quota", used: 0, total: 0, planLabel: "anonymous" });
  });
});

describe("useCreditStatus", () => {
  it("fetches on mount and polls every 60 seconds", async () => {
    const spy = vi.fn(async () =>
      makeStatus({
        mode: "anonymous",
        anonymousCreditAvailable: 90,
        anonymousCreditReserved: 10,
        anonymousCreditBalance: 100,
      }),
    );
    officecli.getCreditStatus = spy as unknown as DesktopAPI["getCreditStatus"];

    const { result } = renderHook(() => useCreditStatus());
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.credit).toEqual({ displayMode: "quota", used: 10, total: 100, planLabel: "Credits" });

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
      .mockResolvedValueOnce(
        makeStatus({
          mode: "anonymous",
          anonymousCreditAvailable: 45,
          anonymousCreditReserved: 5,
          anonymousCreditBalance: 50,
        }),
      )
      .mockRejectedValueOnce(new Error("boom"));
    officecli.getCreditStatus = spy as unknown as DesktopAPI["getCreditStatus"];

    const { result } = renderHook(() => useCreditStatus());
    await flush();
    expect(result.current.credit).toEqual({ displayMode: "quota", used: 5, total: 50, planLabel: "Credits" });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
    // Last successful credit is preserved when the second fetch fails.
    expect(result.current.credit).toEqual({ displayMode: "quota", used: 5, total: 50, planLabel: "Credits" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
