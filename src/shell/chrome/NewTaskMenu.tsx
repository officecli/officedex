import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";

import type { FileType } from "../../shared/uiPort";
import { requestHomeStart } from "../home/homeStart";
import { useShell } from "../state/ShellContext";
import { FileTypeIcon } from "./FileTypeIcon";
import "./newTaskMenu.css";

/**
 * Agent mode's New task: pick what the task makes, then say what it is.
 *
 * It used to only go Home, which is a no-op on Home — exactly where people
 * press it. Now it asks the one question Home cannot: *what kind of thing*.
 * The pick goes Home and primes the hero composer for that kind (an image
 * turns on image mode); nothing starts until the user sends.
 *
 * A grid of four rather than a `Menu` list, as the prototype draws it — the
 * format under each name is part of the answer. Arrow keys move in two
 * dimensions: left/right by one, up/down by a row.
 */

const KINDS: ReadonlyArray<{ id: FileType; label: string; format: string }> = [
  { id: "doc", label: "Document", format: "DOCX" },
  { id: "sheet", label: "Spreadsheet", format: "XLSX" },
  { id: "slides", label: "Presentation", format: "PPTX" },
  { id: "image", label: "Image", format: "PNG" },
];

const COLUMNS = 2;

export function NewTaskMenu({ collapsed, label }: { collapsed: boolean; label: string }) {
  const { dispatch } = useShell();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const id = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Beside the trigger, as the prototype places it, kept inside the window.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      setPlace({
        left: Math.min(window.innerWidth - panel.offsetWidth - 12, trigger.right + 8),
        top: Math.max(12, Math.min(window.innerHeight - panel.offsetHeight - 12, trigger.top)),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const choose = (kind: FileType) => {
    close(false);
    dispatch({ type: "go-home" });
    requestHomeStart(kind);
  };

  const host = triggerRef.current?.closest<HTMLElement>("#shell") ?? (typeof document === "undefined" ? null : document.body);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="shell-sidebar-item"
        aria-label={collapsed ? label : undefined}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Plus size={18} strokeWidth={1.6} aria-hidden="true" />
        {collapsed ? null : <span>{label}</span>}
      </button>

      {open && host
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              className="shell-new-task-menu"
              role="menu"
              aria-label="New task type"
              style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close(true);
                  return;
                }
                if (event.key === "Tab") {
                  close(false);
                  return;
                }
                const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
                const index = items.indexOf(document.activeElement as HTMLElement);
                const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
                let next: number | null = null;
                if (step !== undefined) next = (index + step + items.length) % items.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = items.length - 1;
                if (next === null) return;
                event.preventDefault();
                items[next]?.focus();
              }}
            >
              <div className="shell-new-task-title">New task</div>
              <div className="shell-new-task-grid">
                {KINDS.map((kind) => (
                  <button
                    key={kind.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-label={kind.label}
                    data-kind={kind.id}
                    onClick={() => choose(kind.id)}
                  >
                    <FileTypeIcon type={kind.id} size={24} />
                    <small>{kind.format}</small>
                    <strong>{kind.label}</strong>
                  </button>
                ))}
              </div>
            </div>,
            host,
          )
        : null}
    </>
  );
}
