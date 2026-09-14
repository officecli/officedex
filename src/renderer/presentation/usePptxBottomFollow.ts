import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Growth below this is a status line or a footer word: short, stable, and worth
 * animating, so the eye can follow the new content instead of finding it already
 * displaced. A larger growth is a whole page card, and teleporting reads better
 * than a scroll still travelling when the next card lands.
 */
const SMOOTH_ANCHOR_MAX_PX = 120;

/** Already at the bottom: re-anchoring would be a no-op. */
const ANCHOR_DEAD_ZONE_PX = 2;

function scrollOwner(content: HTMLElement): HTMLElement {
  for (let parent = content.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY || getComputedStyle(parent).overflow)) return parent;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

/** Follow the workspace's real bottom, including its footer and asynchronous previews. */
export function usePptxBottomFollow(contentRef: RefObject<HTMLDivElement | null>, signature: string) {
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const frame = useRef<number | undefined>(undefined);
  const setFollow = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  }, []);
  const scrollLatest = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const content = contentRef.current;
      // Not following means the reader picked a position. Leaving scrollTop alone
      // is what holds that position: the browser's own scroll anchoring keeps the
      // element being read in place when content above it grows.
      if (!followingRef.current || !content || content.closest("[hidden], [data-home-entry-transition]")) return;
      const owner = scrollOwner(content);
      const target = owner.scrollHeight;
      const behind = target - owner.scrollTop - owner.clientHeight;
      if (behind <= ANCHOR_DEAD_ZONE_PX) return;
      owner.scrollTo?.({ top: target, behavior: behind < SMOOTH_ANCHOR_MAX_PX ? "smooth" : "instant" });
    });
  }, [contentRef]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const stage = content.parentElement ?? content;
    const owner = scrollOwner(content);
    const resize = new ResizeObserver(scrollLatest);
    resize.observe(stage);
    resize.observe(content);
    resize.observe(owner);
    // A mounted live flow may be hidden by Debug or the home-entry transition.
    const visibility = new MutationObserver(scrollLatest);
    for (let parent: HTMLElement | null = stage; parent; parent = parent.parentElement) {
      visibility.observe(parent, { attributes: true, attributeFilter: ["hidden", "data-home-entry-transition"] });
    }
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) setFollow(false); };
    let touchY: number | undefined;
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
    const touchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY;
      if (next !== undefined && touchY !== undefined && next > touchY) setFollow(false);
      touchY = next;
    };
    const key = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) setFollow(false);
    };
    owner.addEventListener("wheel", wheel, { passive: true });
    owner.addEventListener("touchstart", touchStart, { passive: true });
    owner.addEventListener("touchmove", touchMove, { passive: true });
    owner.addEventListener("keydown", key);
    return () => {
      resize.disconnect();
      visibility.disconnect();
      owner.removeEventListener("wheel", wheel);
      owner.removeEventListener("touchstart", touchStart);
      owner.removeEventListener("touchmove", touchMove);
      owner.removeEventListener("keydown", key);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [contentRef, scrollLatest, setFollow]);
  useLayoutEffect(scrollLatest, [signature, scrollLatest]);
  return { following, setFollow, scrollLatest };
}
