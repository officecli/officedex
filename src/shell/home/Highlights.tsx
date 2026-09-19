import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderKanban,
  Play,
  Presentation,
  Table2,
  type LucideIcon,
} from "lucide-react";

import { useT } from "../../renderer/i18n";
import { useComposerSettings } from "../composer/useComposerSettings";
import { notBuiltYet } from "../port/reportPortFailure";
import "./highlights.css";

/**
 * Home's feature-video shelf — the shelf is real, the films are not.
 *
 * The prototype puts a row of short films here, one per document type plus one
 * for projects, behind a carousel and a modal player. None of that footage
 * exists in this repository and none of it is being cut right now, so the only
 * honest thing to ship is the shelf itself: the carousel, the keyboard, the
 * focus order and the layout are the real ones, and the single step that has
 * nothing behind it — pressing play — says so (`notBuiltYet`, the same rule the
 * rest of the shell follows).
 *
 * The alternative, rendering nothing until there is footage, was rejected
 * twice over: an empty band under a heading reads as a load failure, and a
 * shelf that appears only on the day the videos land is a layout nobody has
 * ever seen in place.
 */

interface Highlight {
  /** Doubles as the file stem of the still and the film: `{id}.jpg` / `{id}.mp4`. */
  id: string;
  /** Dictionary key; the copy itself lives in en.ts / zh.ts. */
  titleKey: string;
  /** The product area, shown next to the title — also a key. */
  typeKey: string;
  duration: string;
}

/**
 * Fixed copy, not port data.
 *
 * These four are a marketing artefact — what the films are about — not a view
 * of the user's workspace, so they are written here rather than fetched. When
 * the reel changes, this list changes with it.
 */
const HIGHLIGHTS: Highlight[] = [
  {
    id: "word",
    titleKey: "shell.highlights.word.title",
    typeKey: "shell.home.documents",
    duration: "1:08",
  },
  {
    id: "sheet",
    titleKey: "shell.highlights.sheet.title",
    typeKey: "shell.highlights.sheet.type",
    duration: "0:53",
  },
  {
    id: "slides",
    titleKey: "shell.highlights.slides.title",
    typeKey: "shell.home.presentations",
    duration: "1:04",
  },
  {
    id: "project",
    titleKey: "shell.highlights.project.title",
    typeKey: "shell.highlights.project.type",
    duration: "1:00",
  },
];

/**
 * The watermark each empty poster wears.
 *
 * A blank grey rectangle reads as a broken image. A tinted panel carrying the
 * glyph of the thing the film is about reads as a still that has not been shot
 * yet — which is the truth. Three of the four reuse the format glyphs the rest
 * of the shell already uses for that type (`FileTypeIcon`); projects are not a
 * document format and have none, so they borrow the board glyph.
 */
const POSTER_GLYPH: Record<string, LucideIcon> = {
  word: FileText,
  sheet: Table2,
  slides: Presentation,
  project: FolderKanban,
};

/**
 * Where the still will live once someone shoots it.
 *
 * Kept as a real attribute on the poster rather than a comment so the swap is
 * a one-line change with a visible anchor: drop the files in `public/assets/
 * highlights/`, then render `data-asset` as an `<img src>`.
 */
const posterAsset = (id: string) => `assets/highlights/${id}.jpg`;

export function Highlights() {
  const t = useT();
  const settings = useComposerSettings();
  const trackRef = useRef<HTMLDivElement>(null);

  /**
   * Which end of the track is already showing, which is what the two arrows
   * are: an arrow that scrolls nowhere is worse than a disabled one, because
   * the user presses it twice before believing it.
   *
   * Seeded as "at the start, not at the end" so the first paint matches what a
   * fresh track looks like; the effect below corrects it a frame later for the
   * case where the whole reel fits and neither arrow has anything to do.
   */
  const [reach, setReach] = useState({ atStart: true, atEnd: false });

  const syncReach = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const last = track.scrollWidth - track.clientWidth;
    // Two pixels of slack: momentum scrolling and `scrollBy` both land on
    // fractional offsets, so an exact comparison leaves the arrow at the end of
    // the track enabled forever.
    setReach({ atStart: track.scrollLeft < 2, atEnd: track.scrollLeft >= last - 2 });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    syncReach();
    track.addEventListener("scroll", syncReach, { passive: true });
    // The track is elastic: the shelf reflows when the agent column is docked
    // or the window is resized, and both change which arrow has work to do
    // without anyone scrolling.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncReach);
    observer?.observe(track);
    window.addEventListener("resize", syncReach);
    return () => {
      track.removeEventListener("scroll", syncReach);
      observer?.disconnect();
      window.removeEventListener("resize", syncReach);
    };
  }, [syncReach]);

  const behavior: ScrollBehavior = settings.value.reduceMotion ? "instant" : "smooth";

  const page = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    // The gap lives in the stylesheet and is read back from it rather than
    // repeated here: a page that ignored it would leave the card it scrolled to
    // a gap-width short of the edge, drifting further out of alignment with
    // every press.
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    track.scrollBy?.({ left: direction * (track.clientWidth + gap), behavior });
  };

  /**
   * Arrow keys walk the cards.
   *
   * A horizontal strip that only answers Tab makes the user tab through the
   * whole reel to reach the rest of Home. Focus stops at both ends rather than
   * wrapping, so the keyboard agrees with the arrow buttons about where the
   * reel ends.
   */
  const onTrackKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const track = trackRef.current;
    if (!track) return;
    const cards = [...track.querySelectorAll<HTMLButtonElement>("[data-highlight]")];
    const index = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = cards[Math.min(cards.length - 1, Math.max(0, index + step))];
    // Focus first and scroll second, with the browser's own scroll suppressed:
    // focus jumps the card fully into view, which fights the smooth scroll that
    // follows and lands the track between two cards.
    next.focus({ preventScroll: true });
    // Guarded because scrolling is the nicety and moving focus is the job —
    // jsdom and any other host without a layout engine implement neither of
    // these methods, and the keyboard must not go down with them.
    next.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior });
  };

  return (
    <section className="shell-highlights" aria-labelledby="shell-highlights-title">
      <header className="shell-highlights-head">
        <h2 id="shell-highlights-title">{t("shell.highlights.title")}</h2>
        <div className="shell-highlights-controls">
          <button
            type="button"
            aria-label={t("shell.highlights.previous")}
            aria-controls="shell-highlights-track"
            disabled={reach.atStart}
            onClick={() => page(-1)}
          >
            <ChevronLeft size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("shell.highlights.next")}
            aria-controls="shell-highlights-track"
            disabled={reach.atEnd}
            onClick={() => page(1)}
          >
            <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={trackRef}
        id="shell-highlights-track"
        className="shell-highlights-track"
        role="region"
        aria-label={t("shell.highlights.trackAria")}
        onKeyDown={onTrackKeyDown}
      >
        {HIGHLIGHTS.map((item) => {
          const Glyph = POSTER_GLYPH[item.id] ?? FileText;
          const title = t(item.titleKey);
          return (
            <button
              key={item.id}
              type="button"
              className="shell-highlight-card"
              data-highlight={item.id}
              aria-label={t("shell.highlights.play", { title, duration: item.duration })}
              onClick={() => notBuiltYet("home-highlights", t("shell.highlights.notFilmed"))}
            >
              <span
                className="shell-highlight-poster"
                data-tone={item.id}
                data-asset={posterAsset(item.id)}
              >
                <Glyph
                  className="shell-highlight-watermark"
                  size={64}
                  strokeWidth={1}
                  aria-hidden="true"
                />
                <span className="shell-highlight-play" aria-hidden="true">
                  <Play size={17} strokeWidth={0} fill="currentColor" />
                </span>
                <span className="shell-highlight-duration" aria-hidden="true">
                  {item.duration}
                </span>
              </span>
              <span className="shell-highlight-caption">
                <strong>{title}</strong>
                <small>{t(item.typeKey)}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
