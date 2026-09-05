import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMopRuntimeEntry } from "./mop-runtime-source";

describe("resolveMopRuntimeEntry", () => {
  it("prefers the runtime shipped with the selected Rust converter checkout", () => {
    const preferredRoot = path.resolve("work", "ppt2mop");
    const existing = new Set([
      path.join(preferredRoot, "runtime", "index.js"),
      path.join(preferredRoot, "spec", "mop", "layout.json"),
    ]);

    expect(
      resolveMopRuntimeEntry({
        fallbackEntry: path.resolve(
          "work",
          "presentation",
          "mop",
          "runtime",
          "index.js",
        ),
        preferredRoot,
        exists: (candidate) => existing.has(candidate),
      }),
    ).toBe(path.join(preferredRoot, "runtime", "index.js"));
  });

  it("uses the staged Presentation runtime when no converter checkout is available", () => {
    const fallbackEntry = path.resolve(
      "release",
      "presentation",
      "mop",
      "runtime",
      "index.js",
    );
    expect(
      resolveMopRuntimeEntry({
        fallbackEntry,
        preferredRoot: path.resolve("release", "ppt2mop"),
        exists: () => false,
      }),
    ).toBe(fallbackEntry);
  });

  it("rejects an explicitly configured incomplete checkout", () => {
    expect(() =>
      resolveMopRuntimeEntry({
        fallbackEntry: path.resolve(
          "release",
          "presentation",
          "mop",
          "runtime",
          "index.js",
        ),
        preferredRoot: path.resolve("broken", "ppt2mop"),
        requirePreferred: true,
        exists: () => false,
      }),
    ).toThrow("PPT2MOP_SOURCE_DIR is incomplete");
  });
});
