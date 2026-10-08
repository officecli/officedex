export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  soft?: boolean;
}

export type Spot = [number, number];

export function rectOverlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export interface PickSpotResult {
  spot: Spot;
  index: number;
  forced: boolean;
  cost: [number, number];
  costs: Array<[number, number] | null>;
}

/**
 * Choose a mark landing among ordered candidates.
 *
 * Hard cost is overlap with text line-boxes / search panel / page badge
 * (must be 0 when any candidate allows it). Soft cost is charts, figures and
 * the attention-ring stroke. Strictly-smaller (hard, then soft) wins, so a
 * tie keeps writing order: right → left → below → above → inset.
 */
export function pickSpot(
  candidates: readonly Spot[],
  size: number,
  fits: (x: number, y: number) => boolean,
  blocks: readonly Rect[],
): PickSpotResult {
  const guard = 2;
  const costOf = (candidate: Spot): [number, number] => {
    const box: Rect = { x: candidate[0] - guard, y: candidate[1] - guard, w: size + guard * 2, h: size + guard * 2 };
    let hard = 0;
    let soft = 0;
    for (const block of blocks) {
      const area = rectOverlap(box, block);
      if (!area) continue;
      if (block.soft) soft += area;
      else hard += area;
    }
    return [hard, soft];
  };

  let best = -1;
  let bestCost: [number, number] = [Infinity, Infinity];
  const costs = candidates.map((candidate, index) => {
    if (!fits(candidate[0], candidate[1])) return null;
    const cost = costOf(candidate);
    if (cost[0] < bestCost[0] || (cost[0] === bestCost[0] && cost[1] < bestCost[1])) {
      best = index;
      bestCost = cost;
    }
    return [Math.round(cost[0]), Math.round(cost[1])] as [number, number];
  });

  const forced = best < 0;
  if (forced) {
    best = candidates.length - 1;
    bestCost = [-1, -1];
  }

  return {
    spot: candidates[best] ?? [0, 0],
    index: best,
    forced,
    cost: [Math.round(bestCost[0]), Math.round(bestCost[1])],
    costs,
  };
}

export interface RiderTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whole-page target: stand in the bottom-left, not beside the page. */
  inset?: boolean;
}

/**
 * Ordered landing spots beside a generation target.
 *
 * Pad on the left/top is 20px because the attention stroke reaches 16px past
 * the target in those directions. A whole-page target has no beside-spot, so
 * the only candidate is the page's bottom-left (the badge lives bottom-right).
 */
export function riderCandidates(
  target: RiderTarget | null,
  lastPoint: { x: number; y: number },
  size: number,
): Spot[] {
  if (target?.inset) return [[target.x + 18, target.y + target.h - size - 18]];
  if (!target) return [[lastPoint.x + 16, lastPoint.y + 30]];
  const pad = 12;
  const padTL = 20;
  return [
    [target.x + target.w + pad, lastPoint.y - size * 0.35],
    [target.x - size - padTL, lastPoint.y - size * 0.35],
    [lastPoint.x + 16, target.y + target.h + pad],
    [lastPoint.x + 16, target.y - size - padTL],
    [target.x + target.w - size - 8, target.y + target.h - size - 8],
  ];
}

/** Four 4px-thick edges of the attention ring, used as soft obstacles. */
export function ringEdgeRects(ring: Rect): Rect[] {
  const outer: Rect = { x: ring.x - 8, y: ring.y - 8, w: ring.w + 16, h: ring.h + 16 };
  const thickness = 4;
  return [
    { x: outer.x, y: outer.y, w: outer.w, h: thickness, soft: true },
    { x: outer.x, y: outer.y + outer.h - thickness, w: outer.w, h: thickness, soft: true },
    { x: outer.x, y: outer.y, w: thickness, h: outer.h, soft: true },
    { x: outer.x + outer.w - thickness, y: outer.y, w: thickness, h: outer.h, soft: true },
  ];
}
