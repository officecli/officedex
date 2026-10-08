import { describe, expect, it } from "vitest";
import { classifyError, classifyStatusEvent, extractStderr, stripFailureTag } from "./failureKind";

describe("failureKind", () => {
  it("reads the kind Go tagged onto the error, wherever wrapping put it", () => {
    expect(classifyError("[kind:auth] custom_provider.login_required")).toBe("auth");
    expect(classifyError("save pptx: [kind:connection] bridge: officecli agent-bridge is not running")).toBe("connection");
    expect(classifyError("[kind:setup] bridge: spawn officecli (/x/officecli): no such file")).toBe("setup");
    expect(classifyError("[kind:task] bridge: content generation failed")).toBe("task");
  });

  it("no longer guesses from wording", () => {
    // Each of these used to be classified by a substring; without a tag they
    // are "other", and the banner offers a plain retry.
    expect(classifyError("please login first")).toBe("other");
    expect(classifyError("ENOENT: officecli")).toBe("other");
    expect(classifyError("status=429 rate limit")).toBe("other");
    expect(classifyError("上游饱和")).toBe("other");
  });

  it("finds a tag carried in stderr", () => {
    expect(classifyError("bridge exited", "[kind:setup] binary not found")).toBe("setup");
  });

  it("prefers the kind a status event states", () => {
    expect(classifyStatusEvent("setup", "OfficeCLI binary not found")).toBe("setup");
    expect(classifyStatusEvent("bogus", "[kind:connection] gone")).toBe("connection");
    expect(classifyStatusEvent(undefined, "gone")).toBe("other");
  });

  it("strips the tag for display and keeps the stderr marker intact", () => {
    expect(stripFailureTag("[kind:auth] custom_provider.login_required")).toBe("custom_provider.login_required");
    const text = "[kind:connection] bridge: exited\nstderr:\nboom";
    expect(stripFailureTag(text)).toBe("bridge: exited\nstderr:\nboom");
    expect(extractStderr(text)).toBe("boom");
  });
});
