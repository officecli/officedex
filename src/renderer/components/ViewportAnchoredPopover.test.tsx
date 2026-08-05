import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewportAnchoredPopover } from "./ViewportAnchoredPopover";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ViewportAnchoredPopover", () => {
  it("registers an aligner for an open popover and clears it when closed", () => {
    const onAlignerChange = vi.fn();
    const dispatchEvent = vi.spyOn(window, "dispatchEvent");
    const { rerender } = render(
      <ViewportAnchoredPopover open onAlignerChange={onAlignerChange} content={<div>Confirm</div>}>
        <button>Node</button>
      </ViewportAnchoredPopover>,
    );
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "resize" }));
    const aligner = onAlignerChange.mock.calls.at(-1)?.[0] as VoidFunction;
    aligner();
    expect(dispatchEvent).toHaveBeenCalledTimes(2);

    rerender(
      <ViewportAnchoredPopover open={false} onAlignerChange={onAlignerChange} content={<div>Confirm</div>}>
        <button>Node</button>
      </ViewportAnchoredPopover>,
    );
    expect(onAlignerChange).toHaveBeenLastCalledWith(null);
  });

  it("does not register or align a popover that starts closed", () => {
    const onAlignerChange = vi.fn();
    render(
      <ViewportAnchoredPopover open={false} onAlignerChange={onAlignerChange} content={<div>Confirm</div>}>
        <button>Node</button>
      </ViewportAnchoredPopover>,
    );
    expect(onAlignerChange).not.toHaveBeenCalled();
  });
});
