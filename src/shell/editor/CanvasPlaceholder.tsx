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

function SheetSkeleton() {
  const columns = ["", "A", "B", "C", "D", "E", "F", "G"];
  return (
    <div className="shell-canvas-scroll shell-canvas-scroll--flush">
      <div className="shell-skeleton-grid" aria-hidden="true">
        {columns.map((label) => (
          <span key={`head-${label}`} className="shell-skeleton-cell shell-skeleton-cell--head">
            {label}
          </span>
        ))}
        {Array.from({ length: 18 }, (_, row) =>
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
