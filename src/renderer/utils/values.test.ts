import { describe, expect, it } from "vitest";
import { errorMessage, recordValue, stringValue, trimmedStringValue } from "./values";

describe("value helpers", () => {
  it("coerces errors and primitive values without throwing", () => {
    expect(errorMessage(new Error("failed"))).toBe("failed");
    expect(errorMessage("failed")).toBe("failed");
    expect(stringValue("ok")).toBe("ok");
    expect(stringValue(42)).toBe("");
    expect(trimmedStringValue("  ok  ")).toBe("ok");
    expect(trimmedStringValue(null)).toBe("");
  });

  it("accepts plain records and rejects arrays or null", () => {
    const source = { request_id: "req-1" };
    expect(recordValue(source)).toBe(source);
    expect(recordValue([source])).toEqual({});
    expect(recordValue(null)).toEqual({});
  });
});
