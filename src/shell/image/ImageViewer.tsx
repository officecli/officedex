import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { useT } from "../../renderer/i18n";
import "./imageViewer.css";

/**
 * A picture, as large as the window will take, and as close as you want.
 *
 * The canvas shows a generated picture inside a frame that also has to hold a
 * toolbar and a versions strip, so a 1536-pixel image arrives at a third of its
 * size and there was no way to see it any larger. This is that way: click the
 * picture, it grows out of where it was into the whole window, and it goes back
 * there when you are done.
 *
 * The interaction follows the image viewers our users already know (Feishu,
 * DingTalk, WeChat) rather than a document viewer's:
 *
 * - wheel and trackpad pinch zoom, *at the cursor*, so what you point at stays
 *   under the pointer;
 * - dragging moves a picture that is larger than the window;
 * - a click on the picture toggles between "fit" and actual pixels, and a click
 *   on the dark around it closes;
 * - ← / → step through the versions, Esc closes, + / − / 0 / 1 zoom.
 *
 * It is modal on purpose. The composer, the versions strip and the transcript
 * all stay mounted underneath, and nothing in them is reachable until it
 * closes — a viewer you could type past is a viewer you forget is open.
 *
 * Zoom is expressed against the picture's *natural* pixels, so "100%" means one
 * image pixel per CSS pixel whatever the window size, and the percentage in the
 * zoom bar is a fact about the file rather than about the screen.
 */

export interface ImageViewerProps {
  /** Object URL of the picture; null while its bytes are still being read. */
  src: string | null;
  title: string;
  /** One line under the title: version, position, format, pixels. */
  meta: string;
  /** Known natural size, when the canvas has measured it already. */
  natural: { width: number; height: number } | null;
  /**
   * Where the picture sits on the canvas right now, in viewport pixels.
   *
   * Read on open and again on close rather than passed once, because the canvas
   * underneath can re-lay out while the viewer is up (the window resizes, a
   * different version is selected) and the picture should return to where it
   * *is*, not to where it was.
   */
  origin: () => DOMRect | null;
  onPrevious?: () => void;
  onNext?: () => void;
  onDownload?: () => void;
  onClose: () => void;
}

type Size = { width: number; height: number };
type View = "fit" | { scale: number; x: number; y: number };
type Phase = "entering" | "open" | "leaving";

/** 800%: far enough to count pixels, not so far that a pan loses its place. */
const MAX_SCALE = 8;
/** One press of + or −, and one click of the zoom bar. */
const STEP = 1.25;
/** Pointer travel that turns a click into a drag. */
const DRAG_SLOP = 4;
/** Matches `--shell-duration`; the leave animation waits this long. */
const LEAVE_MS = 280;

/**
 * "Press Esc or click outside to close", once per session. Said the first time
 * because nothing on screen says it otherwise; not said again, because by then
 * it is noise over the picture.
 */
let escHintShown = false;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ImageViewer({
  src,
  title,
  meta,
  natural: knownNatural,
  origin,
  onPrevious,
  onNext,
  onDownload,
  onClose,
}: ImageViewerProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [natural, setNatural] = useState<Size | null>(knownNatural);
  const [stage, setStage] = useState<Size | null>(null);
  const [view, setView] = useState<View>("fit");
  /** Whether the next transform change eases or follows the pointer exactly. */
  const [animate, setAnimate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>(() => (prefersReducedMotion() ? "open" : "entering"));
  /** Where the picture is drawn while it is flying in from, or back to, the canvas. */
  const [ghost, setGhost] = useState<string | null>(null);

  const fit =
    natural && stage && stage.width > 0 && stage.height > 0
      ? Math.min(1, stage.width / natural.width, stage.height / natural.height)
      : 1;
  const current = view === "fit" ? { scale: fit, x: 0, y: 0 } : view;
  const zoomed = view !== "fit";

  /*
   * The picture actually decoded into the `<img>`. Stepping to another version
   * swaps `src` before the new bytes have a size, so until they load the
   * picture stays hidden rather than being drawn at the previous version's
   * dimensions.
   */
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    if (knownNatural) setNatural((previous) => previous ?? knownNatural);
  }, [knownNatural]);

  // A new version starts fitted, like the first one did.
  useEffect(() => {
    setAnimate(false);
    setView("fit");
  }, [src]);

  /* ------------------------------------------------------------ geometry */

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setStage((previous) =>
        previous && previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  /**
   * Keeps a picture larger than the stage covering it, and one smaller than
   * the stage centred in it, per axis. Without this a fast drag throws the
   * picture off screen and there is nothing left to grab to bring it back.
   */
  const settle = useCallback(
    (scale: number, x: number, y: number): View => {
      if (!natural || !stage) return "fit";
      if (scale <= fit * 1.001) return "fit";
      const spareX = Math.max(0, (natural.width * scale - stage.width) / 2);
      const spareY = Math.max(0, (natural.height * scale - stage.height) / 2);
      return { scale, x: clamp(x, -spareX, spareX), y: clamp(y, -spareY, spareY) };
    },
    [natural, stage, fit],
  );

  /** Zooms to `scale`, keeping the image point under `at` (viewport px) still. */
  const zoomTo = useCallback(
    (scale: number, at: { clientX: number; clientY: number } | null, eased: boolean) => {
      const element = stageRef.current;
      if (!natural || !stage || !element) return;
      const next = clamp(scale, fit, Math.max(fit, MAX_SCALE));
      const rect = element.getBoundingClientRect();
      const px = at ? at.clientX - (rect.left + rect.width / 2) : 0;
      const py = at ? at.clientY - (rect.top + rect.height / 2) : 0;
      setView((previous) => {
        const from = previous === "fit" ? { scale: fit, x: 0, y: 0 } : previous;
        const ratio = next / from.scale;
        return settle(next, px - (px - from.x) * ratio, py - (py - from.y) * ratio);
      });
      setAnimate(eased);
    },
    [natural, stage, fit, settle],
  );

  // Read by the native listeners below, which are bound once.
  const currentRef = useRef(current);
  currentRef.current = current;
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;

  // A resize re-clamps a zoomed picture; a fitted one follows `fit` by itself.
  useEffect(() => {
    setView((previous) => (previous === "fit" ? previous : settle(previous.scale, previous.x, previous.y)));
  }, [settle]);

  /** Actual pixels, or double the fit for a picture that is already smaller than the window. */
  const detailScale = Math.min(MAX_SCALE, Math.max(1, fit * 2));

  /* ------------------------------------------------ entering and leaving */

  /** The transform that draws the picture exactly over its place on the canvas. */
  const ghostFor = useCallback(
    (rect: DOMRect | null): string | null => {
      const element = stageRef.current;
      if (!rect || !natural || !element || rect.width <= 0) return null;
      const box = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2 - (box.left + box.width / 2);
      const y = rect.top + rect.height / 2 - (box.top + box.height / 2);
      return `translate(${x}px, ${y}px) scale(${rect.width / natural.width})`;
    },
    [natural],
  );

  /*
   * Enter: draw the picture over its place on the canvas for one frame, then
   * let it ease to its fitted place. Waits for a natural size — a picture whose
   * bytes are still arriving simply fades in instead of flying.
   */
  const originRef = useRef(origin);
  originRef.current = origin;
  const entered = useRef(false);
  const enter = useCallback(() => {
    setAnimate(true);
    setGhost(null);
    setPhase((previous) => (previous === "entering" ? "open" : previous));
  }, []);
  useLayoutEffect(() => {
    if (phase !== "entering" || entered.current) return;
    if (!natural || !stage) return;
    entered.current = true;
    setGhost(ghostFor(originRef.current()));
    setAnimate(false);
    // Two frames: the first paints the picture over the canvas, the second
    // starts the flight from there. Not cancelled on re-render on purpose —
    // the canvas underneath re-renders while this runs, and cancelling here
    // would strand the picture at its starting point.
    requestAnimationFrame(() => requestAnimationFrame(enter));
  }, [phase, natural, stage, ghostFor, enter]);

  // A picture that never measures (unreadable bytes) must not stay invisible.
  useEffect(() => {
    if (phase !== "entering") return;
    const timer = window.setTimeout(enter, 400);
    return () => window.clearTimeout(timer);
  }, [phase, enter]);

  const closingRef = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setAnimate(true);
    setGhost(ghostFor(originRef.current()));
    setPhase("leaving");
    window.setTimeout(onClose, LEAVE_MS);
  }, [ghostFor, onClose]);

  const [hint, setHint] = useState(() => !escHintShown);
  useEffect(() => {
    if (!hint) return;
    escHintShown = true;
    const timer = window.setTimeout(() => setHint(false), 2600);
    return () => window.clearTimeout(timer);
  }, [hint]);

  /* ---------------------------------------------------------------- focus */

  /*
   * Esc has to work however the viewer was reached, and the one thing that can
   * stop it is focus sitting in an `<iframe>`: the presentation and Word
   * editors are embedded frames, they stay mounted under the image surface
   * (decision 4), and a key pressed inside a frame never reaches this
   * document's `window`. The fixture shell has no editors, so this only ever
   * failed in the real app.
   *
   * So everything else in `#shell` is made `inert` for as long as the viewer
   * is up — an inert frame cannot take focus at all — and if focus leaves the
   * viewer anyway (a frame that focuses itself on a timer, a window switch),
   * it is taken back. Inert is lifted *before* focus goes back to the picture,
   * because the picture is inside what was inert.
   */
  useEffect(() => {
    const root = rootRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = root?.parentElement ?? null;
    const silenced = layer
      ? [...layer.children].filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element !== root && !element.hasAttribute("inert"),
        )
      : [];
    for (const element of silenced) element.setAttribute("inert", "");
    root?.focus({ preventScroll: true });

    const reclaim = () => {
      if (!root || closingRef.current) return;
      if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    };
    const onFocusIn = (event: FocusEvent) => {
      if (root && !root.contains(event.target as Node)) reclaim();
    };
    // Focus moving into a frame shows up here as the window losing it.
    const onBlur = () => window.setTimeout(reclaim, 0);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("blur", onBlur);
      for (const element of silenced) element.removeAttribute("inert");
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  /* ------------------------------------------------------------- keyboard */

  // Capture on window, like ⌘W in `FileTabs`: an embedded editor underneath
  // keeps document-level key handlers of its own, and none of them should see
  // an arrow key that was meant for this.
  const keysRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keysRef.current = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    let handled = true;
    switch (event.key) {
      case "Escape":
        close();
        break;
      case "ArrowLeft":
        if (onPrevious) onPrevious();
        else handled = false;
        break;
      case "ArrowRight":
        if (onNext) onNext();
        else handled = false;
        break;
      case "+":
      case "=":
        zoomTo(current.scale * STEP, null, true);
        break;
      case "-":
      case "_":
        zoomTo(current.scale / STEP, null, true);
        break;
      case "0":
        setAnimate(true);
        setView("fit");
        break;
      case "1":
        zoomTo(1, null, true);
        break;
      case "Tab":
        trapFocus(event, rootRef.current);
        return;
      default:
        handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keysRef.current(event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  /* ------------------------------------------------------ wheel and pinch */

  const wheelRef = useRef<(event: WheelEvent) => void>(() => {});
  const gestureRef = useRef<{ start: number } | null>(null);
  wheelRef.current = (event: WheelEvent) => {
    event.preventDefault();
    // Safari reports a pinch as gesture events *and* ctrl-wheel; count it once.
    if (gestureRef.current) return;
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const delta = clamp(event.deltaY * lines, -60, 60);
    // A pinch sends many small deltas; a wheel notch sends one large one.
    const rate = event.ctrlKey ? 0.012 : 0.004;
    zoomTo(current.scale * Math.exp(-delta * rate), event, false);
  };
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    // Not React's onWheel: that one is passive and cannot stop the page zooming.
    const onWheel = (event: WheelEvent) => wheelRef.current(event);
    type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureRef.current = { start: currentRef.current.scale };
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = gestureRef.current;
      if (!gesture) return;
      const { scale, clientX, clientY } = event as GestureEvent;
      zoomRef.current(gesture.start * scale, { clientX, clientY }, false);
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureRef.current = null;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("gesturestart", onGestureStart);
    element.addEventListener("gesturechange", onGestureChange);
    element.addEventListener("gestureend", onGestureEnd);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", onGestureStart);
      element.removeEventListener("gesturechange", onGestureChange);
      element.removeEventListener("gestureend", onGestureEnd);
    };
  }, []);

  /* -------------------------------------------------------- click and drag */

  const pointer = useRef<{
    id: number;
    startX: number;
    startY: number;
    from: { x: number; y: number };
    onImage: boolean;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || phase === "leaving") return;
    const target = event.target as HTMLElement;
    // The bars are controls, not backdrop: a click between two buttons must
    // not close the viewer.
    if (target.closest("button, .shell-image-viewer-bar, .shell-image-viewer-zoom")) return;
    pointer.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: { x: current.x, y: current.y },
      onImage: target === imageRef.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pointer.current;
    if (!press || press.id !== event.pointerId) return;
    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    if (!press.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      press.moved = true;
      if (zoomed) setDragging(true);
    }
    if (view === "fit") return;
    setAnimate(false);
    setView(settle(view.scale, press.from.x + dx, press.from.y + dy));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pointer.current;
    if (!press || press.id !== event.pointerId) return;
    pointer.current = null;
    setDragging(false);
    if (press.moved) return;
    if (!press.onImage) {
      close();
      return;
    }
    if (zoomed) {
      setAnimate(true);
      setView("fit");
    } else {
      zoomTo(detailScale, event, true);
    }
  };

  const onPointerCancel = () => {
    pointer.current = null;
    setDragging(false);
  };

  /* --------------------------------------------------------------- render */

  const transform =
    ghost ?? `translate(${current.x}px, ${current.y}px) scale(${current.scale})`;
  const imageStyle: CSSProperties = natural
    ? {
        width: natural.width,
        height: natural.height,
        marginLeft: -natural.width / 2,
        marginTop: -natural.height / 2,
        transform,
      }
    : { transform: "translate(-50%, -50%)", maxWidth: "100%", maxHeight: "100%" };
  const percent = `${Math.round(current.scale * 100)}%`;
  const canZoomIn = current.scale < Math.max(fit, MAX_SCALE) - 0.001;
  const canZoomOut = zoomed;

  const viewer = (
    <div
      ref={rootRef}
      className="shell-image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={t("shell.image.viewer.label")}
      tabIndex={-1}
      data-phase={phase}
      data-zoomed={zoomed ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-animate={animate ? "true" : "false"}
      data-flying={ghost ? "true" : "false"}
      data-loaded={loaded === src || (loaded === null && phase === "entering") ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="shell-image-viewer-stage" ref={stageRef}>
        {src ? (
          <img
            ref={imageRef}
            className="shell-image-viewer-picture"
            src={src}
            alt={title}
            draggable={false}
            style={imageStyle}
            onLoad={(event) => {
              const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
              if (width && height && (natural?.width !== width || natural?.height !== height)) {
                setNatural({ width, height });
              }
              setLoaded(src);
            }}
          />
        ) : null}
      </div>

      <header className="shell-image-viewer-bar">
        <div className="shell-image-viewer-titles">
          <strong>{title}</strong>
          <span>{meta}</span>
        </div>
        <div className="shell-image-viewer-actions">
          {onDownload ? (
            <button
              type="button"
              className="shell-image-viewer-icon"
              aria-label={t("shell.image.viewer.download")}
              title={t("shell.image.viewer.download")}
              onClick={onDownload}
            >
              <Download size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="shell-image-viewer-icon"
            aria-label={t("shell.image.viewer.close")}
            title={t("shell.image.viewer.close")}
            onClick={close}
          >
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      {onPrevious ? (
        <button
          type="button"
          className="shell-image-viewer-step"
          data-side="previous"
          aria-label={t("shell.image.viewer.previous")}
          title={t("shell.image.viewer.previous")}
          onClick={onPrevious}
        >
          <ChevronLeft size={22} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
      {onNext ? (
        <button
          type="button"
          className="shell-image-viewer-step"
          data-side="next"
          aria-label={t("shell.image.viewer.next")}
          title={t("shell.image.viewer.next")}
          onClick={onNext}
        >
          <ChevronRight size={22} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}

      <p className="shell-image-viewer-hint" data-shown={hint ? "true" : "false"} aria-hidden={!hint}>
        {t("shell.image.viewer.escHint")}
      </p>

      <div className="shell-image-viewer-zoom" role="group" aria-label={t("shell.image.viewer.zoom")}>
        <button
          type="button"
          className="shell-image-viewer-icon"
          aria-label={t("shell.image.viewer.zoomOut")}
          title={t("shell.image.viewer.zoomOut")}
          disabled={!canZoomOut}
          onClick={() => zoomTo(current.scale / STEP, null, true)}
        >
          <ZoomOut size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shell-image-viewer-percent"
          aria-label={t("shell.image.viewer.fit")}
          title={t("shell.image.viewer.fit")}
          onClick={() => {
            setAnimate(true);
            setView("fit");
          }}
        >
          {percent}
        </button>
        <button
          type="button"
          className="shell-image-viewer-icon"
          aria-label={t("shell.image.viewer.zoomIn")}
          title={t("shell.image.viewer.zoomIn")}
          disabled={!canZoomIn}
          onClick={() => zoomTo(current.scale * STEP, null, true)}
        >
          <ZoomIn size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <span className="shell-image-viewer-divider" aria-hidden="true" />
        <button
          type="button"
          className="shell-image-viewer-text"
          aria-label={t("shell.image.viewer.actualSize")}
          title={t("shell.image.viewer.actualSize")}
          aria-pressed={Math.abs(current.scale - 1) < 0.001}
          onClick={() => zoomTo(1, null, true)}
        >
          1:1
        </button>
      </div>
    </div>
  );

  /*
   * Portalled to `#shell`, the same host `Menu` uses: the viewer is `fixed`, so
   * the host decides which tokens it reads, not where it lands.
   */
  const host =
    (typeof document === "undefined" ? null : document.getElementById("shell")) ??
    (typeof document === "undefined" ? null : document.body);
  return host ? createPortal(viewer, host) : null;
}

/** Keeps Tab inside the viewer, wrapping at both ends. */
function trapFocus(event: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const focusable = [...root.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
