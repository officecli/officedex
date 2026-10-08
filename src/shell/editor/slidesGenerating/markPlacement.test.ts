import { describe, expect, it } from "vitest";

import { pickSpot, rectOverlap, riderCandidates, ringEdgeRects, type Rect, type Spot } from "./markPlacement";
import { gazeToward, lineSweep } from "./markGaze";

const SIZE = 96;
const STAGE = { w: 880, h: 495 };

function fits(x: number, y: number): boolean {
  return x >= 4 && y >= 4 && x <= STAGE.w - SIZE - 6 && y <= STAGE.h - SIZE - 6;
}

describe("rectOverlap", () => {
  it("returns area of intersection and 0 when disjoint", () => {
    expect(rectOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
    expect(rectOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
  });
});

describe("riderCandidates", () => {
  it("orders right, left, below, above, then inset bottom-right", () => {
    const target = { x: 80, y: 80, w: 200, h: 80 };
    const last = { x: 136, y: 114 };
    const spots = riderCandidates(target, last, SIZE);
    expect(spots).toEqual([
      [target.x + target.w + 12, last.y - SIZE * 0.35],
      [target.x - SIZE - 20, last.y - SIZE * 0.35],
      [last.x + 16, target.y + target.h + 12],
      [last.x + 16, target.y - SIZE - 20],
      [target.x + target.w - SIZE - 8, target.y + target.h - SIZE - 8],
    ]);
  });

  it("collapses a whole-page target to the bottom-left", () => {
    const slide = { x: 36, y: 40, w: 800, h: 450, inset: true as const };
    expect(riderCandidates(slide, { x: 400, y: 200 }, SIZE)).toEqual([[slide.x + 18, slide.y + slide.h - SIZE - 18]]);
  });
});

describe("pickSpot", () => {
  const target = { x: 200, y: 120, w: 240, h: 90 };
  const last = { x: target.x + target.w * 0.28, y: target.y + target.h * 0.42 };
  const candidates = riderCandidates(target, last, SIZE);

  it("keeps writing order when every in-bounds candidate is clean", () => {
    const picked = pickSpot(candidates, SIZE, fits, []);
    expect(picked.forced).toBe(false);
    expect(picked.index).toBe(0);
    expect(picked.spot).toEqual(candidates[0]);
  });

  it("skips a candidate that overlaps a hard text line-box", () => {
    const text: Rect = { x: candidates[0][0], y: candidates[0][1], w: SIZE, h: 18 };
    const picked = pickSpot(candidates, SIZE, fits, [text]);
    expect(picked.index).toBe(1);
    expect(picked.cost[0]).toBe(0);
  });

  it("treats charts as soft: a clean hard+soft beat a zero-hard that sits on a chart", () => {
    const chart: Rect = { x: candidates[0][0], y: candidates[0][1], w: SIZE, h: SIZE, soft: true };
    const picked = pickSpot(candidates, SIZE, fits, [chart]);
    expect(picked.index).toBe(1);
    expect(picked.cost[0]).toBe(0);
    expect(picked.cost[1]).toBe(0);
  });

  it("does not swap on a soft-cost tie: writing order holds", () => {
    const picked = pickSpot(candidates, SIZE, fits, []);
    expect(picked.index).toBe(0);
  });

  it("falls back to the least-harmful in-bounds spot when every candidate hits text", () => {
    const walls: Rect[] = candidates.map((spot) => ({ x: spot[0], y: spot[1], w: SIZE, h: SIZE }));
    walls[2] = { x: candidates[2][0], y: candidates[2][1], w: 10, h: 10 };
    const picked = pickSpot(candidates, SIZE, fits, walls);
    expect(picked.forced).toBe(false);
    expect(picked.index).toBe(2);
    expect(picked.cost[0]).toBeGreaterThan(0);
  });

  it("uses the last candidate when nothing fits the stage", () => {
    const nowhere = (_x: number, _y: number) => false;
    const picked = pickSpot(candidates, SIZE, nowhere, []);
    expect(picked.forced).toBe(true);
    expect(picked.index).toBe(candidates.length - 1);
  });

  it("never reports overlap with a page badge that the bottom-left inset misses", () => {
    const slide = { x: 40, y: 40, w: 800, h: 450, inset: true as const };
    const spots = riderCandidates(slide, { x: 400, y: 200 }, SIZE);
    const badge: Rect = { x: slide.x + slide.w - 72, y: slide.y + slide.h - 28, w: 56, h: 16 };
    const picked = pickSpot(spots, SIZE, fits, [badge]);
    expect(picked.forced).toBe(false);
    const mark: Rect = { x: picked.spot[0], y: picked.spot[1], w: SIZE, h: SIZE };
    expect(rectOverlap(mark, badge)).toBe(0);
  });
});

describe("ringEdgeRects", () => {
  it("only the stroke is an obstacle, not the hollow interior", () => {
    const ring = { x: 100, y: 80, w: 200, h: 120 };
    const edges = ringEdgeRects(ring);
    const interior: Rect = { x: 140, y: 110, w: 40, h: 40 };
    expect(edges.every((edge) => rectOverlap(interior, edge) === 0)).toBe(true);
  });
});

describe("gazeToward", () => {
  it("uses direction so a nearby block on the left is not pinned at -1", () => {
    const mark = { x: 400, y: 200 };
    const closeLeft = gazeToward({ x: 360, y: 200 }, mark);
    const farLeft = gazeToward({ x: 40, y: 200 }, mark);
    expect(closeLeft.gx).toBeGreaterThan(-1);
    expect(closeLeft.gx).toBeLessThan(0);
    expect(farLeft.gx).toBeCloseTo(-1, 5);
  });

  it("mixes writing sweep so a line reads left-to-right and a wrap snaps back", () => {
    const mark = { x: 500, y: 180 };
    const focus = { x: 200, y: 180 };
    const start = gazeToward(focus, mark, -1);
    const end = gazeToward(focus, mark, 1);
    const wrap = gazeToward({ x: 120, y: 210 }, mark, -1);
    expect(start.gx).toBeLessThan(end.gx);
    expect(wrap.gx).toBeLessThan(end.gx);
    expect(lineSweep(120, 80, 200)).toBeCloseTo(-0.6, 5);
    expect(lineSweep(280, 80, 200)).toBe(1);
  });
});
