import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost, ToastViewport, toast } from "./toast";

describe("toast lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); toast.destroy(); });
  afterEach(() => { cleanup(); toast.destroy(); vi.useRealTimers(); });

  it("shows the configured countdown and retains the toast through its exit", () => {
    render(<ToastHost />);
    act(() => { toast.info({ content: "Saved", duration: 1000 }); });
    expect(document.querySelector<HTMLElement>(".od-toast__progress > span")!.style.animationDuration).toBe("1000ms");
    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    act(() => { vi.advanceTimersByTime(1); });
    expect(document.querySelector(".od-toast-slot")).toHaveAttribute("data-exiting", "true");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(220); });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("keeps loading notices until explicitly closed and animates manual dismissal", () => {
    render(<ToastHost />);
    act(() => { toast.loading("Working"); });
    expect(document.querySelector(".od-toast__progress")).toBeNull();
    act(() => { vi.advanceTimersByTime(10000); });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.querySelector(".od-toast-slot")).toHaveAttribute("inert");
    act(() => { vi.advanceTimersByTime(220); });
    expect(screen.queryByText("Working")).toBeNull();
  });

  it("does not restart an existing countdown when another toast arrives", () => {
    act(() => { toast.info({ content: "First", duration: 2000 }); });
    act(() => { vi.advanceTimersByTime(500); });
    render(<ToastHost />);
    const progress = document.querySelector<HTMLElement>(".od-toast__progress > span")!;
    expect(progress.style.animationDelay).toBe("-500ms");
    act(() => { vi.advanceTimersByTime(500); toast.info("Second"); });
    expect(progress.style.animationDelay).toBe("-500ms");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Second");
  });

  it("replaces a keyed notice and restarts its timeout", () => {
    render(<ToastHost />);
    let first = "";
    act(() => { first = toast.info({ key: "mode", content: "On", duration: 1000 }); });
    act(() => { vi.advanceTimersByTime(800); });
    let second = "";
    act(() => { second = toast.info({ key: "mode", content: "Off", duration: 1000 }); });
    expect(second).toBe(first);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText("On")).toBeNull();
    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.getByRole("status")).toHaveTextContent("Off");
    act(() => { vi.advanceTimersByTime(221); });
    expect(screen.queryByText("Off")).toBeNull();
  });

  it("uses the reserved viewport and returns to the global host after it unmounts", () => {
    const view = render(<><ToastViewport className="reserved" /><ToastHost /></>);
    act(() => { toast.info("Message"); });
    expect(document.querySelector(".reserved .od-toast-host--anchored")).toHaveTextContent("Message");
    view.rerender(<ToastHost />);
    expect(document.querySelector(".od-toast-host--anchored")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Message");
  });

  it("clears both countdown and exit timers on destroy", () => {
    render(<ToastHost />);
    let id = "";
    act(() => { id = toast.info("First"); toast.info("Second"); });
    act(() => { toast.dismiss(id); toast.destroy(); });
    expect(document.querySelector(".od-toast-host")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
