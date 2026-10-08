/**
 * The Dex expression renderer — a port of the prototype's frozen 1.0
 * `companion-logo.js`.
 *
 * BRAND-DEX-STANDARD §05/§09: the sixteen states, their eye poses, corner
 * symbols, blink periods and pointer tracking are reused from 1.0 as they are.
 * Nothing in this file is a design decision of the shell's — the numbers are
 * the asset. Two drawings run on it:
 *
 *  - the round flat-ink bubble (`flatInk`), whose SVG is handed in and whose
 *    `#document-body` / `#agent-expression` / `#status-symbol` nodes are
 *    adopted rather than redrawn, so the source file is never edited;
 *  - the rounded-square brand face used by the Home tab and the author label,
 *    which draws the eyes over the official base image.
 *
 * It is imperative on purpose. Every mounted face shares one clock and one
 * animation frame, exactly as the source does; per-instance React state would
 * re-render sixty times a second to move two paths.
 */

import baseImage from "../assets/dex/original-without-dot.png";

export type DexState =
  | "ready"
  | "hover"
  | "selected"
  | "think"
  | "read"
  | "write"
  | "fill"
  | "review"
  | "confirm"
  | "done"
  | "celebrate"
  | "paused"
  | "queued"
  | "retry"
  | "offline"
  | "sleep";

type BaseState = "ready" | "listen" | "think" | "work" | "done" | "confirm" | "paused" | "retry";
type Mood = "quiet" | "friendly" | "playful";
type SymbolName =
  | "dot"
  | "question"
  | "heart"
  | "exclamation"
  | "cursor"
  | "pencil"
  | "plus"
  | "search"
  | "clock"
  | "sleep"
  | "broken"
  | "sparkle";

interface Eye {
  x: number;
  y: number;
  dx: number;
  dy: number;
  curve: number;
  weight: number;
}

let time = 0;
let forcedBlink = -99;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const eye = (x: number, y: number, dx: number, dy: number, curve: number, weight: number): Eye => ({
  x,
  y,
  dx,
  dy,
  curve,
  weight,
});
const neutral = (): Eye[] => [eye(108, 132, 0, 12, 0, 10), eye(146, 132, 0, 12, 0, 10)];
const eyePath = (e: Eye) =>
  `M ${e.x - e.dx / 2} ${e.y - e.dy / 2} Q ${e.x} ${e.y + e.curve} ${e.x + e.dx / 2} ${e.y + e.dy / 2}`;

const symbols: Record<SymbolName, { d: string; width?: number }[]> = {
  dot: [{ d: "M -2.5 -9 H 2.5 Q 8.5 -9 8.5 -3 V 3 Q 8.5 9 2.5 9 H -2.5 Q -8.5 9 -8.5 3 V -3 Q -8.5 -9 -2.5 -9 Z" }],
  question: [
    { d: "M -6 -8 C -6 -15 7 -15 7 -8 C 7 -3 0 -4 0 2", width: 4.5 },
    { d: "M -2.5 10 A 2.5 2.5 0 1 0 2.5 10 A 2.5 2.5 0 1 0 -2.5 10 Z" },
  ],
  heart: [{ d: "M 0 9 C -2 7 -11 1 -11 -5 C -11 -12 -3 -14 0 -7 C 3 -14 11 -12 11 -5 C 11 1 2 7 0 9 Z" }],
  exclamation: [{ d: "M 0 -12 L 0 1", width: 5 }, { d: "M -2.7 10 A 2.7 2.7 0 1 0 2.7 10 A 2.7 2.7 0 1 0 -2.7 10 Z" }],
  cursor: [{ d: "M -6 -12 L 9 1 L 2 2 L -1 10 Z" }],
  pencil: [{ d: "M -9 5 L 4 -9 L 10 -3 L -3 11 L -11 13 Z" }, { d: "M 1 -6 L 7 0", width: 2 }],
  plus: [{ d: "M 0 -9 V 9 M -9 0 H 9", width: 4.5 }],
  search: [{ d: "M 4 -4 A 7 7 0 1 0 -10 -4 A 7 7 0 1 0 4 -4 M 2 2 L 10 10", width: 4 }],
  clock: [{ d: "M 10 0 A 10 10 0 1 0 -10 0 A 10 10 0 1 0 10 0 M 0 -6 V 0 L 4 3", width: 3 }],
  sleep: [{ d: "M -9 -8 H 1 L -9 2 H 1 M 5 1 H 12 L 5 9 H 12", width: 2.5 }],
  broken: [
    {
      d: "M -9 -6 L -5 -10 Q -1 -14 3 -10 M 9 6 L 5 10 Q 1 14 -3 10 M -10 -1 L 10 1 M -2 -7 L 2 7",
      width: 3.3,
    },
  ],
  sparkle: [{ d: "M 0 -13 Q 2 -2 12 0 Q 2 2 0 13 Q -2 2 -12 0 Q -2 -2 0 -13 Z" }],
};

interface StateDef {
  id: DexState;
  /** English name, used for the bubble's title and spoken description. */
  name: string;
  symbol: SymbolName;
  base: BaseState;
}

/** The sixteen states, in the source's order. */
export const DEX_STATES: readonly StateDef[] = [
  { id: "ready", name: "Ready", symbol: "dot", base: "ready" },
  { id: "hover", name: "Noticed", symbol: "heart", base: "listen" },
  { id: "selected", name: "Sees your selection", symbol: "cursor", base: "listen" },
  { id: "think", name: "Thinking", symbol: "question", base: "think" },
  { id: "read", name: "Reading", symbol: "search", base: "work" },
  { id: "write", name: "Writing", symbol: "pencil", base: "work" },
  { id: "fill", name: "Filling in", symbol: "plus", base: "work" },
  { id: "review", name: "Ready for review", symbol: "search", base: "confirm" },
  { id: "confirm", name: "Needs your decision", symbol: "question", base: "confirm" },
  { id: "done", name: "Done", symbol: "heart", base: "done" },
  { id: "celebrate", name: "Celebrating", symbol: "sparkle", base: "done" },
  { id: "paused", name: "Paused", symbol: "dot", base: "paused" },
  { id: "queued", name: "Queued", symbol: "clock", base: "ready" },
  { id: "retry", name: "Needs another try", symbol: "exclamation", base: "retry" },
  { id: "offline", name: "Offline", symbol: "broken", base: "retry" },
  { id: "sleep", name: "Resting", symbol: "sleep", base: "paused" },
];

const byId = Object.fromEntries(DEX_STATES.map((s) => [s.id, s])) as Record<DexState, StateDef>;

/** The corner-motion key is the *state* id, falling back to its base's motion. */
const cornerSymbolOf = (id: DexState): SymbolName => byId[id].symbol;

function blinkAt(t: number, at: number, duration = 0.22) {
  const p = (t - at) / duration;
  return p < 0 || p > 1 ? 1 : Math.max(0.04, 1 - Math.sin(p * Math.PI) ** 1.35);
}

function basePoseFor(id: BaseState, t: number, moving = true): Eye[] {
  const e = neutral();
  const phase = t % 4.6;
  let blink = 1;
  if (id === "listen") {
    e.forEach((a) => {
      a.dy = 19;
      a.weight = 10;
      a.y = 130;
      a.x += moving ? -2.2 + Math.sin(t * 0.9) * 2.2 : -2;
    });
  }
  if (id === "think") {
    const ramp = clamp01(Math.min(phase / 0.65, (4.6 - phase) / 0.8));
    const gaze = moving ? ramp * ramp * (3 - 2 * ramp) : 1;
    e[0].dy = 9;
    e[1].dy = 16;
    e[0].y = 132 - 3 * gaze;
    e[1].y = 132 - 8 * gaze;
    e.forEach((a) => (a.x += 4 * gaze));
  }
  if (id === "work") {
    e.forEach((a) => {
      a.dy = 6;
      a.y = 133;
      a.x += moving ? Math.sin(t * 2) * 3.4 : 2;
    });
  }
  if (id === "done") {
    e.forEach((a) => {
      a.dx = 16;
      a.dy = 0;
      a.curve = -12;
      a.weight = 6;
      a.y = 136;
    });
    if (moving) {
      const wink = blinkAt(t % 5.2, 3.2, 0.34);
      e[1].curve *= wink;
      e[1].dx = 12 + 4 * wink;
    }
  }
  if (id === "confirm") {
    e[0].dy = 17;
    e[0].y = 129;
    e[1].dy = 5;
    e[1].y = 134;
    if (moving) e.forEach((a) => (a.x += Math.sin(t * 0.8) * 1.3));
  }
  if (id === "paused") {
    e.forEach((a) => {
      a.dx = 13;
      a.dy = 0;
      a.curve = 1;
      a.weight = 6;
      a.y = 135;
    });
  }
  if (id === "retry") {
    e.forEach((a) => {
      a.dx = 10;
      a.curve = 0;
      a.weight = 7;
      a.y = 132;
    });
    e[0].dy = -9;
    e[1].dy = 9;
  }
  if (moving && ["ready", "listen", "think", "work", "confirm"].includes(id)) {
    const period = id === "work" ? 3.2 : id === "confirm" ? 6.5 : 4.6;
    blink = blinkAt(t % period, period - 0.55, 0.22);
    if (id === "ready") blink = Math.min(blink, blinkAt(t % 9.2, 8.89, 0.16));
  }
  if (time - forcedBlink < 0.4 && time - forcedBlink >= 0)
    blink = Math.min(blink, blinkAt(time - forcedBlink, 0.025, 0.27));
  if (blink < 1)
    e.forEach((a) => {
      a.dy *= blink;
      a.curve *= blink;
      a.dx = a.dx * blink + 10 * (1 - blink);
      a.weight = Math.max(4, a.weight * blink);
    });
  return e;
}

function cornerPose(id: DexState, t: number, moving: boolean) {
  let y = 81;
  let scale = 1;
  let rotation = 0;
  let opacity = 1;
  if (id === "paused") {
    scale = 0.76;
    opacity = 0.64;
  }
  if (moving) {
    if (id === "ready") scale = 1 + Math.sin((t * Math.PI) / 2.3) * 0.035;
    if (id === "think") {
      const phase = t % 4.6;
      const ramp = clamp01(Math.min(phase / 0.65, (4.6 - phase) / 0.8));
      const gaze = ramp * ramp * (3 - 2 * ramp);
      y -= 3 * gaze;
      rotation = -6 * gaze;
    }
    if (id === "write") {
      rotation = Math.sin(t * 6) * 8;
      y += Math.sin(t * 6) * 0.8;
    }
    if (id === "read") {
      rotation = Math.sin(t * 1.8) * 5;
      y += Math.sin(t * 2.2) * 0.7;
    }
    if (id === "fill") scale = 1 + Math.sin(t * 3.2) * 0.1;
    if (id === "hover" && t < 1) scale = 1 + Math.sin(t * Math.PI) * 0.12;
    if (id === "selected" && t < 0.55) y -= Math.sin((t / 0.55) * Math.PI) * 2;
    if (id === "review") {
      rotation = -4 + Math.sin(t * 0.8) * 3;
    }
    if (id === "done") {
      const phase = t % 5.2;
      const beat = (at: number) => Math.exp(-Math.pow((phase - at) / 0.13, 2));
      scale = 1 + beat(0.3) * 0.15 + beat(0.65) * 0.1;
    }
    if (id === "confirm") {
      rotation = -6 + Math.sin(t * 0.9) * 5;
      y -= 1;
    }
    if (t < 0.34 && ["question", "heart", "exclamation"].includes(cornerSymbolOf(id)))
      scale *= 0.85 + 0.15 * Math.sin((Math.min(1, t / 0.34) * Math.PI) / 2);
  } else if (id === "think") {
    y -= 3;
    rotation = -6;
  } else if (id === "confirm") {
    rotation = -6;
    y -= 1;
  }
  return { symbol: cornerSymbolOf(id), x: 175.5, y, scale, rotation, opacity };
}

interface Instance {
  host: HTMLElement;
  svg: SVGSVGElement;
  body: SVGGElement;
  paths: SVGPathElement[];
  corner: SVGGElement;
  symbol: SymbolName | null;
  flatInk: boolean;
  state: DexState;
  mood: Mood | null;
  look: string | null;
  animate: boolean;
  track: boolean;
  started: number;
}

const instances = new Set<Instance>();
let globalMood: Mood = "friendly";
let globalLook = "soft";
let globallyPaused = false;
let previous = 0;
let frame: number | undefined;
let pointer = { x: 0, y: 0 };
let listening = false;
const moodFactor: Record<Mood, number> = { quiet: 0.35, friendly: 1, playful: 1.7 };

function drawCorner(item: Instance, id: DexState, t: number, moving: boolean) {
  const pose = cornerPose(id, t, moving);
  if (item.symbol !== pose.symbol) {
    const ink = item.flatInk ? "#ffffff" : "#fafafa";
    item.corner.innerHTML = symbols[pose.symbol]
      .map(
        (s) =>
          `<path d="${s.d}" ${
            s.width
              ? `fill="none" stroke="${ink}" stroke-width="${s.width}" stroke-linecap="round"`
              : `fill="${ink}"`
          }/>`,
      )
      .join("");
    item.symbol = pose.symbol;
    item.corner.dataset.symbol = pose.symbol;
  }
  item.corner.setAttribute(
    "transform",
    `translate(${pose.x} ${pose.y}) rotate(${pose.rotation}) scale(${pose.scale})`,
  );
  item.corner.setAttribute("opacity", String(pose.opacity));
}

function render(item: Instance) {
  const def = byId[item.state] || byId.ready;
  const mood = item.mood || globalMood;
  const amount = moodFactor[mood];
  const moving = item.animate && !globallyPaused;
  const t = time - item.started;
  item.host.dataset.look = item.look || globalLook;
  item.host.dataset.mood = mood;
  item.host.dataset.state = item.state;
  item.svg.setAttribute("aria-label", `OfficeDex · ${def.id}`);
  const motionTime = mood === "quiet" ? t * 0.62 : t;
  const pose = basePoseFor(def.base, moving ? motionTime : 0, moving);
  if (item.flatInk)
    pose.forEach((e) => {
      e.dy *= 1.16;
      e.weight *= 1.1;
    });
  if (def.id === "hover" || def.id === "selected")
    pose.forEach((e) => {
      e.y -= 2;
      e.dy += def.id === "hover" ? 3 : 1;
    });
  if (def.id === "read") pose.forEach((e) => (e.y += moving ? Math.sin(t * 2.2) * 2 : 0));
  if (def.id === "queued") pose.forEach((e) => (e.dy = 8));
  if (def.id === "offline")
    pose.forEach((e) => {
      e.dx = 12;
      e.dy = 3;
      e.weight = 6;
    });
  if (def.id === "celebrate")
    pose.forEach((e) => {
      e.curve = -14;
      e.dx = 18;
    });
  if (mood === "playful")
    pose.forEach((e) => {
      e.weight *= 1.1;
      e.dy *= 1.16;
      e.curve *= 1.2;
    });
  if (item.track && moving && (def.id === "ready" || def.id === "hover" || def.id === "selected")) {
    const r = item.host.getBoundingClientRect();
    pose.forEach((e) => {
      e.x += Math.max(-3, Math.min(3, (pointer.x - r.x - r.width / 2) / 180)) * amount;
      e.y += Math.max(-2, Math.min(2, (pointer.y - r.y - r.height / 2) / 180)) * amount;
    });
  }
  pose.forEach((p, i) => {
    item.paths[i].setAttribute("d", eyePath(p));
    item.paths[i].setAttribute("stroke-width", String(p.weight));
  });
  drawCorner(item, def.id, moving ? motionTime : 0, moving);
  let sx = 1;
  let sy = 1;
  let dy = 0;
  let rot = 0;
  if (moving && mood !== "quiet") {
    if ((def.id === "hover" || def.id === "selected") && t < 0.7) {
      const wave = Math.sin((t / 0.7) * Math.PI);
      sy = 1 + wave * 0.022 * amount;
      sx = 1 - wave * 0.014 * amount;
      dy = -wave * 2 * amount;
    }
    if (def.id === "celebrate" && t < 1.8) {
      dy = -Math.abs(Math.sin(t * 5)) * 5 * amount;
      rot = Math.sin(t * 7) * 2 * amount;
    }
    if (mood === "playful" && (def.id === "think" || def.id === "confirm")) rot = Math.sin(t * 1.2) * 1.3;
  }
  item.body.setAttribute(
    "transform",
    `translate(128 ${128 + dy}) rotate(${rot}) scale(${sx} ${sy}) translate(-128 -128)`,
  );
  item.host.style.filter = !item.flatInk && def.id === "offline" ? "saturate(0) opacity(.8)" : "";
}

function loop(now: number) {
  frame = undefined;
  const dt = Math.min(0.04, (now - previous) / 1000);
  previous = now;
  if (!globallyPaused && !document.hidden) {
    time += dt;
    for (const item of instances) if (item.host.isConnected && !item.host.closest("[hidden]")) render(item);
  }
  if (instances.size > 0) frame = requestAnimationFrame(loop);
}

const trackPointer = (event: PointerEvent) => {
  pointer = { x: event.clientX, y: event.clientY };
};

function start() {
  if (typeof window === "undefined") return;
  if (!listening) {
    listening = true;
    pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    window.addEventListener("pointermove", trackPointer, { passive: true });
  }
  if (frame === undefined && typeof requestAnimationFrame === "function") {
    previous = performance.now();
    frame = requestAnimationFrame(loop);
  }
}

export interface DexFaceOptions {
  /** The flat-ink source SVG. Absent draws the rounded-square brand face. */
  svg?: string;
  state?: DexState;
  mood?: Mood;
  look?: string;
  animate?: boolean;
  /** Eyes follow the pointer in `ready`, `hover` and `selected`. */
  track?: boolean;
}

export interface DexFaceHandle {
  setState(id: DexState): void;
  setAnimate(value: boolean): void;
  blink(): void;
  readonly state: DexState;
  destroy(): void;
}

export function mountDexFace(host: HTMLElement, options: DexFaceOptions = {}): DexFaceHandle {
  if (options.svg) {
    host.innerHTML = options.svg;
    const svg = host.querySelector("svg")!;
    const body = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.classList.add("dx-od-mark");
    svg.setAttribute("aria-hidden", "true");
    body.classList.add("dx-od-body");
    ["document-body", "agent-expression", "status-symbol"].forEach((id) => {
      const node = svg.querySelector("#" + id);
      if (node) body.append(node);
    });
    body.querySelector("#agent-expression")!.classList.add("dx-od-eyes");
    body.querySelector("#status-symbol")!.classList.add("dx-corner-symbol");
    // Ids are per-document; more than one bubble may be mounted at a time.
    body.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    svg.append(body);
  } else {
    host.innerHTML = `<svg viewBox="42 42 172 172" class="dx-od-mark" role="img" aria-label="OfficeDex companion"><g class="dx-od-body"><image href="${baseImage}" width="256" height="256"/><g class="dx-od-eyes" fill="none" stroke="#262626" stroke-linecap="round"><path/><path/></g><g class="dx-corner-symbol"/></g></svg>`;
  }
  const item: Instance = {
    host,
    svg: host.querySelector("svg")!,
    body: host.querySelector(".dx-od-body")!,
    paths: [...host.querySelectorAll<SVGPathElement>(".dx-od-eyes path")],
    corner: host.querySelector(".dx-corner-symbol")!,
    symbol: null,
    flatInk: !!options.svg,
    state: options.state || "ready",
    mood: options.mood || null,
    look: options.look || null,
    animate: options.animate !== false,
    track: !!options.track,
    started: time,
  };
  instances.add(item);
  render(item);
  start();
  return {
    setState(id) {
      if (byId[id] && item.state !== id) {
        item.state = id;
        item.started = time;
        render(item);
      }
    },
    setAnimate(value) {
      if (item.animate === value) return;
      item.animate = value;
      render(item);
    },
    blink() {
      forcedBlink = time;
    },
    get state() {
      return item.state;
    },
    destroy() {
      instances.delete(item);
    },
  };
}

/** Pointer position reported by an isolated editor frame, in viewport pixels. */
export function setDexPointer(x: number, y: number) {
  if (Number.isFinite(x) && Number.isFinite(y)) pointer = { x, y };
}

export function dexFaceSettings({ mood, look, paused }: { mood?: Mood; look?: string; paused?: boolean } = {}) {
  if (mood) globalMood = mood;
  if (look) globalLook = look;
  if (paused !== undefined) globallyPaused = paused;
  instances.forEach(render);
  if (!globallyPaused) start();
}

export const dexStateName = (id: DexState) => byId[id]?.name ?? id;
