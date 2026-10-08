/**
 * The agent's attention border.
 *
 * Ported from `presentation/packages/presentation-engine/src/render/overlay/
 * decoration/attention-overlay.ts`, which the prototype had already extracted
 * once (as `companion-attention.js`). The recipe — the four-stop gradient, the
 * stroke stack, the two feathered mask spots travelling the perimeter — is
 * carried over unchanged so the two products' agents look like the same agent.
 *
 * What is dropped is everything tied to the presentation engine: the slide
 * viewport and its scaling, the `SvgDrawingLayer`, `Disposable`. This version
 * takes a box in the host's own pixels.
 *
 * Deliberately not React. It repaints on every animation frame, and a frame
 * loop that goes through `setState` would re-render the shell 60 times a
 * second to move two circles.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const RADIUS_PX = 18;
const PERIOD_MS = 3600;
/** Spring settling time for a target change. */
const RESPONSE_SECONDS = 0.36;
const FADE_SECONDS = 0.45;

let nextOverlayId = 0;

export interface AttentionBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * Corner radius, defaulting to `RADIUS_PX`.
   *
   * The prototype's `focusWhole({ radiusPx })` read this off the element being
   * framed, because a border drawn rounder than the thing under it shows the
   * mismatch at all four corners. The overlay paints SVG and cannot inherit a
   * CSS radius, so whoever knows the shape has to say it.
   */
  radius?: number;
}

type Box = [number, number, number, number];

const COLORS: Array<[string, string]> = [
  ["0%", "#438bfa"],
  ["32%", "#9464ec"],
  ["64%", "#d96eb9"],
  ["100%", "#18b8c7"],
];

const FADE: Array<[string, number]> = [
  ["0%", 1],
  ["18%", 0.94],
  ["40%", 0.64],
  ["65%", 0.24],
  ["85%", 0.045],
  ["100%", 0],
];

/** Soft wash plus three unmasked strokes. */
const BASE_STROKES: Array<[number, number]> = [
  [8, 0.045],
  [4.5, 0.065],
  [1.6, 0.58],
];

/** Masked shimmer stack — concentric strokes rather than a blur filter. */
const GLOW_STROKES: Array<[number, number]> = [
  [14, 0.025],
  [11, 0.05],
  [8, 0.09],
  [5.5, 0.16],
  [3.8, 0.32],
  [2.5, 0.95],
];

function sameBox(a: Box, b: Box): boolean {
  return a.every((value, index) => value === b[index]);
}

/** A point travelling continuously around a rounded rectangle, in CSS pixels. */
function perimeterPoint(box: Box, phase: number, radiusPx: number): [number, number] {
  const [x, y, width, height] = box;
  const radius = Math.min(radiusPx, width / 2, height / 2);
  const horizontal = width - 2 * radius;
  const vertical = height - 2 * radius;
  const arc = (Math.PI * radius) / 2;
  let distance = phase * (2 * horizontal + 2 * vertical + 4 * arc);

  const line = (
    length: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): [number, number] | undefined => {
    if (distance <= length) {
      const ratio = length ? distance / length : 0;
      return [x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio];
    }
    distance -= length;
    return undefined;
  };

  const turn = (cx: number, cy: number, start: number): [number, number] | undefined => {
    if (distance <= arc) {
      const angle = start + (radius ? distance / radius : 0);
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    }
    distance -= arc;
    return undefined;
  };

  return (
    line(horizontal, x + radius, y, x + width - radius, y) ??
    turn(x + width - radius, y + radius, -Math.PI / 2) ??
    line(vertical, x + width, y + radius, x + width, y + height - radius) ??
    turn(x + width - radius, y + height - radius, 0) ??
    line(horizontal, x + width - radius, y + height, x + radius, y + height) ??
    turn(x + radius, y + height - radius, Math.PI) ??
    line(vertical, x, y + height - radius, x, y + radius) ??
    turn(x + radius, y + radius, Math.PI) ?? [x + radius, y]
  );
}

export class AttentionOverlay {
  readonly #svg: SVGSVGElement;
  readonly #group: SVGGElement;
  readonly #mask: SVGMaskElement;
  readonly #rects: SVGRectElement[] = [];
  readonly #spots: SVGCircleElement[] = [];
  readonly #media: MediaQueryList | null;
  #reduced = false;
  #radius = RADIUS_PX;
  #current?: Box;
  #target?: Box;
  #velocity: Box = [0, 0, 0, 0];
  #clockMs = 0;
  #lastTime?: number;
  #frame?: number;
  #fading = false;
  #opacity = 1;
  #disposed = false;

  constructor(host: HTMLElement) {
    const doc = host.ownerDocument;
    const id = `shell-attention-${++nextOverlayId}`;
    this.#media = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

    const create = <K extends keyof SVGElementTagNameMap>(
      tag: K,
      attrs: Record<string, string | number>,
      parent: Element,
    ): SVGElementTagNameMap[K] => {
      const element = doc.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
      parent.appendChild(element);
      return element;
    };

    this.#svg = doc.createElementNS(SVG_NS, "svg");
    this.#svg.setAttribute("data-shell-attention", "true");
    this.#svg.setAttribute("aria-hidden", "true");
    Object.assign(this.#svg.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      overflow: "visible",
      display: "none",
      zIndex: "3",
    });
    host.appendChild(this.#svg);

    const defs = create("defs", {}, this.#svg);
    const colors = create(
      "linearGradient",
      { id: `${id}-color`, x1: "0%", y1: "0%", x2: "100%", y2: "100%" },
      defs,
    );
    for (const [offset, color] of COLORS) create("stop", { offset, "stop-color": color }, colors);

    const fade = create("radialGradient", { id: `${id}-fade` }, defs);
    for (const [offset, opacity] of FADE) {
      create("stop", { offset, "stop-color": "white", "stop-opacity": opacity }, fade);
    }

    this.#mask = create(
      "mask",
      { id: `${id}-mask`, maskUnits: "userSpaceOnUse", x: -30, y: -30, "mask-type": "alpha" },
      defs,
    );
    for (const opacity of [1, 0.55]) {
      this.#spots.push(
        create("circle", { cx: 0, cy: 0, r: 100, opacity, fill: `url(#${id}-fade)` }, this.#mask),
      );
    }

    this.#group = create("g", { "pointer-events": "none" }, this.#svg);

    const rect = (attrs: Record<string, string | number>, parent: Element = this.#group) => {
      const element = create("rect", { fill: "none", "stroke-linejoin": "round", ...attrs }, parent);
      this.#rects.push(element);
      return element;
    };

    rect({ fill: `url(#${id}-color)`, "fill-opacity": 0.015 });
    for (const [width, opacity] of BASE_STROKES) {
      rect({ stroke: `url(#${id}-color)`, "stroke-width": width, "stroke-opacity": opacity });
    }
    const glow = create("g", { mask: `url(#${id}-mask)`, opacity: 0.9 }, this.#group);
    for (const [width, opacity] of GLOW_STROKES) {
      rect({ stroke: `url(#${id}-color)`, "stroke-width": width, "stroke-opacity": opacity }, glow);
    }
  }

  /** Point the border at a box in the host's coordinates. */
  focus(box: AttentionBox): void {
    if (this.#disposed) return;
    const target: Box = [box.left, box.top, Math.max(1, box.width), Math.max(1, box.height)];
    if (!target.every(Number.isFinite)) {
      this.hide(true);
      return;
    }
    const radius = Math.max(0, box.radius ?? RADIUS_PX);
    const reshaped = radius !== this.#radius;
    this.#radius = radius;
    this.#mask.setAttribute("width", String(target[2] + 320));
    this.#mask.setAttribute("height", String(target[3] + 320));

    const unchanged = this.#target && sameBox(target, this.#target) && !this.#fading && !reshaped;
    this.#target = target;
    // A first appearance, or a reduced-motion user, lands on the box rather
    // than springing to it from wherever the last one was.
    if (!this.#current || this.#still()) {
      this.#current = [...target];
      this.#velocity = [0, 0, 0, 0];
      this.#paintGeometry();
    } else if (reshaped) {
      // The spring only carries position and size; a corner that changed has
      // to be repainted or the strokes keep the previous shape until it
      // settles.
      this.#paintGeometry();
    }
    if (unchanged) return;
    this.#fading = false;
    this.#opacity = 1;
    this.#group.setAttribute("opacity", "1");
    this.#svg.style.display = "block";
    this.#paintLight();
    this.#schedule();
  }

  /**
   * The user's own reduced-motion preference, on top of the OS one.
   *
   * `prefers-reduced-motion` is the only signal the overlay could see by
   * itself, but the shell also ships its own switch (`ShellSettings.reduceMotion`,
   * offered in the sidebar) — a user who cannot change an OS setting, or who
   * wants this app still while the rest of the desktop moves, has to be obeyed
   * too. Either one stops the travelling light; neither hides the border,
   * because the border is information, not decoration.
   */
  setReducedMotion(reduced: boolean): void {
    if (this.#disposed || this.#reduced === reduced) return;
    this.#reduced = reduced;
    if (!this.#current) return;
    if (!reduced) {
      this.#schedule();
      return;
    }
    // Stop where the spring was heading rather than wherever it happens to be
    // mid-flight: a frozen half-grown box is not a shape anyone asked for.
    this.#cancelFrame();
    if (this.#target) {
      this.#current = [...this.#target];
      this.#velocity = [0, 0, 0, 0];
      this.#paintGeometry();
    }
    this.#paintLight();
  }

  hide(immediate = false): void {
    this.#target = undefined;
    if (immediate || this.#still() || this.#svg.ownerDocument.hidden) {
      this.#cancelFrame();
      this.#svg.style.display = "none";
      this.#current = undefined;
      this.#velocity = [0, 0, 0, 0];
      this.#fading = false;
      this.#opacity = 1;
    } else if (this.#current && !this.#fading) {
      this.#fading = true;
      this.#schedule();
    }
  }

  dispose(): void {
    this.hide(true);
    this.#disposed = true;
    this.#svg.remove();
  }

  /** Motion is off — because the OS says so, or because the user does. */
  #still(): boolean {
    return this.#reduced || this.#media?.matches === true;
  }

  #paintGeometry(): void {
    if (!this.#current) return;
    const [x, y, width, height] = this.#current;
    const radius = Math.min(this.#radius, width / 2, height / 2);
    for (const rect of this.#rects) {
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", String(height));
      rect.setAttribute("rx", String(radius));
    }
    // The travelling light reaches further around a bigger box, so its spread
    // scales with the perimeter instead of being a fixed radius.
    const reach = Math.min(155, Math.max(75, (width + height) * 0.35));
    this.#spots[0].setAttribute("r", String(reach));
    this.#spots[1].setAttribute("r", String(reach * 0.72));
  }

  #paintLight(): void {
    if (!this.#current) return;
    const phase = this.#still() ? 0.18 : (this.#clockMs % PERIOD_MS) / PERIOD_MS;
    this.#spots.forEach((spot, index) => {
      const [x, y] = perimeterPoint(this.#current!, (phase + index * 0.5) % 1, this.#radius);
      spot.setAttribute("transform", `translate(${x} ${y})`);
    });
  }

  #schedule(): void {
    if (
      this.#frame !== undefined ||
      this.#disposed ||
      !this.#current ||
      this.#still() ||
      this.#svg.ownerDocument.hidden ||
      typeof requestAnimationFrame !== "function"
    ) {
      return;
    }
    this.#lastTime ??= performance.now();
    this.#frame = requestAnimationFrame(this.#tick);
  }

  readonly #tick = (now: number): void => {
    this.#frame = undefined;
    const dt = Math.max(0, (now - (this.#lastTime ?? now)) / 1000);
    this.#lastTime = now;
    this.#clockMs += dt * 1000;

    if (
      this.#current &&
      this.#target &&
      (!sameBox(this.#current, this.#target) || this.#velocity.some((value) => value !== 0))
    ) {
      const before = this.#current;
      const omega = 7 / RESPONSE_SECONDS;
      const decay = Math.exp(-omega * dt);
      this.#current = before.map((position, index) => {
        const target = this.#target![index];
        const delta = position - target;
        const a = this.#velocity[index] + omega * delta;
        const next = target + (delta + a * dt) * decay;
        const velocity = (this.#velocity[index] - omega * a * dt) * decay;
        const settled = Math.abs(next - target) < 0.01 && Math.abs(velocity) < 0.05;
        this.#velocity[index] = settled ? 0 : velocity;
        // A fast reversal can briefly overshoot into negative width.
        return index >= 2 ? Math.max(1, settled ? target : next) : settled ? target : next;
      }) as Box;
      if (!sameBox(before, this.#current)) this.#paintGeometry();
    }

    if (this.#fading) {
      this.#opacity = Math.max(0, this.#opacity - dt / FADE_SECONDS);
      this.#group.setAttribute("opacity", String(this.#opacity));
      if (this.#opacity === 0) {
        this.hide(true);
        return;
      }
    }

    this.#paintLight();
    this.#schedule();
  };

  #cancelFrame(): void {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    this.#lastTime = undefined;
  }
}
