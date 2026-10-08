import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopCanvasDeps } from "../../canvas/createDesktopCanvas";

/**
 * How an editor's "could not start" is filed.
 *
 * Every leaf reports through one string, and the shell used to file all of
 * them under "not built yet" — a notice that went away by itself. That is right
 * for a runtime that is not staged and wrong for everything else: a token the
 * host refused is a failure, and a failure stays on screen.
 */
let deps: DesktopCanvasDeps | null = null;
const notice = vi.fn();
const toastError = vi.fn();

vi.mock("../../canvas/createDesktopCanvas", () => ({
  createDesktopCanvas: (given: DesktopCanvasDeps) => {
    deps = given;
    return {};
  },
}));
vi.mock("../../renderer/bridge/select", () => ({
  hasDesktopBackend: () => true,
  createDesktopAPI: () => ({}),
  readBridgeEnvironment: () => ({}),
}));
vi.mock("../kit/layers", () => ({ notice: (text: string) => notice(text) }));
vi.mock("../../renderer/ui", () => ({ toast: { error: (input: unknown) => toastError(input), dismiss: vi.fn() } }));
vi.mock("./shellLog", () => ({ logShellEvent: vi.fn() }));

const { createShellCanvas } = await import("./createShellCanvas");

afterEach(() => {
  notice.mockClear();
  toastError.mockClear();
});

describe("createShellCanvas", () => {
  it("files a missing editor runtime as a gap, said once in a notice", () => {
    createShellCanvas();
    deps!.onUnavailable("The Word editor could not start. Writer component assets are not installed.");
    expect(notice).toHaveBeenCalledWith("The Word editor could not start. Writer component assets are not installed.");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows anything else the editor could not do as a failure", () => {
    createShellCanvas();
    deps!.onUnavailable("The workbook editor could not start. preview token refused: outside the workspace");
    expect(notice).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      expect.objectContaining({ description: "The workbook editor could not start. preview token refused: outside the workspace" }),
    );
  });
});
