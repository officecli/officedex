import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePptxBottomFollow } from "./usePptxBottomFollow";

function Flow({ signature = "start", hidden = false }) {
  const ref = useRef<HTMLDivElement>(null);
  const { following, setFollow, scrollLatest } = usePptxBottomFollow(ref, signature);
  return <div data-testid="owner" style={{ overflowY: "auto" }}>
    <section hidden={hidden}><div ref={ref}>Progress</div>
      <button onClick={() => { setFollow(true); scrollLatest(); }}>{following ? "Following" : "Resume"}</button>
    </section>
  </div>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("follows late layout growth, pauses for review and resumes at the full bottom", async () => {
  let resize!: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.spyOn(globalThis, "ResizeObserver").mockImplementation(function(callback) {
    resize = callback;
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect };
  });
  const view = render(<Flow />);
  const owner = screen.getByTestId("owner");
  let height = 1800;
  Object.defineProperty(owner, "scrollHeight", { get: () => height });
  owner.scrollTo = vi.fn();
  await waitFor(() => expect(owner.scrollTo).toHaveBeenLastCalledWith({ top: 1800, behavior: "instant" }));
  height = 2400;
  act(() => resize([], {} as ResizeObserver));
  await waitFor(() => expect(owner.scrollTo).toHaveBeenLastCalledWith({ top: 2400, behavior: "instant" }));
  fireEvent.wheel(owner, { deltaY: -100 });
  height = 3000;
  act(() => resize([], {} as ResizeObserver));
  view.rerender(<Flow signature="new runtime progress" />);
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(owner.scrollTo).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText("Resume"));
  await waitFor(() => expect(owner.scrollTo).toHaveBeenLastCalledWith({ top: 3000, behavior: "instant" }));
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("does not let a hidden live flow move the debug viewport; resumes when visible", async () => {
  const view = render(<Flow hidden />);
  const owner = screen.getByTestId("owner");
  owner.scrollTo = vi.fn();
  Object.defineProperty(owner, "scrollHeight", { value: 2200 });
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(owner.scrollTo).not.toHaveBeenCalled();
  view.rerender(<Flow />);
  await waitFor(() => expect(owner.scrollTo).toHaveBeenCalledWith({ top: 2200, behavior: "instant" }));
});

it("follows new progress without a phase or slide count change", async () => {
  const view = render(<Flow signature="Slide 3: preparing" />);
  const owner = screen.getByTestId("owner");
  owner.scrollTo = vi.fn();
  Object.defineProperty(owner, "scrollHeight", { value: 2000 });
  await waitFor(() => expect(owner.scrollTo).toHaveBeenCalledOnce());
  view.rerender(<Flow signature="Slide 3: generating images" />);
  await waitFor(() => expect(owner.scrollTo).toHaveBeenCalledTimes(2));
});

it("animates a short catch-up and teleports across a long one", async () => {
  const view = render(<Flow />);
  const owner = screen.getByTestId("owner");
  owner.scrollTo = vi.fn();
  let height = 1000;
  Object.defineProperty(owner, "scrollHeight", { get: () => height });
  Object.defineProperty(owner, "clientHeight", { value: 900, configurable: true });
  // 10px behind: a status line. Short enough to animate, so the eye can follow it.
  owner.scrollTop = 90;
  view.rerender(<Flow signature="status word" />);
  await waitFor(() => expect(owner.scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: "smooth" }));
  // 1100px behind: a whole page card is not something to animate towards.
  height = 2000;
  owner.scrollTop = 0;
  view.rerender(<Flow signature="new page" />);
  await waitFor(() => expect(owner.scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: "instant" }));
});

it("does not re-anchor when the viewport is already at the bottom", async () => {
  const view = render(<Flow />);
  const owner = screen.getByTestId("owner");
  owner.scrollTo = vi.fn();
  Object.defineProperty(owner, "scrollHeight", { value: 1000 });
  Object.defineProperty(owner, "clientHeight", { value: 1000, configurable: true });
  owner.scrollTop = 0;
  view.rerender(<Flow signature="nothing to catch up" />);
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(owner.scrollTo).not.toHaveBeenCalled();
});
