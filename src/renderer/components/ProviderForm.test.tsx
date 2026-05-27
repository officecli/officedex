import { describe, expect, it } from "vitest";
import { formatTestResult } from "./ProviderForm";

const messages: Record<string, string> = {
  "settings.effective.testUnavailable": "Official provider self-test is not available",
  "settings.effective.testOkHttp": "HTTP {status} · {latency} ms",
  "settings.effective.testOkBridge": "OK · {latency} ms",
  "settings.effective.testOkOfficialPaid": "Official generation probe passed · {latency} ms",
  "settings.effective.testReply": "Reply",
  "settings.effective.testFail": "HTTP {status}",
  "settings.effective.testFailAuth": "HTTP {status} · key rejected",
  "settings.effective.testFailNotFound": "HTTP {status} · endpoint not found",
  "settings.effective.testFailUpstream": "HTTP {status} · upstream error",
  "settings.effective.testFailOfficialPaid": "Official generation probe failed · {error}",
  "settings.effective.testNetworkError": "Network error · {error}",
};

const t = (key: string) => messages[key] ?? key;

describe("formatTestResult", () => {
  it("renders paid official probe success separately from bridge/http checks", () => {
    expect(formatTestResult({
      ok: true,
      httpStatus: 0,
      latencyMs: 42,
      url: "official",
      probeType: "officialPaid",
    }, t)).toEqual({
      tone: "green",
      text: "Official generation probe passed · 42 ms",
    });
  });

  it("renders paid official probe failure without labeling it as a network error", () => {
    expect(formatTestResult({
      ok: false,
      httpStatus: 0,
      latencyMs: 12,
      url: "official",
      probeType: "officialPaid",
      error: "not enough credits",
    }, t)).toEqual({
      tone: "red",
      text: "Official generation probe failed · not enough credits",
    });
  });
});
