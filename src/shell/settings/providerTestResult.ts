import type { ProviderTestResult } from "../../shared/types";

/**
 * The eleven sentences a provider test can come back with.
 *
 * A verbatim port of `formatTestResult` in
 * `renderer/components/ProviderForm.tsx`. It is copied rather than imported
 * because importing that module would put the legacy `provider-hint` class into
 * the shell bundle's module graph, and `scripts/verify-shell-styles.mjs` fails
 * on any class the shell reaches that the shell's own CSS does not define. The
 * alternative — defining `provider-hint` in `settings.css` for a component the
 * shell never renders — is a rule that exists only to silence a gate.
 *
 * Keep the two in step: the result strings are user-visible content, and the
 * audit lists them as legacy items 62–66.
 */
export function formatProviderTestResult(
  result: ProviderTestResult,
  t: (key: string) => string,
): { tone: "green" | "red" | "amber"; text: string } {
  if (result.unavailable) {
    return { tone: "amber", text: t("settings.effective.testUnavailable") };
  }
  if (result.probeType === "officialPaid") {
    if (result.ok) {
      return {
        tone: "green",
        text: t("settings.effective.testOkOfficialPaid").replace("{latency}", String(result.latencyMs)),
      };
    }
    return {
      tone: "red",
      text: t("settings.effective.testFailOfficialPaid").replace("{error}", result.error || t("shell.misc.unknownError")),
    };
  }
  if (result.error && result.httpStatus === 0 && !result.ok) {
    return { tone: "red", text: t("settings.effective.testNetworkError").replace("{error}", result.error) };
  }
  if (result.ok) {
    const base =
      result.httpStatus > 0
        ? t("settings.effective.testOkHttp")
            .replace("{status}", String(result.httpStatus))
            .replace("{latency}", String(result.latencyMs))
        : t("settings.effective.testOkBridge").replace("{latency}", String(result.latencyMs));
    if (result.responseMessage) {
      return { tone: "green", text: base + ` · ${t("settings.effective.testReply")}: ${result.responseMessage}` };
    }
    return { tone: "green", text: base };
  }
  const status = result.httpStatus;
  let key = "settings.effective.testFail";
  if (status === 401 || status === 403) key = "settings.effective.testFailAuth";
  else if (status === 404) key = "settings.effective.testFailNotFound";
  else if (status >= 500) key = "settings.effective.testFailUpstream";
  return {
    tone: "red",
    text: t(key).replace("{status}", String(status)),
  };
}

/** `Tag` takes a tone name, not the three-word one this formatter returns. */
export function tagTone(tone: "green" | "red" | "amber"): "success" | "danger" | "warning" {
  return tone === "green" ? "success" : tone === "red" ? "danger" : "warning";
}
