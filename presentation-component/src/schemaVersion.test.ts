import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The two copies of the MOP capability pair agree.
 *
 * One pair is stamped on packages by this bridge, the other by
 * `internal/mophttp` on the packaged app's HTTP responses, and the editor
 * rejects any package whose headers differ from what its bundled WASM reports.
 * So they have to be the same number, and they were not: the runtime moved to
 * schema 1081, Go followed, this file stayed at 975, and every presentation
 * opened to "MOP schema mismatch: package=975, runtime=1081".
 *
 * Nothing else could catch it. The Go constant is already pinned against the
 * real engine by TestDefaultCapabilitiesMatchBundledWasm — which passed the
 * whole time, because it only ever knew about its own copy. This test is the
 * other half: Go is pinned to the truth, and this is pinned to Go.
 *
 * The right long-term shape is one constant read from the component manifest.
 * Until then, two constants that cannot drift apart is the next best thing.
 */

function constantFrom(path: string, pattern: RegExp): number {
  const match = pattern.exec(readFileSync(path, "utf8"));
  if (!match) throw new Error(`no capability constant in ${path}`);
  return Number(match[1]);
}

describe("MOP capabilities", () => {
  const go = "internal/mophttp/capabilities.go";
  const bridge = "presentation-component/src/officedex-host-bridge.ts";

  it("the bridge stamps the schema version Go advertises", () => {
    expect(constantFrom(bridge, /const MOP_SCHEMA_VERSION = (\d+)/))
      .toBe(constantFrom(go, /DefaultSchemaVersion\s+=\s+(\d+)/));
  });

  it("the bridge stamps the protocol version Go advertises", () => {
    expect(constantFrom(bridge, /const PROTOCOL_VERSION = (\d+)/))
      .toBe(constantFrom(go, /DefaultProtocolVersion\s+=\s+(\d+)/));
  });
});
