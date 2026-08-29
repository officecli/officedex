import type { VibeOp, VibeOutline } from "../../shared/types";
import type { PresentationEditorController } from "./PresentationEditorFrame";
import { officecli } from "../bridge";

// This module's exports live inside long-lived closures — the running
// sequencer, the console demo hook — so a hot swap leaves the app executing the
// previous copy while the file on disk says otherwise. That gap is invisible
// and reads as "the change did nothing", so take the reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

/**
 * Live drawing for MOP generation, op-stream edition: the render worker logs
 * every mutation as an ordered op (deck.begin / slide.begin / shape.add /
 * slide.end / deck.end), officecli relays frames as `task.vibe_ops` events
 * while the worker runs, taskState accumulates them by seq, and this
 * interpreter executes the stream inside the embedded presentation editor
 * through `PowerPoint.run` — in small chunks, paced, on the blank draft deck
 * opened for the task. The result is a first-class editable document the user
 * watches being drawn while the backend draws it.
 */

export interface VibeReplayStatus {
  /**
   * "starved" is drawing's honest sibling: everything received has been drawn
   * and the backend has not finished — typically it is still generating
   * images. Without it the pill keeps saying "drawing slide N" while nothing
   * moves, which reads as a hang.
   */
  state: "waiting" | "drawing" | "starved" | "saving" | "done" | "failed";
  slide?: number;
  total?: number;
  error?: string;
}

/**
 * Fired on window when a live replay finishes (drawn + saved). App listens and
 * swaps the preview from the live draft to the task's official artifact — the
 * reviewed deck with real images — so the user ends on the authoritative file.
 */
export const VIBE_REPLAY_FINISHED_EVENT = "officedex:vibe-replay-finished";

export interface VibeReplayFinishedDetail {
  taskId: string;
  drawnSlides: number;
}

/**
 * The one speed dial. Every beat of the performance is derived from it, so
 * "slower" or "faster" is a single number rather than four that can drift out
 * of proportion. Zero means unpaced — nobody is watching (tests, warm-ups) and
 * every beat collapses to nothing.
 */
const CHUNK_PACE_MS = 120;

/**
 * The beats, as multiples of the pace:
 *
 * - `lead`   the outline sits on empty space before the shape lands, which is
 *            what makes the drawing read as deliberate rather than sprayed on.
 * - `settle` after a shape lands, before the outline moves on — the eye needs
 *            a moment to see what was just written.
 * - `slide`  arriving at a new page, and again after finishing one with the
 *            outline cleared, so a completed page is seen whole.
 */
function beats(paceMs: number) {
  const scale = Math.max(0, paceMs);
  return {
    paceMs: scale,
    // Typing carries the "being written" feeling now, so the outline needs a
    // shorter head start than it did when shapes simply appeared.
    leadMs: Math.round(scale * 0.9),
    settleMs: Math.round(scale * 0.3),
    slideMs: Math.round(scale * 1.8),
    // Typing is the part being watched, so it gets the longest beat of the
    // four; the structural pauses were trimmed to pay for it.
    charMs: Math.round(scale * 0.11),
  };
}

/**
 * Text is written one character at a time — that is the whole effect, and a
 * paragraph delivered in bursts of three reads as chunks appearing rather than
 * as something being written.
 *
 * Each character costs a round trip to the editor, so this only stays sane
 * because deck text is short: the lines in a slide are tens of characters, not
 * thousands. The cap below is a guard against a pathological string (a pasted
 * essay in a text box), not a tuning knob — reaching it means the line is far
 * longer than anything a slide should carry.
 */
const MAX_TEXT_STEPS = 240;

/**
 * What one round trip to the editor is allowed to cost when budgeting. Measured
 * at 6–55ms on a fresh session (an empty sync is free, adding a shape ~32ms,
 * typing a slice ~30ms), but it climbs as the document fills, so the budget
 * carries several times the measurement rather than the measurement itself.
 */
const TRIP_ALLOWANCE_MS = 150;



/**
 * Ops per executed chunk. Each chunk is one editor script whose syncs are the
 * expensive part (a full change-pipeline round trip that slows as the document
 * grows), so the stream is interpreted in small groups rather than per op.
 */
const CHUNK_SIZE = 6;

/** The most shapes that start together; the script picks 3 to 5 per group. */
const GROUP_MAX = 5;

// Dev-only stamp, set when this module is evaluated. Hot swaps and stale tabs
// have cost this feature several rounds of "the change did nothing", and the
// only way to settle it from the outside is to ask the running code what it is:
// `__vibeReplay` in the console reports when it loaded and which knobs are live.
if (import.meta.hot) {
  (window as unknown as { __vibeReplay?: unknown }).__vibeReplay = {
    loadedAt: new Date().toISOString(),
    typing: "adaptive-slices",
    charMs: beats(CHUNK_PACE_MS).charMs,
    paceMs: CHUNK_PACE_MS,
    maxTextSteps: MAX_TEXT_STEPS,
  };
}

// ---------------------------------------------------------------------------
// Live draft registry: CreateLivePptxDraft names the file live-<taskId>.pptx;
// App registers the mapping when it opens the draft and PptxViewer looks the
// task up by file path to attach a replay feed. Module state is enough — the
// draft and the viewer live in the same renderer.
// ---------------------------------------------------------------------------

/** The desktop bridge takes binary as base64; the editor encodes to text. */
function base64FromText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

const liveDrafts = new Map<string, string>();

export function registerLiveDraft(filePath: string, taskId: string) {
  liveDrafts.set(filePath, taskId);
}

export function liveTaskForFile(filePath: string): string | undefined {
  return liveDrafts.get(filePath);
}

export function releaseLiveDraft(filePath: string) {
  liveDrafts.delete(filePath);
}

/**
 * Decides what the replay should be fed, and — the part that keeps going wrong
 * — whether it is a performance or a catch-up.
 *
 * A stream is "complete" both when a task finished long ago and when a
 * recording is replayed on purpose; the first should be caught up instantly and
 * the second drawn at reading pace. Only the caller knows which, so a replay
 * started from the console says so explicitly.
 */
export function buildReplayFeed(input: {
  readonly taskId: string | null;
  readonly ops?: readonly VibeOp[];
  readonly performing: boolean;
  readonly trace: boolean;
  readonly task?: { readonly status: string; readonly vibeOps?: readonly VibeOp[]; readonly vibeOutline?: VibeOutline; readonly question?: { readonly id: string; readonly kind?: string } };
}): VibeReplayFeed | undefined {
  if (!input.taskId) return undefined;
  if (input.ops) {
    // A recording is complete by definition: nothing more will arrive.
    return { taskId: input.taskId, ops: [...input.ops], completed: true, perform: true, trace: input.trace };
  }
  if (!input.task) return undefined;
  const completed = ["completed", "failed", "cancelled"].includes(input.task.status);
  // The outline gate: the run is paused on its one confirmation stop, and
  // the pending question is how the confirmed (or edited) outline goes back.
  const gate = !completed && input.task.question?.kind === "pptx_outline_gate" && input.task.question.id
    ? { questionId: input.task.question.id }
    : undefined;
  return {
    taskId: input.taskId,
    ops: [...(input.task.vibeOps ?? [])],
    completed,
    perform: input.performing || undefined,
    trace: input.trace,
    outline: input.task.vibeOutline,
    gate,
  };
}

// ---------------------------------------------------------------------------
// Chunk script builder
// ---------------------------------------------------------------------------

interface ChunkContext {
  fontLatin: string;
  fontCJK: string;
  /** digest -> base64 image bytes, for the picture ops in this chunk. */
  images?: Record<string, string>;
  /**
   * Record the document after every shape lands. The editor is asked for its
   * own encoding, which costs no save round trip and rides the sync the
   * drawing already performs — so a history with a step per shape is nearly
   * free, where one save per shape would not be.
   */
  capture?: boolean;
  /**
   * Set once an editor has refused a translucent fill, so the rest of the
   * drawing stops paying a round trip to be told the same thing again.
   */
  veilsUnsupported?: boolean;
}

/**
 * Builds the Office.js source (async function body) that executes one chunk of
 * ops. Mirrors the render worker's authoring mapping, including its image
 * fills: a picture op names its bytes by digest, and the ones resolved from the
 * render's asset pool are painted for real. A picture whose bytes did not
 * resolve still holds its place as a quiet panel rather than collapsing the
 * composition.
 *
 * Every op resolves its own target slide: chunks are cut on op count, so a
 * chunk routinely starts mid-slide with no slide.begin in it, and chunk-local
 * state would leave those shapes with nowhere to go. Resolving activates the
 * slide too — the embedded editor lands edits on the active slide, and the
 * canvas following the drawing is exactly the effect we want. The script
 * reports what it drew and refuses to skip silently, so a shape that cannot
 * land fails the replay instead of quietly vanishing.
 */
export function buildOpsChunkScript(
  ops: VibeOp[],
  context: ChunkContext,
  paceMs = CHUNK_PACE_MS,
  tripHintMs = 60,
): string {
  const pace = beats(paceMs);
  // The shapes that close out a page: the last shape.add before each
  // slide.end (chunks are cut on slide.end, so the pair travels together).
  // These are the steps the adaptive capture policy always records.
  const captureAnchors: number[] = [];
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if ((op.op === "slide.end" || op.op === "deck.end") && index > 0 && ops[index - 1].op === "shape.add") {
      captureAnchors.push(ops[index - 1].seq);
    }
  }
  const data = JSON.stringify({
    fontLatin: context.fontLatin || "Aptos",
    fontCJK: context.fontCJK || "Microsoft YaHei",
    images: context.images ?? {},
    capture: context.capture === true,
    captureAnchors,
    veilsUnsupported: context.veilsUnsupported === true,
    ops,
  });
  return `
const data = ${data};
const PACE_MS = ${pace.paceMs};
const LEAD_MS = ${pace.leadMs};
const SETTLE_MS = ${pace.settleMs};
const SLIDE_MS = ${pace.slideMs};
const CHAR_MS = ${pace.charMs};
const MAX_TEXT_STEPS = ${MAX_TEXT_STEPS};
// A hidden page has no audience, and its timers are throttled to ~1s anyway —
// the performance would crawl, not pace. Skip the beats entirely and let the
// drawing catch up; the pacing resumes the moment the page is visible again.
const sleep = (ms) => (typeof document !== "undefined" && document.hidden ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms)));
// The real cost of typing is the editor round trip, not the beat. Each timed
// sync feeds an average (seeded by the previous chunk's measurement), and the
// slice count adapts to it: a slow editor types a line in a few large slices
// within a bounded time, a fast one still lands near per-character, and an
// unpaced catch-up writes each text in one shot.
let tripMs = ${Math.max(15, Math.round(tripHintMs))};
const sliceCountFor = (len) => {
  if (PACE_MS === 0) return 1;
  const budget = Math.min(1800, 500 + len * 25);
  return Math.max(1, Math.min(len, MAX_TEXT_STEPS, Math.floor(budget / Math.max(20, tripMs + CHAR_MS * 2.6))));
};
// An even rhythm reads as a machine ticking. These two give it an uneven one:
// wobble spreads each beat over a band around its nominal length, seeded by the
// op itself so a deck always replays exactly the same way, and weightOf leans
// on what is actually being written — a dense paragraph takes longer to put
// down than a rule or a kicker.
const wobble = (seed) => {
  const value = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};
const weightOf = (item) => {
  if (!item) return 1;
  if (item.kind === "text") {
    const length = String(item.text || "").length;
    return Math.min(1.5, 0.7 + length / 90);
  }
  const area = (item.width || 0) * (item.height || 0);
  if (area <= 0) return 0.7;
  return Math.min(1.3, 0.7 + area / 120000);
};
const beat = (base, item, seed) =>
  Math.round(base * (0.7 + 0.6 * wobble(seed)) * weightOf(item));
// Typing has its own unevenness, and it is not the same as the structural one:
// writing runs in bursts and then rests, and it rests hardest where the
// sentence does — at a comma, a colon, a full stop. A slice that lands on
// punctuation waits several beats before the next one starts.
const SENTENCE_BREAK = /[，。、；：！？…—,.;:!?]$/u;
const typeBeat = (slice, seed) => {
  const spread = 0.45 + 1.1 * wobble(seed);
  const rest = SENTENCE_BREAK.test(slice) ? 2.6 : 1;
  return Math.round(CHAR_MS * spread * rest);
};
return await PowerPoint.run(async (context) => {
  const slides = context.presentation.slides;
  let executed = 0;
  let pendingSync = 0;
  // Typing's hot-loop sync, measured: each one refines the trip average that
  // sliceCountFor sizes the next slices with.
  const timedSync = async () => {
    const t0 = Date.now();
    await context.sync();
    tripMs = tripMs * 0.7 + Math.min(2000, Date.now() - t0) * 0.3;
  };
  // The editor's own encoder, when this runtime has one. Absent on an older
  // component, in which case the deck simply records less finely.
  const captureHost = data.capture ? window.__presentationEmbeddedDocument : undefined;
  const captures = [];
  // A shape is named after the op that drew it, so a recorded step can point
  // back at exactly the object it added — per-chunk counters would repeat.
  const shapeNameFor = (item, seq) =>
    ((item && item.role) || (item && item.kind) || "shape") + "-live-" + seq;
  // The name the drawing gave this op's object, or "" when it drew nothing —
  // an empty string of text, or a kind this build has no mapping for.
  const recordedNameFor = (item, seq) => {
    if (!item) return "";
    if (item.kind === "picture") {
      const bytes = item.imageRef && item.imageRef.digest ? data.images[item.imageRef.digest] : undefined;
      return (bytes ? "image-live-" : "image-placeholder-live-") + seq;
    }
    if (item.kind === "text") return String(item.text || "").trim() ? shapeNameFor(item, seq) : "";
    if (item.kind === "rect" || item.kind === "ellipse") return shapeNameFor(item, seq);
    return "";
  };
  // The per-shape history was designed when a full-document encode was nearly
  // free. It is not once the deck has a few slides — seconds per shape, which
  // dwarfs every other cost in the drawing. So the granularity adapts: a step
  // per shape while the measured encode stays cheap, and once it has grown,
  // only the last shape of each slide — the scrubber keeps a step per page
  // instead of stalling the performance.
  let encodeMs = 0;
  const captureAfter = async (seq, item) => {
    if (!captureHost || typeof captureHost.encode !== "function") return;
    if (encodeMs > 150 && !data.captureAnchors.includes(seq)) return;
    await flush();
    const encodeStarted = Date.now();
    try {
      captures.push({
        seq,
        content: captureHost.encode(),
        // What this step put on the page, so returning to it can go there and
        // select it rather than dropping the reader on page one.
        shape: recordedNameFor(item, seq),
      });
      encodeMs = encodeMs * 0.6 + Math.min(5000, Date.now() - encodeStarted) * 0.4;
    } catch (error) {
      // A history that cannot be recorded is not a reason to stop drawing.
      console.warn("[vibeReplay] could not record this step:", error && error.message ? error.message : error);
    }
  };
  const flush = async () => {
    if (pendingSync === 0) return;
    await context.sync();
    pendingSync = 0;
    if (PACE_MS > 0) await sleep(PACE_MS);
  };
  let slide = null;
  let slideNumber = 0;
  let skipped = 0;
  let typed = 0;
  let attentionSupported = typeof context.presentation.focusAttention === "function";
  if (!attentionSupported) {
    console.warn("[vibeReplay] this editor has no attention outline (focusAttention missing); drawing without it");
  }
  // Resolves (creating and activating as needed) the slide an op targets.
  const useSlide = async (target) => {
    if (slide && slideNumber === target) return;
    await flush();
    const count = slides.getCount();
    await context.sync();
    for (let index = count.value; index < target; index += 1) slides.add();
    if (count.value < target) await context.sync();
    slide = slides.getItemAt(target - 1);
    slideNumber = target;
    slide.load("id");
    await context.sync();
    context.presentation.setSelectedSlides([slide.id]);
    await context.sync();
  };
  // Outlines where the next shape will land. Purely visual, and unsupported by
  // older editors, so a failure here must never take the drawing down with it.
  // The area a set of shapes occupies, so a group being written together is
  // marked as one region rather than the outline flicking between its members.
  const unionOf = (items) => {
    const boxes = items.filter(Boolean);
    if (boxes.length === 0) return null;
    const left = Math.min(...boxes.map((item) => item.left || 0));
    const top = Math.min(...boxes.map((item) => item.top || 0));
    const right = Math.max(...boxes.map((item) => (item.left || 0) + (item.width || 0)));
    const bottom = Math.max(...boxes.map((item) => (item.top || 0) + (item.height || 0)));
    return { left, top, width: right - left, height: bottom - top };
  };
  const focusOn = async (item, seed) => {
    if (!attentionSupported) return;
    try {
      await flush();
      context.presentation.focusAttention(
        item
          ? { left: item.left, top: item.top, width: item.width, height: item.height }
          : null,
      );
      await context.sync();
      if (item && LEAD_MS > 0) await sleep(beat(LEAD_MS, item, seed || 0));
    } catch (error) {
      // Never silently: an outline that quietly stops working looks exactly
      // like one that was never built.
      attentionSupported = false;
      console.warn("[vibeReplay] attention outline disabled:", error && error.message ? error.message : error);
    }
  };
  // Text is typed rather than pasted: the box appears with its first few
  // characters and grows to the full string. Every character costs a round trip
  // to the editor, so the string is delivered in a bounded number of slices —
  // short lines land nearly per-character, long paragraphs a few characters at
  // a time, and both read as something being written rather than appearing.
  const applyTextFormat = (shape, item, text) => {
    shape.textFrame.textRange.font.name = /[\\u3400-\\u9fff]/u.test(text) ? data.fontCJK : data.fontLatin;
    if (item.size) shape.textFrame.textRange.font.size = item.size;
    shape.textFrame.textRange.font.bold = item.bold === true;
    if (item.color) shape.textFrame.textRange.font.color = item.color;
    if (item.align === "center") {
      shape.textFrame.textRange.paragraphFormat.horizontalAlignment = "Center";
    } else if (item.align === "right") {
      shape.textFrame.textRange.paragraphFormat.horizontalAlignment = "Right";
    }
  };
  const streamText = async (item, seed) => {
    const text = String(item.text || "");
    if (!text.trim()) {
      skipped += 1;
      return;
    }
    const step = Math.max(1, Math.ceil(text.length / sliceCountFor(text.length)));
    const shape = slide.shapes.addTextBox(text.slice(0, Math.min(step, text.length)), {
      left: item.left, top: item.top, width: item.width, height: item.height,
    });
    shape.name = shapeNameFor(item, seed);
    shape.fill.clear();
    shape.lineFormat.visible = false;
    shape.textFrame.leftMargin = 0;
    shape.textFrame.rightMargin = 0;
    shape.textFrame.topMargin = 0;
    shape.textFrame.bottomMargin = 0;
    shape.textFrame.wordWrap = true;
    shape.textFrame.verticalAlignment = "Top";
    applyTextFormat(shape, item, text);
    executed += 1;
    pendingSync = 0;
    await context.sync();
    let slices = 0;
    for (let end = step * 2; end - step < text.length; end += step) {
      const written = text.slice(0, Math.min(end, text.length));
      if (CHAR_MS > 0) await sleep(typeBeat(written, seed * 31 + slices));
      // Text only. Touching any formatting at all costs about 50ms of style
      // resolution on top of the 12ms the text itself takes, and this editor
      // keeps the run's look across a full replace — measured — so re-applying
      // it per slice bought nothing and made a paragraph take seconds.
      shape.textFrame.textRange.text = written;
      // A long line can take longer to type than the editor's idle timeout, and
      // an outline that expired mid-sentence would leave the writing unmarked.
      // Re-asserting the same area only restarts that timer; it repaints
      // nothing and never moves the outline.
      slices += 1;
      typed += 1;
      if (attentionSupported && slices % 4 === 0) {
        context.presentation.focusAttention({
          left: item.left, top: item.top, width: item.width, height: item.height,
        });
      }
      await timedSync();
    }
    // One re-assert at the end: the look is expected to have survived, and
    // this costs one round trip rather than one per character.
    applyTextFormat(shape, item, text);
    await context.sync();
  };
  // How many shapes start together. A page written strictly one shape after
  // another reads like a queue being served; a few appearing at once reads like
  // someone laying out a page. The count varies, seeded by the op so a deck
  // always performs the same way.
  const groupSizeFor = (seed) => 3 + Math.floor(wobble(seed) * 3);
  /**
   * Draws a group of shapes at the same time: every shape is created in one
   * round trip, then the text ones grow a character each per tick, sharing a
   * single sync. Fewer round trips than one shape at a time, and the page fills
   * the way a person fills it — several places at once.
   */
  const drawGroup = async (entries) => {
    const typing = [];
    const veils = [];
    for (const entry of entries) {
      const item = entry.shape;
      if (!item) {
        skipped += 1;
        continue;
      }
      if (item.kind === "text") {
        const text = String(item.text || "");
        if (!text.trim()) {
          skipped += 1;
          continue;
        }
        const shape = slide.shapes.addTextBox(PACE_MS === 0 ? text : text.slice(0, 1), {
          left: item.left, top: item.top, width: item.width, height: item.height,
        });
        shape.name = shapeNameFor(item, entry.seq);
        shape.fill.clear();
        shape.lineFormat.visible = false;
        shape.textFrame.leftMargin = 0;
        shape.textFrame.rightMargin = 0;
        shape.textFrame.topMargin = 0;
        shape.textFrame.bottomMargin = 0;
        shape.textFrame.wordWrap = true;
        shape.textFrame.verticalAlignment = "Top";
        applyTextFormat(shape, item, text);
        executed += 1;
        typing.push({ shape, item, text, seed: entry.seq, written: PACE_MS === 0 ? text.length : 1 });
      } else {
        const shape = drawShape(item, entry.seq);
        if (shape && (item.transparency || 0) > 0) veils.push({ shape, item });
      }
    }
    pendingSync = 0;
    await context.sync();
    // Only now that the shapes exist can a property write risk its own batch.
    for (const veil of veils) await applyVeil(veil.shape, veil.item);
    let tick = 0;
    // Every member advances by the same adaptive step per tick, sized from the
    // group's longest text: the group finishes together within the budget on a
    // slow editor and still grows near per-character on a fast one.
    const groupLen = Math.max(1, ...typing.map((entry) => entry.text.length));
    for (;;) {
      const active = typing.filter((entry) => entry.written < entry.text.length);
      if (active.length === 0) break;
      const groupStep = Math.max(1, Math.ceil(groupLen / sliceCountFor(groupLen)));
      let latest = "";
      for (const entry of active) {
        entry.written = Math.min(entry.text.length, entry.written + groupStep);
        latest = entry.text.slice(0, entry.written);
        // Text only: re-applying the look per character costs about 50ms of
        // style resolution and this editor keeps the run's formatting across a
        // full replace.
        entry.shape.textFrame.textRange.text = latest;
        typed += 1;
      }
      tick += 1;
      // The beat belongs to the group, not to one member, so the characters
      // land together rather than drifting apart.
      if (CHAR_MS > 0) await sleep(typeBeat(latest, active[0].seed * 31 + tick));
      if (attentionSupported && tick % 4 === 0) {
        // Keeps the outline alive through a long group; same area, no repaint.
        const area = unionOf(entries.map((entry) => entry.shape));
        if (area) context.presentation.focusAttention(area);
      }
      await timedSync();
    }
    // One re-assert at the end, rather than one per character.
    for (const entry of typing) applyTextFormat(entry.shape, entry.item, entry.text);
    if (typing.length > 0) await context.sync();
  };
  // A property write is queued, not executed, so it fails at the next sync and
  // takes the whole batch with it — the shapes queued alongside it included.
  // Transparency therefore gets its own round trip, after the shapes are safely
  // on the page, and an editor that does not implement it is asked exactly once.
  let veilsUnsupported = data.veilsUnsupported === true;
  const applyVeil = async (shape, item) => {
    if (veilsUnsupported || !shape || !item.fill || !((item.transparency || 0) > 0)) return;
    try {
      shape.fill.transparency = item.transparency;
      await context.sync();
    } catch (error) {
      // The veil draws opaque for the rest of this replay; the exported
      // artifact still carries the real value.
      veilsUnsupported = true;
      console.warn("[vibeReplay] this editor cannot draw translucent fills:", error && error.message ? error.message : error);
    }
  };
  const drawShape = (item, seq) => {
    if (!slide) throw new Error("vibe replay: shape.add has no slide to draw on");
    if (!item) {
      skipped += 1;
      return;
    }
    if (item.kind === "text") {
      throw new Error("vibe replay: text is written by streamText, not drawShape");
    } else if (item.kind === "rect" || item.kind === "ellipse") {
      const preset = item.kind === "ellipse" ? "Ellipse" : item.rounded ? "RoundRectangle" : "Rectangle";
      const shape = slide.shapes.addGeometricShape(preset, {
        left: item.left, top: item.top, width: item.width, height: item.height,
      });
      shape.name = shapeNameFor(item, seq);
      if (item.fill) shape.fill.setSolidColor(item.fill);
      // Transparency is applied later, on its own round trip: see applyVeil.
      if ((item.weight || 0) > 0 && item.line) {
        shape.lineFormat.color = item.line;
        shape.lineFormat.weight = item.weight;
      } else {
        shape.lineFormat.visible = false;
      }
      executed += 1;
      pendingSync += 1;
      return shape;
    } else if (item.kind === "picture") {
      // Same mapping the render worker uses: a rectangle carrying an image
      // fill, so the drawn deck and the exported artifact agree object for
      // object. Without bytes it stays a quiet panel holding the composition.
      const bytes = item.imageRef && item.imageRef.digest ? data.images[item.imageRef.digest] : undefined;
      const shape = slide.shapes.addGeometricShape("Rectangle", {
        left: item.left, top: item.top, width: item.width, height: item.height,
      });
      // A byteless picture with an imageRef is a patchable slot: name it by
      // its (slide, kind, visualIndex) address so a later shape.update op can
      // find the panel and fill the real picture in.
      const slotName = item.imageRef
        ? "image-slot-live-" + slideNumber + "-" + (item.imageRef.kind || "primary") + "-" + (item.imageRef.visualIndex ?? 0)
        : "image-placeholder-live-" + seq;
      shape.name = bytes ? "image-live-" + seq : slotName;
      if (bytes) shape.fill.setImage(bytes);
      else shape.fill.setSolidColor(item.placeholderFill || "#EDF1F7");
      shape.lineFormat.visible = false;
    } else {
      skipped += 1;
      return;
    }
    executed += 1;
    pendingSync += 1;
  };
  for (let cursor = 0; cursor < data.ops.length; cursor += 1) {
    const entry = data.ops[cursor];
    if (entry.op === "slide.begin" || entry.op === "slide.replace") {
      await useSlide(entry.slide || 1);
      if (entry.op === "slide.replace") {
        // An in-place re-render: the page's current marks make way for the
        // new composition. Deleting through the editor keeps the whole swap
        // on the undo stack — one Cmd+Z brings the old page back.
        const existing = slide.shapes;
        existing.load("items");
        await context.sync();
        for (const item of existing.items) {
          try { item.delete(); } catch { /* already gone */ }
        }
        await context.sync();
      }
      if (entry.background) {
        slide.background.fill.setSolidFill({ color: entry.background });
        await context.sync();
      }
      // Arriving at a blank page: hold before the first mark goes down.
      if (SLIDE_MS > 0) await sleep(beat(SLIDE_MS, null, entry.seq));
    } else if (entry.op === "shape.add") {
      const target = entry.slide || slideNumber || 1;
      // Gather the shapes that start together: consecutive additions to the
      // same page, up to this group's size.
      const group = [entry];
      const size = groupSizeFor(entry.seq);
      while (group.length < size && cursor + 1 < data.ops.length) {
        const next = data.ops[cursor + 1];
        if (next.op !== "shape.add") break;
        if ((next.slide || target) !== target) break;
        group.push(next);
        cursor += 1;
      }
      await useSlide(target);
      // The outline goes on screen first, around empty space, and the shapes
      // then appear inside it. That ordering is the whole effect, so the
      // pending work is flushed before the outline moves — otherwise the
      // outline would be marking a spot whose shapes are drawn in the same
      // frame. With several shapes it marks the area they share.
      await focusOn(unionOf(group.map((member) => member.shape)), entry.seq);
      await drawGroup(group);
      await flush();
      // Every shape is a step in the deck's history, recorded the moment its
      // group lands rather than once a page is done.
      for (const member of group) await captureAfter(member.seq, member.shape);
      if (SETTLE_MS > 0) await sleep(beat(SETTLE_MS, entry.shape, entry.seq + 7));
    } else if (entry.op === "slide.end") {
      await flush();
      // The page is done: drop the outline and let it stand on its own.
      await focusOn(null);
      if (SLIDE_MS > 0) await sleep(beat(SLIDE_MS, null, entry.seq + 3));
    } else if (entry.op === "slide.delete") {
      // A shrunk deck: the leftover page goes away entirely. Ships last-page
      // first, so the editor indexes the applier navigates stay stable.
      await flush();
      const target = entry.slide || 1;
      const count = slides.getCount();
      await context.sync();
      if (count.value >= target) {
        const doomed = slides.getItemAt(target - 1);
        try { doomed.delete(); } catch { /* already gone */ }
        await context.sync();
      }
      if (slideNumber === target) { slide = null; slideNumber = 0; }
      if (SLIDE_MS > 0) await sleep(beat(SLIDE_MS, null, entry.seq + 3));
    } else if (entry.op === "shape.update") {
      // A picture that was still generating when its slide streamed: the
      // slide drew a placeholder slot, and this op fills the real image in.
      // The deck must never fail over a late picture — any miss just leaves
      // the quiet panel standing.
      const digest = entry.fill && entry.fill.imageRef && entry.fill.imageRef.digest;
      const bytes = digest ? data.images[digest] : undefined;
      if (bytes) {
        try {
          await useSlide(entry.slide || slideNumber || 1);
          const target = entry.target || {};
          const wanted = "image-slot-live-" + (entry.slide || slideNumber || 1) + "-" + (target.kind || "primary") + "-" + (target.visualIndex ?? 0);
          slide.shapes.load("items/name");
          await context.sync();
          const found = (slide.shapes.items || []).filter((candidate) => candidate.name === wanted);
          for (const candidate of found) {
            candidate.fill.setImage(bytes);
            candidate.name = "image-live-" + entry.seq;
          }
          if (found.length > 0) {
            executed += 1;
            pendingSync += 1;
            await flush();
          } else {
            skipped += 1;
          }
        } catch (error) {
          console.warn("[vibeReplay] image patch failed; the placeholder stands", error);
          skipped += 1;
        }
      } else {
        skipped += 1;
      }
    }
    // deck.begin / deck.end carry no drawing work here.
  }
  await flush();
  // The outline belongs to the drawing, not to this chunk: chunks are cut
  // every few ops (every single op while tracing), and letting each one drop
  // the outline on its way out would blink it off between shapes. It is
  // released when the deck is finished — and by the editor's own idle timeout
  // if a replay dies before that.
  if (data.ops.some((entry) => entry.op === "deck.end")) await focusOn(null);
  // typed counts the extra passes text made on its way to being complete;
  // zero means the streaming never happened, which is invisible otherwise.
  return { executed, skipped, typed, veilsUnsupported, captures, tripMs: Math.round(tripMs), encodeMs: Math.round(encodeMs) };
});
`;
}

// ---------------------------------------------------------------------------
// Op interpreter
// ---------------------------------------------------------------------------

export interface VibeReplayFeed {
  taskId: string;
  ops: VibeOp[];
  /** True once the generation task reached a terminal state. */
  completed: boolean;
  /**
   * Draw at performance pace even though the stream is already complete —
   * a recording replayed for someone to watch.
   */
  perform?: boolean;
  /**
   * Demo tracing: execute one op at a time, announcing each op before it
   * runs. Slower than chunked execution; meant for the console replay demo.
   */
  trace?: boolean;
  /**
   * The deck outline, fixed before any content exists (task.vibe_outline).
   * The sequencer ignores it; the viewer shows it while the deck is still
   * blank — the run's first visible disclosure.
   */
  outline?: VibeOutline;
  /**
   * Set while the run is paused on the outline gate: the pipeline fixed the
   * outline and is waiting for the user's verdict. The sequencer ignores it;
   * the viewer swaps the read-only outline for the editable gate.
   */
  gate?: { questionId: string };
}

export interface VibeReplaySequencerOptions {
  controller: PresentationEditorController;
  onStatus?: (status: VibeReplayStatus) => void;
  paceMs?: number;
  /** Called with each op just before it executes (trace mode logs through this). */
  onOp?: (op: VibeOp) => void;
}

/**
 * Prop-driven interpreter: `update(feed)` is called whenever the task's op
 * stream or completion flag changes; ops execute in seq order exactly once, in
 * chunks split on slide boundaries, and completion (after the stream drains)
 * saves the deck. No event subscription of its own, so mounting order and
 * React strict-mode double effects are safe.
 */
export class VibeReplaySequencer {
  private readonly controller: PresentationEditorController;
  private readonly onStatus?: (status: VibeReplayStatus) => void;
  private readonly paceMs?: number;
  /**
   * Whether this drawing is worth performing. The paced writing exists to let
   * someone watch a deck being made, and that only happens once — while the
   * generation is still producing it. Replaying a finished stream (a scrub, a
   * demo, a redraw) is a seek to a state, not a performance, so it runs flat
   * out. Decided on the first feed and kept: a live drawing must not switch
   * speed the moment its task completes.
   */
  private performing?: boolean;
  private readonly onOp?: (op: VibeOp) => void;
  private trace = false;
  /** Learned from the editor: it refused a translucent fill, so stop asking. */
  private veilsUnsupported = false;
  private ops: VibeOp[] = [];
  private cursor = 0;
  private executedSeq = 0;
  private fonts: ChunkContext = { fontLatin: "Aptos", fontCJK: "Microsoft YaHei" };
  private taskId = "";
  private completed = false;
  /** Measured editor round-trip, seeded into each chunk's typing budget. */
  private tripHintMs = 60;
  private total?: number;
  private currentSlide?: number;
  private drawnSlides = new Set<number>();
  // Image bytes never ride the op stream; deck.begin names the pool and each
  // picture op names its bytes by digest. Resolved bytes are cached because a
  // deck reuses the same image across slides, and a replay re-runs the stream.
  private assetsDir = "";
  private readonly images = new Map<string, string | null>();
  // Timeline capture is best-effort: a deck that fails to record its history
  // is still a deck, so a failing capture is remembered and dropped rather
  // than allowed to interrupt the drawing.
  private capturing = true;
  private running = false;
  private disposed = false;
  private finished = false;

  constructor(options: VibeReplaySequencerOptions) {
    this.controller = options.controller;
    this.onStatus = options.onStatus;
    this.paceMs = options.paceMs;
    this.onOp = options.onOp;
    this.emit({ state: "waiting" });
  }

  dispose() {
    this.disposed = true;
  }

  update(feed: VibeReplayFeed) {
    if (this.disposed || this.finished) return;
    this.taskId = feed.taskId;
    // Ops arrive framed and may repeat on history replay: keep a single
    // seq-sorted list and never re-execute anything at or below executedSeq.
    const bySeq = new Map<number, VibeOp>();
    for (const op of this.ops) bySeq.set(op.seq, op);
    for (const op of feed.ops) {
      if (typeof op?.seq === "number" && op.seq > 0 && !bySeq.has(op.seq)) bySeq.set(op.seq, op);
    }
    this.ops = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    this.cursor = this.ops.findIndex((op) => op.seq > this.executedSeq);
    if (this.cursor < 0) this.cursor = this.ops.length;
      if (this.performing === undefined) {
      // A stream that is already complete is usually history being caught up,
      // and catching up should be quick. A recording replayed on purpose is the
      // opposite: it exists to be watched, so it says so.
      this.performing = feed.perform ?? !feed.completed;
    }
    if (feed.completed) this.completed = true;
    if (feed.trace) this.trace = true;
    void this.pump();
  }

  /** The pace this drawing runs at; zero when nothing is being performed. */
  private performancePace(): number {
    if (this.performing === false) return 0;
    return this.paceMs ?? CHUNK_PACE_MS;
  }

  private emit(status: VibeReplayStatus) {
    if (!this.disposed) this.onStatus?.({ total: this.total, ...status });
  }

  /**
   * Takes the next chunk: up to CHUNK_SIZE contiguous ops, closing on
   * slide.end. Trace mode narrows chunks to a single op so every op can be
   * announced before it runs.
   */
  private nextChunk(): VibeOp[] {
    const chunk: VibeOp[] = [];
    // Trace announces each op before it runs, but the drawing still wants
    // several shapes in one script so they can be written at the same time.
    const limit = this.trace ? GROUP_MAX : CHUNK_SIZE;
    while (this.cursor < this.ops.length && chunk.length < limit) {
      const op = this.ops[this.cursor];
      // Contiguity: never execute past a gap in the seq order.
      if (op.seq !== this.executedSeq + chunk.length + 1) break;
      chunk.push(op);
      this.cursor += 1;
      if (op.op === "slide.end") break;
    }
    return chunk;
  }

  private absorb(op: VibeOp) {
    if (op.op === "deck.begin") {
      if (typeof op.slides === "number") this.total = op.slides;
      if (op.fonts?.latin) this.fonts.fontLatin = op.fonts.latin;
      if (op.fonts?.cjk) this.fonts.fontCJK = op.fonts.cjk;
      if (op.assetsDir) this.assetsDir = op.assetsDir;
    }
    if ((op.op === "slide.begin" || op.op === "slide.replace") && typeof op.slide === "number") {
      this.currentSlide = op.slide;
      this.drawnSlides.add(op.slide);
    }
  }

  /**
   * Fetches the bytes for the picture ops in this chunk. A digest that cannot
   * be resolved is remembered as missing and never asked for again: the deck
   * still draws, with that picture held by its placeholder panel.
   */
  private async resolveImages(chunk: VibeOp[]): Promise<Record<string, string>> {
    const digests = new Set<string>();
    for (const op of chunk) {
      const digest = op.shape?.imageRef?.digest;
      if (op.op === "shape.add" && op.shape?.kind === "picture" && digest) digests.add(digest);
      const patchDigest = op.fill?.imageRef?.digest;
      if (op.op === "shape.update" && patchDigest) digests.add(patchDigest);
    }
    if (digests.size === 0 || !this.assetsDir) return {};
    const resolved: Record<string, string> = {};
    for (const digest of digests) {
      if (!this.images.has(digest)) {
        try {
          const asset = await officecli.readDrawingAsset(this.assetsDir, digest);
          this.images.set(digest, asset.base64 || null);
        } catch {
          this.images.set(digest, null);
        }
      }
      const bytes = this.images.get(digest);
      if (bytes) resolved[digest] = bytes;
    }
    return resolved;
  }

  /** Names a step by what it put on the page, for the history strip. */
  private stepLabel(op: VibeOp | undefined, slide: number): string {
    const shape = op?.shape;
    const text = shape?.kind === "text" ? String(shape.text ?? "").trim() : "";
    if (text) return `第 ${slide} 页 · ${text.length > 14 ? `${text.slice(0, 14)}…` : text}`;
    const what = shape?.role || shape?.kind || "";
    return what ? `第 ${slide} 页 · ${what}` : `第 ${slide} 页`;
  }

  /**
   * Records the steps a chunk captured, in order. Each is the deck as it stood
   * the moment one shape landed, so the history has a step per shape rather
   * than per page.
   */
  private async recordSteps(
    chunk: VibeOp[],
    captures: Array<{ seq: number; content: string; shape?: string }>,
  ) {
    if (this.disposed || !this.capturing || !this.taskId || captures.length === 0) return;
    const session = this.controller.session?.();
    if (!session?.sessionId) return;
    const bySeq = new Map(chunk.map((op) => [op.seq, op]));
    for (const capture of captures) {
      const op = bySeq.get(capture.seq);
      const slide = op?.slide ?? this.currentSlide ?? 1;
      try {
        await officecli.captureTimelineNode({
          taskId: this.taskId,
          previewToken: session.previewToken,
          sessionId: session.sessionId,
          kind: "generation",
          seq: capture.seq,
          slide,
          slides: this.total ?? 0,
          label: this.stepLabel(op, slide),
          shape: capture.shape,
          content: base64FromText(capture.content),
          // Media only travels with the step that first needs it; the pool is
          // shared, so every later step reuses what is already there.
          withAssets: op?.shape?.kind === "picture",
        });
      } catch {
        this.capturing = false;
        return;
      }
    }
  }

  /**
   * Records the deck as it stands as the next node on the task's timeline.
   * The editor journals edits and only writes on an explicit save, so the
   * journal is flushed first — otherwise the node would hold the previous
   * slide's state rather than the one just drawn.
   */
  private async captureNode(slide: number) {
    if (!this.capturing || !this.taskId) return;
    const session = this.controller.session?.();
    if (!session?.sessionId) return;
    try {
      await this.controller.executeScript("return true;", { timeoutMs: 30_000 });
      await officecli.captureTimelineNode({
        taskId: this.taskId,
        previewToken: session.previewToken,
        sessionId: session.sessionId,
        kind: "generation",
        seq: this.executedSeq,
        slide,
        slides: this.total ?? 0,
        label: `第 ${slide} 页完成`,
      });
    } catch {
      this.capturing = false;
    }
  }

  private async pump() {
    if (this.running || this.disposed || this.finished) return;
    this.running = true;
    try {
      for (let chunk = this.nextChunk(); chunk.length > 0; chunk = this.nextChunk()) {
        for (const op of chunk) {
          this.absorb(op);
          this.onOp?.(op);
        }
        if (this.currentSlide) this.emit({ state: "drawing", slide: this.currentSlide });
        const drawable = chunk.some((op) => op.op === "shape.add" || op.op === "slide.begin" || op.op === "slide.replace" || op.op === "slide.delete" || op.op === "shape.update");
        let chunkCaptures: Array<{ seq: number; content: string; shape?: string }> = [];
        if (drawable) {
          // The script spends most of its time waiting on purpose, so the
          // budget has to grow with the pace or a slower performance would
          // look like a hung editor.
          const paceMs = this.performancePace();
          const pace = beats(paceMs);
          // What one op can cost: the beats it deliberately waits out, plus one
          // editor round trip per typed slice and one for recording the step.
          // A measured trip is tens of milliseconds on a fresh session; the
          // allowance is generous because it grows with the open document, and
          // a budget that runs out reads to the user as a hung editor.
          const typingMs = MAX_TEXT_STEPS * (pace.charMs * 2.6 + TRIP_ALLOWANCE_MS);
          const perOpMs = 4_000 + typingMs + TRIP_ALLOWANCE_MS + pace.leadMs + pace.settleMs + pace.slideMs;
          const budgetMs = 30_000 + chunk.length * perOpMs;
          const startedAt = performance.now();
          const images = await this.resolveImages(chunk);
          // Recording follows the drawing, not the source of the ops: the draft
          // was reset to blank before this started, so whatever draws it — a
          // live generation or a replay of one — is what its history is.
          const context = { ...this.fonts, images, capture: this.capturing };
          const outcome = await this.controller.executeScript(buildOpsChunkScript(chunk, context, paceMs, this.tripHintMs), {
            awaitSnapshotMs: 0,
            timeoutMs: budgetMs,
          });
          // Every shape.add must be accounted for. Chunk scripts used to drop
          // shapes they could not place without a word, which reads as a
          // successful replay onto an empty deck; refuse to continue instead.
          const elapsedMs = Math.round(performance.now() - startedAt);
          if (this.trace) {
            // The op trace says what was asked for; this says what the editor
            // actually did with it — including how many passes the text took to
            // type, which is otherwise only visible by watching closely.
            // The elapsed time separates "the beats never ran" from "they ran
            // but nothing was painted between them" — the two look identical on
            // screen and have completely different causes.
            const done = ((outcome as { result?: Record<string, unknown> } | undefined)?.result ?? {}) as {
              captures?: unknown[];
            };
            // Without the recorded documents: one step's encoding is tens of
            // kilobytes, and printing it per op buries the trace it belongs to.
            const { captures: recorded, ...summary } = done;
            console.info(
              "[vibeReplay:done]",
              JSON.stringify({ ...summary, recorded: recorded?.length ?? 0 }),
              `${elapsedMs}ms`,
            );
          }
          const requested = chunk.filter((op) => op.op === "shape.add").length;
          // An editor that cannot draw translucent fills says so once; asking
          // again on every group would cost a wasted round trip each time.
          if ((outcome as { result?: { veilsUnsupported?: boolean } } | undefined)?.result?.veilsUnsupported) {
            this.veilsUnsupported = true;
          }
          const report = (outcome as {
            result?: {
              executed?: number;
              skipped?: number;
              tripMs?: number;
              captures?: Array<{ seq: number; content: string; shape?: string }>;
            };
          } | undefined)?.result;
          // Carry the measured editor round-trip into the next chunk, so its
          // first texts already type at the right slice size.
          if (typeof report?.tripMs === "number" && Number.isFinite(report.tripMs)) {
            this.tripHintMs = Math.min(800, Math.max(15, report.tripMs));
          }
          chunkCaptures = report?.captures ?? [];
          const accounted = (report?.executed ?? 0) + (report?.skipped ?? 0);
          if (report && accounted < requested) {
            throw new Error(`drew ${accounted} of ${requested} shapes on slide ${this.currentSlide ?? 1}`);
          }
        }
        this.executedSeq = chunk[chunk.length - 1].seq;
        await this.recordSteps(chunk, chunkCaptures);
      }
      if (!this.completed && this.cursor >= this.ops.length && this.drawnSlides.size > 0) {
        // Everything received is on the page and the backend has not finished:
        // say so, instead of letting "drawing slide N" sit over a still canvas
        // while images generate or a retry runs.
        this.emit({ state: "starved", slide: this.currentSlide ?? undefined });
      }
      if (this.completed && this.cursor >= this.ops.length) {
        this.finished = true;
        if (this.drawnSlides.size > 0) {
          this.emit({ state: "saving" });
          // The local editor session journals edits and persists only on an
          // explicit save; the host bridge dispatches that flush when a script
          // runs with the default snapshot wait. Drawing scripts skip it for
          // speed (awaitSnapshotMs: 0), so flush once before exporting or the
          // export ships the blank deck.
          await this.controller.executeScript("return true;", { timeoutMs: 30_000 });
          await this.controller.save();
        }
        this.emit({ state: "done", slide: this.drawnSlides.size });
        if (!this.disposed && this.taskId && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent<VibeReplayFinishedDetail>(VIBE_REPLAY_FINISHED_EVENT, {
            detail: { taskId: this.taskId, drawnSlides: this.drawnSlides.size },
          }));
        }
      }
    } catch (error) {
      this.finished = true;
      this.emit({ state: "failed", error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.running = false;
      // Re-pump only when progress is actually possible: the next contiguous
      // op is present, or completion arrived mid-run with the stream drained.
      // Anything else (a seq gap) waits for the next update() instead of
      // spinning.
      const nextContiguous = this.cursor < this.ops.length && this.ops[this.cursor].seq === this.executedSeq + 1;
      const finishable = this.completed && this.cursor >= this.ops.length;
      if (!this.disposed && !this.finished && (nextContiguous || finishable)) void this.pump();
    }
  }
}

// ---------------------------------------------------------------------------
// One-shot in-place application: the reslide path
// ---------------------------------------------------------------------------

/**
 * Applies a single-slide re-render (pptx/reslide) to the open editor session.
 *
 * The ops arrive numbered as a continuation of the deck's own op stream (the
 * manifest's watermark), but this application is its own little performance,
 * so they are renumbered from 1 for the sequencer's contiguity rule. The feed
 * is complete before it starts and performed at reading pace — the page
 * visibly clears and redraws. The taskId is namespaced so the app-level
 * finished handler (which swaps a live draft for the official artifact) never
 * mistakes a reslide for the original generation.
 */
export function applyReslideOps(
  controller: PresentationEditorController,
  input: { taskId: string; ops: VibeOp[]; assetsDir?: string },
  onStatus?: (status: VibeReplayStatus) => void,
): Promise<void> {
  const ops = input.ops.map((op, index) => ({
    ...op,
    seq: index + 1,
    // Digest resolution rides deck.begin; a stream without one (defensive)
    // still resolves through the explicit assetsDir.
    ...(op.op === "deck.begin" && input.assetsDir ? { assetsDir: input.assetsDir } : {}),
  }));
  return new Promise((resolve, reject) => {
    const sequencer = new VibeReplaySequencer({
      controller,
      onStatus: (status) => {
        onStatus?.(status);
        if (status.state === "done") {
          sequencer.dispose();
          resolve();
        } else if (status.state === "failed") {
          sequencer.dispose();
          reject(new Error(status.error || "reslide apply failed"));
        }
      },
    });
    sequencer.update({ taskId: `reslide:${input.taskId}`, ops, completed: true, perform: true });
  });
}
