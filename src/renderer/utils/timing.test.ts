import { describe, expect, it } from "vitest";
import { delay } from "./timing";

describe("delay", () => {
  it("resolves asynchronously", async () => {
    let resolved = false;
    const pending = delay(0).then(() => { resolved = true; });
    expect(resolved).toBe(false);
    await pending;
    expect(resolved).toBe(true);
  });
});
