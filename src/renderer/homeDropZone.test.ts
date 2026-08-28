import { describe, expect, it, afterEach } from "vitest";
import { dragHasFiles, getHomeDropZone, resetHomeDropZone, setHomeDropZone } from "./homeDropZone";

describe("homeDropZone", () => {
  afterEach(() => resetHomeDropZone());

  it("stores the active native drop target", () => {
    expect(getHomeDropZone()).toBeNull();
    setHomeDropZone("intake");
    expect(getHomeDropZone()).toBe("intake");
    setHomeDropZone("workspaces");
    expect(getHomeDropZone()).toBe("workspaces");
    setHomeDropZone(null);
    expect(getHomeDropZone()).toBeNull();
  });

  it("recognizes file drags and ignores text drags", () => {
    expect(dragHasFiles({ dataTransfer: { types: ["Files"] } as unknown as DataTransfer })).toBe(true);
    expect(dragHasFiles({ dataTransfer: { types: ["text/plain"] } as unknown as DataTransfer })).toBe(false);
    expect(dragHasFiles({ dataTransfer: null })).toBe(false);
  });
});
