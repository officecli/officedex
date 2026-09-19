import { useEffect, useRef, useState } from "react";

import type { FileType } from "../../shared/uiPort";

/**
 * What the canvas shows while no editor adapter is registered. It is a
 * skeleton, not a mock editor: the point of the slot is that the real document
 * renderers arrive at integration, so building a second set of fake editors
 * here would only be thrown away.
 *
 * The proportions follow the prototype so the surrounding chrome can be
 * screenshot-compared against it.
 */
export function CanvasPlaceholder({ type }: { type: FileType }) {
  if (type === "sheet") return <SheetSkeleton />;
  if (type === "slides") return <SlidesSkeleton />;
  return <DocSkeleton />;
}

function DocSkeleton() {
  return (
    <div className="shell-canvas-scroll">
      <div className="shell-skeleton-paper" aria-hidden="true">
        <span className="shell-skeleton-line shell-skeleton-line--eyebrow" />
        <span className="shell-skeleton-line shell-skeleton-line--title" />
        {[92, 100, 96, 64].map((width, index) => (
          <span key={index} className="shell-skeleton-line" style={{ width: `${width}%` }} />
        ))}
        <span className="shell-skeleton-line shell-skeleton-line--heading" />
        {[100, 88, 97, 52].map((width, index) => (
          <span key={index} className="shell-skeleton-line" style={{ width: `${width}%` }} />
        ))}
        <span className="shell-skeleton-block" />
      </div>
    </div>
  );
}

/**
 * `grid-auto-rows` for `.shell-skeleton-grid` (app.css). The grid is drawn in
 * fixed rows, so the count and the height are the same decision and have to be
 * made in the same place.
 */
const SHEET_ROW_HEIGHT = 26;

/** Enough that a short viewport still reads as a spreadsheet. */
const SHEET_MIN_ROWS = 18;

/**
 * How many body rows fit under the column header in `element`.
 *
 * Measured rather than assumed: the row count was a literal 18, which drew a
 * 494px grid into a canvas of whatever height the window gave it — 728px in the
 * audit, leaving 234px (32%) of white below a table that stopped dead at row 18
 * and read as "this sheet has 18 rows" rather than "this sheet has not loaded"
 * (S6-014).
 */
function rowsFor(height: number): number {
  if (height <= 0) return SHEET_MIN_ROWS;
  // One row of the budget belongs to the A/B/C header.
  const fit = Math.ceil(height / SHEET_ROW_HEIGHT) - 1;
  return Math.max(SHEET_MIN_ROWS, fit);
}

/** Tracks an element's height, so the skeleton can be cut to the canvas. */
function useFittedRows(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [rows, setRows] = useState(SHEET_MIN_ROWS);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setRows(rowsFor(node.clientHeight));
    measure();
    // jsdom has no ResizeObserver; the initial measurement above is what the
    // unit tests see, and the browser gets the live one.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, rows];
}

function SheetSkeleton() {
  const columns = ["", "A", "B", "C", "D", "E", "F", "G"];
  const [scrollRef, rows] = useFittedRows();
  return (
    <div className="shell-canvas-scroll shell-canvas-scroll--flush" ref={scrollRef}>
      <div className="shell-skeleton-grid" aria-hidden="true">
        {columns.map((label) => (
          <span key={`head-${label}`} className="shell-skeleton-cell shell-skeleton-cell--head">
            {label}
          </span>
        ))}
        {Array.from({ length: rows }, (_, row) =>
          columns.map((label, column) => (
            <span
              key={`${row}-${label}`}
              className={`shell-skeleton-cell${column === 0 ? " shell-skeleton-cell--head" : ""}`}
            >
              {column === 0 ? row + 1 : ""}
            </span>
          )),
        )}
      </div>
    </div>
  );
}

function SlidesSkeleton() {
  return (
    <div className="shell-canvas-scroll shell-canvas-scroll--slides">
      <div className="shell-skeleton-filmstrip" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            className={`shell-skeleton-thumb${index === 2 ? " shell-skeleton-thumb--current" : ""}`}
          />
        ))}
      </div>
      <div className="shell-skeleton-stage" aria-hidden="true">
        <div className="shell-skeleton-slide">
          <span className="shell-skeleton-line shell-skeleton-line--title" style={{ width: "62%" }} />
          <span className="shell-skeleton-line" style={{ width: "44%" }} />
          <span className="shell-skeleton-block shell-skeleton-block--slide" />
        </div>
      </div>
    </div>
  );
}
