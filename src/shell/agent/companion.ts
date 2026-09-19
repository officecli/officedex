import type { AgentStatus } from "../../shared/uiPort";

/**
 * The OfficeDex companion — the product's agent character, as artwork.
 *
 * The shell previously drew a generic smiley (round head, two dots, a mouth).
 * That is not the character: the brand mark is a rounded square *plate* with a
 * bite taken out of its top-right corner, two upright bar eyes and no mouth,
 * with a floating rounded-square dot sitting in the bite. The dot is the
 * character's only "prop" — it becomes a question mark when the agent needs a
 * decision, a heart when it finishes, a magnifier while it reads.
 *
 * Geometry is kept in the prototype's 256×256 user space so the numbers here
 * can be checked against `assets/companion/original-without-dot.png` directly:
 * the plate's box is x 69→183, y 72→189, the bite is a circle of r 19.5 centred
 * on the dot at (175.5, 81), and the neutral eyes sit at x 108 / 146, y 132.
 * Expression is all in the eyes — a quadratic per eye, so one formula covers
 * open, squinting, closed and smiling without a second artwork set.
 */

/**
 * The drawn area, not the full 256 grid: the character fills its badge the way
 * the brand renders it (the plate spans about two thirds of the disc), so the
 * artboard is cropped to the middle 172 units the same way the prototype's
 * `viewBox` was.
 */
export const VIEW_BOX = "42 42 172 172";

/** The disc behind the plate, inscribed in the cropped artboard. */
export const DISC = { cx: 128, cy: 128, r: 86 };

/** Plate outline: a 24-radius rounded square, minus the r=19.5 corner bite. */
export const PLATE_PATH =
  "M 93 72 H 158.2 A 19.5 19.5 0 0 0 183 99 V 165 A 24 24 0 0 1 159 189 " +
  "H 93 A 24 24 0 0 1 69 165 V 96 A 24 24 0 0 1 93 72 Z";

/** Centre of the bite, and so of whatever symbol is floating in it. */
export const CORNER_ORIGIN = { x: 175.5, y: 81 };

export interface Eye {
  /** Centre of the stroke. */
  x: number;
  y: number;
  /** Horizontal span; 0 for an upright bar eye. */
  dx: number;
  /** Vertical span; 0 for a closed or smiling eye. */
  dy: number;
  /** Pulls the midpoint down (+) or up (−): the difference between a flat line and a smile. */
  curve: number;
  /** Stroke width. Round caps mean this is also the eye's minimum thickness. */
  weight: number;
}

export function eyePath(eye: Eye): string {
  const x1 = eye.x - eye.dx / 2;
  const y1 = eye.y - eye.dy / 2;
  const x2 = eye.x + eye.dx / 2;
  const y2 = eye.y + eye.dy / 2;
  return `M ${x1} ${y1} Q ${eye.x} ${eye.y + eye.curve} ${x2} ${y2}`;
}

export type CornerSymbol = "dot" | "question" | "heart" | "search" | "pencil";

interface SymbolStroke {
  d: string;
  /** Present for stroked glyphs; filled ones omit it. */
  width?: number;
}

export const CORNER_SYMBOLS: Record<CornerSymbol, SymbolStroke[]> = {
  dot: [{ d: "M -2.5 -9 H 2.5 Q 8.5 -9 8.5 -3 V 3 Q 8.5 9 2.5 9 H -2.5 Q -8.5 9 -8.5 3 V -3 Q -8.5 -9 -2.5 -9 Z" }],
  question: [
    { d: "M -6 -8 C -6 -15 7 -15 7 -8 C 7 -3 0 -4 0 2", width: 4.5 },
    { d: "M -2.5 10 A 2.5 2.5 0 1 0 2.5 10 A 2.5 2.5 0 1 0 -2.5 10 Z" },
  ],
  heart: [{ d: "M 0 9 C -2 7 -11 1 -11 -5 C -11 -12 -3 -14 0 -7 C 3 -14 11 -12 11 -5 C 11 1 2 7 0 9 Z" }],
  search: [{ d: "M 4 -4 A 7 7 0 1 0 -10 -4 A 7 7 0 1 0 4 -4 M 2 2 L 10 10", width: 4 }],
  pencil: [
    { d: "M -9 5 L 4 -9 L 10 -3 L -3 11 L -11 13 Z" },
    { d: "M 1 -6 L 7 0", width: 2 },
  ],
};

/**
 * Below this size the symbol is a smudge rather than a glyph, so every state
 * falls back to the resting dot. The mark stays recognisable at 16px that way,
 * which is what the mode switch needs.
 */
export const SYMBOL_DETAIL_MIN_SIZE = 26;

interface Pose {
  /**
   * Dictionary key, not copy.
   *
   * These seven strings are the only thing a screen reader hears while a run is
   * in flight (`AgentPresence`'s live region), so they are the last place a
   * hardcoded English label can hide. Keeping the key here means the pose table
   * stays the single list of states and the dictionary stays the single list of
   * words.
   */
  labelKey: string;
  eyes: [Eye, Eye];
  symbol: CornerSymbol;
  /** Drives the CSS: which idle loop, if any, the face runs. */
  motion: "rest" | "scan" | "beat" | "still";
}

const bar = (x: number, y = 132, dy = 12, weight = 10): Eye => ({ x, y, dx: 0, dy, curve: 0, weight });

/**
 * Seven `AgentStatus` values against the character's expressions.
 *
 * The prototype carried sixteen states; the port keeps only the ones the shell
 * can actually reach, and each one is a real pose rather than a tint of the
 * same face — `awaiting-review` is asymmetric because it is *asking*, `paused`
 * is shut because it stopped on purpose, `done` smiles.
 */
const POSES: Record<AgentStatus, Pose> = {
  idle: {
    labelKey: "shell.agentStatus.idle",
    eyes: [bar(108), bar(146)],
    symbol: "dot",
    motion: "rest",
  },
  reading: {
    labelKey: "shell.agentStatus.reading",
    eyes: [bar(108, 133, 6), bar(146, 133, 6)],
    symbol: "search",
    motion: "scan",
  },
  writing: {
    labelKey: "shell.agentStatus.writing",
    eyes: [bar(108, 133, 6), bar(146, 133, 6)],
    symbol: "pencil",
    motion: "scan",
  },
  working: {
    labelKey: "shell.agentStatus.working",
    eyes: [bar(108, 133, 6), bar(146, 133, 6)],
    symbol: "dot",
    motion: "scan",
  },
  paused: {
    labelKey: "shell.agentStatus.paused",
    eyes: [
      { x: 108, y: 135, dx: 13, dy: 0, curve: 1, weight: 6 },
      { x: 146, y: 135, dx: 13, dy: 0, curve: 1, weight: 6 },
    ],
    symbol: "dot",
    motion: "still",
  },
  "awaiting-review": {
    labelKey: "shell.agentStatus.awaitingReview",
    eyes: [bar(108, 129, 17), bar(146, 134, 5)],
    symbol: "question",
    motion: "rest",
  },
  done: {
    labelKey: "shell.agentStatus.done",
    eyes: [
      { x: 108, y: 136, dx: 16, dy: 0, curve: -12, weight: 6 },
      { x: 146, y: 136, dx: 16, dy: 0, curve: -12, weight: 6 },
    ],
    symbol: "heart",
    motion: "beat",
  },
};

export function poseFor(status: AgentStatus): Pose {
  return POSES[status];
}

/** Closed and smiling eyes have nothing left to close, so they never blink. */
export function blinks(status: AgentStatus): boolean {
  return POSES[status].eyes[0].dy > 0;
}

/**
 * Whether the eyes follow the pointer in this state.
 *
 * Only while the character is waiting on you. Mid-task the eyes are scanning
 * the work — having them break off to watch the cursor would say the opposite
 * of what the state means — and `paused` has its eyes shut.
 */
export function tracksGaze(status: AgentStatus): boolean {
  return status === "idle" || status === "awaiting-review";
}

/**
 * The two stubby limbs that appear when the presence is tucked against a
 * screen edge, taken from the prototype's `.agent-status-art::before/::after`.
 *
 * Tucking pushes all but a sliver of the mark off screen. Without these it
 * reads as a rendering bug — something got clipped. With them the character is
 * holding on to the edge of the window, which is the same information told as
 * a character rather than as damage.
 */
export const LIMBS = { y: 134, width: 33.8, height: 27.6, inset: 3, stroke: 6 };

