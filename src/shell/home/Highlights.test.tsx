import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Highlights } from "./Highlights";
import { PortProvider } from "../port/PortContext";
import { createFakePort } from "../port/fake/createFakePort";
import { seedSettings } from "../port/fake/seed";
import { ToastHost, toast } from "../../renderer/ui";

/**
 * The shelf ships with everything working except the one thing that needs
 * footage, so these assert the two halves separately: the carousel behaves like
 * a carousel, and pressing play says why nothing plays.
 *
 * jsdom has no layout engine — every box is 0×0 and neither `scrollBy` nor
 * `scrollIntoView` exists — so any test about scrolling has to install both the
 * metrics and the methods. That is done per-test rather than globally: the
 * numbers *are* the test.
 */

afterEach(() => {
  toast.destroy();
  cleanup();
});

async function mountShelf(options: { reduceMotion?: boolean } = {}) {
  const port = createFakePort({
    settings: { ...seedSettings(), reduceMotion: options.reduceMotion ?? false },
  });
  const view = render(
    <PortProvider port={port}>
      <ToastHost />
      <Highlights />
    </PortProvider>,
  );
  const track = view.container.querySelector<HTMLElement>(".shell-highlights-track")!;
  // Settings arrive from the port one microtask after mount, and `reduceMotion`
  // among them decides the scroll behaviour asserted below — so let them land
  // before any test reads the component's behaviour.
  await act(async () => {});
  return { view, track };
}

const cards = (track: HTMLElement) => [...track.querySelectorAll<HTMLButtonElement>("[data-highlight]")];
const arrow = (view: { container: HTMLElement }, label: string) =>
  view.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const previous = (view: { container: HTMLElement }) => arrow(view, "Previous highlight videos");
const next = (view: { container: HTMLElement }) => arrow(view, "Next highlight videos");

/**
 * Fakes a track wider than its viewport, and gives it the scroll methods jsdom
 * omits. `scrollLeft` has to be redefined too: jsdom clamps the real property
 * to 0 because, as far as it knows, nothing overflows.
 */
function withScrollableTrack(track: HTMLElement, { viewport = 900, content = 1600 } = {}) {
  let scrollLeft = 0;
  Object.defineProperty(track, "clientWidth", { configurable: true, value: viewport });
  Object.defineProperty(track, "scrollWidth", { configurable: true, value: content });
  Object.defineProperty(track, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  const scrollBy = vi.fn();
  Object.defineProperty(track, "scrollBy", { configurable: true, value: scrollBy });
  return {
    scrollBy,
    /** Moves the track and tells the component, the way a real scroll would. */
    scrollTo(offset: number) {
      track.scrollLeft = offset;
      fireEvent.scroll(track);
    },
  };
}

describe("Highlights", () => {
  it("shelves one card per film, with its subject and its running time", async () => {
    const { track } = await mountShelf();
    expect(cards(track)).toHaveLength(4);

    const first = cards(track)[0];
    expect(first.getAttribute("aria-label")).toBe("Play Write and edit together, 1:08");
    expect(first.textContent).toContain("Documents");
    expect(first.textContent).toContain("1:08");
    expect(cards(track).map((card) => card.dataset.highlight)).toEqual([
      "word",
      "sheet",
      "slides",
      "project",
    ]);
  });

  // The posters are empty on purpose; this pins the slot each still drops into
  // so swapping a comment-only convention cannot quietly lose it.
  it("keeps a named slot for the still that has not been shot", async () => {
    const { track } = await mountShelf();
    const posters = [...track.querySelectorAll<HTMLElement>(".shell-highlight-poster")];
    expect(posters.map((poster) => poster.dataset.asset)).toEqual([
      "assets/highlights/word.jpg",
      "assets/highlights/sheet.jpg",
      "assets/highlights/slides.jpg",
      "assets/highlights/project.jpg",
    ]);
    // No <img> anywhere: a missing file would draw a broken-image glyph, which
    // is the one thing the placeholder exists to avoid.
    expect(track.querySelectorAll("img")).toHaveLength(0);
  });

  it("disables the arrow that would scroll nowhere", async () => {
    const { view, track } = await mountShelf();
    const scroll = withScrollableTrack(track);

    scroll.scrollTo(0);
    expect(previous(view).disabled).toBe(true);
    expect(next(view).disabled).toBe(false);

    scroll.scrollTo(400);
    expect(previous(view).disabled).toBe(false);
    expect(next(view).disabled).toBe(false);

    // 1600 - 900: the last pixel of the reel.
    scroll.scrollTo(700);
    expect(previous(view).disabled).toBe(false);
    expect(next(view).disabled).toBe(true);
  });

  // A reel that fits needs neither arrow.
  it("disables both arrows when the whole reel is already showing", async () => {
    const { view, track } = await mountShelf();
    const scroll = withScrollableTrack(track, { viewport: 900, content: 900 });
    scroll.scrollTo(0);
    expect(previous(view).disabled).toBe(true);
    expect(next(view).disabled).toBe(true);
  });

  it("scrolls a viewport at a time, in the direction pressed", async () => {
    const { view, track } = await mountShelf();
    const scroll = withScrollableTrack(track);
    scroll.scrollTo(400);

    fireEvent.click(next(view));
    expect(scroll.scrollBy).toHaveBeenLastCalledWith({ left: 900, behavior: "smooth" });

    fireEvent.click(previous(view));
    expect(scroll.scrollBy).toHaveBeenLastCalledWith({ left: -900, behavior: "smooth" });
  });

  it("drops the animation when the user asked for less motion", async () => {
    const { view, track } = await mountShelf({ reduceMotion: true });
    const scroll = withScrollableTrack(track);
    scroll.scrollTo(400);

    fireEvent.click(next(view));
    expect(scroll.scrollBy).toHaveBeenLastCalledWith({ left: 900, behavior: "instant" });
  });

  it("walks the cards with the arrow keys and stops at both ends", async () => {
    const { track } = await mountShelf();
    const [first, second, , last] = cards(track);
    for (const card of cards(track)) {
      Object.defineProperty(card, "scrollIntoView", { configurable: true, value: vi.fn() });
    }

    first.focus();
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);

    // Already at the left edge: focus stays put rather than wrapping to the end.
    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(document.activeElement).toBe(last);
  });

  it("brings the card it moved to into view", async () => {
    const { track } = await mountShelf();
    const [first, second] = cards(track);
    const scrollIntoView = vi.fn();
    Object.defineProperty(second, "scrollIntoView", { configurable: true, value: scrollIntoView });

    first.focus();
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  });

  // Keys the strip does not own must reach the rest of Home.
  it("leaves other keys alone", async () => {
    const { track } = await mountShelf();
    cards(track)[0].focus();
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    track.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  // The one step with nothing behind it: there is no footage in the repo, so
  // the card says so rather than opening an empty player.
  it("says the films are not here yet when a card is pressed", async () => {
    const { track } = await mountShelf();
    fireEvent.click(cards(track)[0]);

    await waitFor(() => {
      expect(document.body.textContent).toContain("Not built yet");
    });
    expect(document.body.textContent).toContain("have not been filmed yet");
  });

  // Four presses, one notice — `notBuiltYet` is keyed, and a shelf of four
  // cards is exactly where an unkeyed notice would stack.
  it("does not stack one notice per card", async () => {
    const { track } = await mountShelf();
    for (const card of cards(track)) fireEvent.click(card);

    await waitFor(() => {
      expect(document.body.textContent).toContain("Not built yet");
    });
    expect(document.body.querySelectorAll(".od-toast-slot")).toHaveLength(1);
  });
});
