import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

import { useT } from "../../renderer/i18n";
import { useAgent } from "../agent/AgentContext";
import { selectionForFile, useCanvasSelection } from "../canvas/SelectionContext";
import { AgentRun } from "../chat/AgentRun";
import { dexStateFor, runStateOf } from "../chat/runState";
import { Composer } from "../composer/Composer";
import { useReduceMotion } from "../composer/useComposerSettings";
import { Icon } from "../kit/Icon";
import type { AgentTask, FileMeta } from "../../shared/uiPort";
import { useOnline } from "../state/useOnline";
import { useShell } from "../state/ShellContext";
import { DexAvatar } from "./DexFace";
import { dexStateName, type DexState } from "./faceRenderer";

/** The bubble: 42 × 42, round (BRAND-DEX-STANDARD §04). */
const SIZE = 42;
/** Within this of an edge, the bubble rests against it. */
const EDGE_THRESHOLD = 24;
/** How much of a resting bubble stays visible. */
const EDGE_VISIBLE = 0.6;
/** A press becomes a drag only after this much travel. */
const DRAG_THRESHOLD = 6;
/** Sixty seconds without input and Dex rests its eyes. */
const IDLE_MS = 60_000;
/** A finished run smiles for this long, then goes back to ready. */
const DONE_MS = 1100;
const INFLATE_MS = 550;
const INFLATE_EASING = "cubic-bezier(.16,1,.3,1.22)";

type Edge = "left" | "right" | "top" | "bottom" | null;
type Mode = "local" | "chat";
interface Position {
  x: number;
  y: number;
  edge: Edge;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/* Local and Chat remember their positions apart, and Home restores each one's own default (§19). */
const STORAGE_KEY: Record<Mode, string> = {
  local: "officedex.shell.dex-position",
  chat: "officedex.shell.dex-position:chat",
};

function readPosition(mode: Mode): Position | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY[mode]) || "null") as Partial<Position> | null;
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? { x: saved.x as number, y: saved.y as number, edge: saved.edge ?? null }
      : null;
  } catch {
    return null;
  }
}

function writePosition(mode: Mode, position: Position | null) {
  // After the gesture, not during it: a click must never wait on storage (§16).
  setTimeout(() => {
    try {
      if (position) localStorage.setItem(STORAGE_KEY[mode], JSON.stringify(position));
      else localStorage.removeItem(STORAGE_KEY[mode]);
    } catch {
      /* view state is disposable */
    }
  }, 0);
}

/**
 * Dex over an open document — BRAND-DEX-STANDARD §04–§10.
 *
 * A 42px round bubble and the panel it opens. It exists only while an editable
 * document is on screen; Home, Assets and an empty workspace have none.
 *
 *  - **Local**: whole, 16px from the right and 48px above the bottom (52 over a
 *    workbook). Selecting something in the document opens the panel with that
 *    passage quoted above the composer.
 *  - **Chat**: resting against the right edge, 60% showing, turned −90°. A
 *    selection there goes to the conversation's composer instead, and Dex does
 *    not open or change expression for it.
 *
 * One press opens or closes it at once. Moving more than 6px turns the press
 * into a drag; the bubble stays inside the editor, rests against an edge when
 * let go within 24px of one, and steps by 10px (40 with Shift) from the
 * keyboard. Home puts it back where the mode starts it.
 *
 * The panel is 320 wide and 336, 400 or 512 tall — empty, with a quoted
 * passage, with a conversation — and grows out of the bubble in 550ms while the
 * bubble shrinks into its top-left corner. With reduced motion it simply
 * appears.
 */
export function Dex({ host, editorKind }: { host: RefObject<HTMLElement | null>; editorKind: "sheet" | "other" }) {
  const t = useT();
  const { state, dispatch, activeFile } = useShell();
  const agent = useAgent();
  const reduceMotion = useReduceMotion();
  const { selection } = useCanvasSelection();
  const bubble = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  const mode: Mode = state.chat ? "chat" : "local";
  const open = state.dexOpen;
  const floor = editorKind === "sheet" ? 32 : 28;

  const positions = useRef<Record<Mode, Position | null>>({ local: null, chat: null });
  const loaded = useRef(false);
  if (!loaded.current) {
    loaded.current = true;
    positions.current = { local: readPosition("local"), chat: readPosition("chat") };
  }
  const panelPosition = useRef<{ x: number; y: number } | null>(null);
  const lastFrame = useRef<{ w: number; h: number; mode: Mode } | null>(null);
  const drag = useRef<{
    id: number;
    target: HTMLElement;
    x: number;
    y: number;
    start: Position;
    panel: { x: number; y: number } | null;
    visiblePanel: { x: number; y: number } | null;
    moved: boolean;
  } | null>(null);
  const ignoreClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState<Edge>(null);

  const reference = mode === "local" ? selectionForFile(selection, state.activeFileId) : null;
  // A conversation that has not been spoken in has nothing to show yet.
  const task = taskForFile(agent.task, activeFile, mode === "local");
  const panelSize = task ? "conversation" : reference ? "reference" : "default";

  /** Places the bubble and, when it is open, the panel beside it. */
  const layout = useCallback(() => {
    const frame = host.current;
    const button = bubble.current;
    if (!frame || !button) return;
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (w === 0 || h === 0) return;

    let position = positions.current[mode];
    if (!position) {
      position = { x: w - SIZE - 16, y: h - SIZE - floor - 20, edge: mode === "chat" ? "right" : null };
      positions.current[mode] = position;
    }
    const last = lastFrame.current;
    if (last && last.mode === mode && (last.w !== w || last.h !== h) && !drag.current) {
      // The window changed size: keep the bubble where it was, proportionally.
      position.x = (position.x / last.w) * w;
      position.y = (position.y / last.h) * h;
      panelPosition.current = null;
    }
    lastFrame.current = { w, h, mode };

    const moving = drag.current !== null;
    let { x, y } = position;
    if (position.edge && !open && !moving) {
      x = position.edge === "left" ? -SIZE * (1 - EDGE_VISIBLE) : position.edge === "right" ? w - SIZE * EDGE_VISIBLE : clamp(x, 8, w - SIZE - 8);
      y =
        position.edge === "top"
          ? -SIZE * (1 - EDGE_VISIBLE)
          : position.edge === "bottom"
            ? h - floor - SIZE * EDGE_VISIBLE
            : clamp(y, 8, h - floor - SIZE - 8);
    } else {
      x = clamp(x, moving ? -SIZE * (1 - EDGE_VISIBLE) : 8, w - SIZE * (moving ? EDGE_VISIBLE : 1) - (moving ? 0 : 8));
      y = clamp(y, moving ? -SIZE * (1 - EDGE_VISIBLE) : 8, h - floor - SIZE * (moving ? EDGE_VISIBLE : 1) - (moving ? 0 : 8));
    }
    position.x = x;
    position.y = y;
    Object.assign(button.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto" });
    setEdge(!open && !moving ? position.edge : null);

    const sheet = panel.current;
    if (!sheet || sheet.hidden) return;
    const wanted = panelPosition.current ?? { x: x + SIZE - sheet.offsetWidth, y: y - sheet.offsetHeight - 12 };
    const left = clamp(wanted.x, 8, Math.max(8, w - sheet.offsetWidth - 8));
    const top = clamp(wanted.y, 8, Math.max(8, h - floor - sheet.offsetHeight - 8));
    Object.assign(sheet.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
    // The open bubble rides the panel's top-left corner.
    button.style.setProperty("--dx-dex-panel-x", `${left + 12 - x}px`);
    button.style.setProperty("--dx-dex-panel-y", `${top + 12 - y}px`);
  }, [host, mode, floor, open]);

  useLayoutEffect(() => {
    layout();
  });

  useEffect(() => {
    const frame = host.current;
    if (!frame) return;
    window.addEventListener("resize", layout);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layout);
    observer?.observe(frame);
    return () => {
      window.removeEventListener("resize", layout);
      observer?.disconnect();
    };
  }, [host, layout]);

  /** Let go near an edge and the bubble rests against it. */
  const dock = () => {
    const frame = host.current;
    const position = positions.current[mode];
    if (!frame || !position || open) return;
    const candidates: Array<[Exclude<Edge, null>, number]> = [
      ["left", position.x],
      ["right", frame.clientWidth - position.x - SIZE],
      ["top", position.y],
      ["bottom", frame.clientHeight - floor - position.y - SIZE],
    ];
    candidates.sort((a, b) => a[1] - b[1]);
    position.edge = candidates[0][1] <= EDGE_THRESHOLD ? candidates[0][0] : null;
  };

  const remember = () => writePosition(mode, positions.current[mode] ? { ...positions.current[mode]! } : null);

  const setOpen = useCallback(
    (next: boolean) => {
      const position = positions.current[mode];
      if (next && position?.edge) {
        // Opening steps the bubble away from the edge it was resting on.
        position.edge = null;
        panelPosition.current = null;
        writePosition(mode, { ...position });
      }
      dispatch({ type: "set-dex-open", open: next });
    },
    [dispatch, mode],
  );

  /* ---- a selection in a Local document opens Dex, quoting it (§17, §19) ---- */
  const lastSelection = useRef<string | null>(null);
  useEffect(() => {
    const signature = reference ? `${reference.fileId}:${reference.label}:${reference.text}` : null;
    if (signature && signature !== lastSelection.current && !open) setOpen(true);
    lastSelection.current = signature;
  }, [reference, open, setOpen]);

  /* ---- the panel grows out of the bubble ---------------------------------- */
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    const sheet = panel.current;
    const frame = host.current;
    const position = positions.current[mode];
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!sheet) return;
    if (!open) {
      sheet.getAnimations?.().forEach((animation) => animation.cancel());
      return;
    }
    if (!opening || reduceMotion || !frame || !position || typeof sheet.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const box = sheet.getBoundingClientRect();
    const origin = frame.getBoundingClientRect();
    const from = { left: origin.left + position.x, top: origin.top + position.y };
    const sx = SIZE / box.width;
    const sy = SIZE / box.height;
    sheet.style.transformOrigin = `${(from.left - box.left) / (1 - sx)}px ${(from.top - box.top) / (1 - sy)}px`;
    sheet.dataset.motion = "inflate";
    const animation = sheet.animate(
      [
        { transform: `scale(${sx},${sy})`, opacity: 0.35, borderRadius: "50%" },
        { transform: "scale(1)", opacity: 1, borderRadius: "16px" },
      ],
      { duration: INFLATE_MS, easing: INFLATE_EASING },
    );
    animation.onfinish = animation.oncancel = () => {
      sheet.dataset.motion = "idle";
    };
  }, [open, host, mode, reduceMotion]);

  /* ---- dragging, shared by the bubble and the panel's header --------------- */
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const pressed = event.target as HTMLElement;
    if (pressed.closest("button") && !pressed.closest(".dx-dex")) return;
    layout();
    const position = positions.current[mode];
    if (!position) return;
    const sheet = panel.current;
    drag.current = {
      id: event.pointerId,
      target: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      start: { ...position },
      panel: panelPosition.current ? { ...panelPosition.current } : null,
      visiblePanel: sheet && !sheet.hidden ? { x: sheet.offsetLeft, y: sheet.offsetTop } : null,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    current.moved = true;
    positions.current[mode] = { x: current.start.x + dx, y: current.start.y + dy, edge: null };
    if (open && current.visiblePanel) {
      panelPosition.current = { x: current.visiblePanel.x + dx, y: current.visiblePanel.y + dy };
    }
    setDragging(true);
    layout();
  };

  const finishDrag = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    if (event.type === "pointercancel") {
      positions.current[mode] = current.start;
      panelPosition.current = current.panel;
    }
    drag.current = null;
    setDragging(false);
    if (current.moved) {
      // The click that ends a drag is not a press on the bubble.
      ignoreClick.current = true;
      setTimeout(() => (ignoreClick.current = false), 0);
      if (event.type !== "pointercancel") dock();
    }
    layout();
    if (current.moved) remember();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      event.stopPropagation();
      const current = drag.current;
      positions.current[mode] = current.start;
      panelPosition.current = current.panel;
      drag.current = null;
      current.target.releasePointerCapture?.(current.id);
      setDragging(false);
      layout();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    layout();
    if (event.key === "Home") {
      positions.current[mode] = null;
      panelPosition.current = null;
    } else {
      const position = positions.current[mode];
      if (!position) return;
      const step = event.shiftKey ? 40 : 10;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      position.x += dx;
      position.y += dy;
      position.edge = null;
      if (panelPosition.current) {
        panelPosition.current = { x: panelPosition.current.x + dx, y: panelPosition.current.y + dy };
      }
    }
    layout();
    if (event.key !== "Home") {
      dock();
      layout();
    }
    remember();
  };

  // Escape closes the panel, and gives focus back to the bubble.
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || drag.current || event.defaultPrevented) return;
      setOpen(false);
      bubble.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, setOpen]);

  /* ---- expression ---------------------------------------------------------- */
  const face = useDexExpression({
    task,
    bubble,
    panel,
    open,
    selected: mode === "local" && reference !== null,
  });

  if (!activeFile) return null;

  return (
    <div className="dx-dex-layer" data-ui-scope="officedex">
      <div id="dx-dex-content">
        <section
          ref={panel}
          className="dx-dex-panel"
          data-size={panelSize}
          role="region"
          aria-label={t("dx.dex.name")}
          hidden={!open}
          inert={open ? undefined : true}
        >
          <header
            tabIndex={0}
            role="group"
            aria-label={t("dx.dex.moveAria")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onKeyDown={onKeyDown}
          >
            <div className="dx-dex-heading">
              <strong>{t("dx.dex.title")}</strong>
              <span className="dx-metadata dx-ellipsis" title={activeFile.name}>
                {activeFile.name}
              </span>
            </div>
            <button
              type="button"
              className="dx-ib"
              aria-label={t("dx.dex.close")}
              title={t("dx.dex.close")}
              data-act="dex"
              onClick={() => {
                setOpen(false);
                bubble.current?.focus({ preventScroll: true });
              }}
            >
              <Icon name="X" />
            </button>
          </header>
          <div className="dx-dex-log" role="log" aria-live="polite">
            {task ? (
              <>
                {task.messages
                  .filter((message) => message.role === "user")
                  .slice(-1)
                  .map((message) => (
                    <div key={message.id} className="dx-message dx-user">
                      {message.reference?.text ? <blockquote>{message.reference.text}</blockquote> : null}
                      {message.text}
                    </div>
                  ))}
                <AgentRun task={task} agent={agent} />
              </>
            ) : (
              <div className="dx-dex-empty">
                {t("dx.dex.empty")}
                <span>{t("dx.dex.emptyHint")}</span>
              </div>
            )}
          </div>
          {/* Built once and kept: opening and closing must not rebuild the draft (§16). */}
          <div className="dx-dex-composer-wrap">
            <Composer
              key={activeFile.id}
              draftKey={activeFile.id}
              placement="floating"
              busy={agent.busy}
              imageTask={task?.documentType === "img"}
              onSend={(submission) => agent.send(submission)}
              onStop={agent.stop}
            />
          </div>
        </section>
      </div>

      <button
        ref={bubble}
        type="button"
        className="dx-dex"
        data-act="dex"
        data-edge={edge ?? ""}
        data-state={face}
        data-dragging={dragging ? "true" : "false"}
        aria-expanded={open}
        aria-label={t(open ? "dx.dex.close" : "dx.dex.openAria")}
        aria-description={t("dx.dex.stateAria", { state: dexStateName(face) })}
        title={t("dx.dex.tip", { state: dexStateName(face) })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={onKeyDown}
        onClick={() => {
          if (ignoreClick.current || drag.current?.moved) return;
          setOpen(!open);
        }}
      >
        <DexAvatar state={face} />
      </button>
    </div>
  );
}

/**
 * Which of the sixteen expressions Dex wears.
 *
 * The run decides first — a failure or a question outranks everything the
 * pointer does (§05: "失败 / 需要确认 → 执行中 → 排队 / 暂停 → 待审阅 / 完成 → 就绪 /
 * 休眠"). With no run to show: a selection in a Local document, the pointer
 * resting on the bubble, and sixty seconds of nothing, in that order.
 */
/**
 * The run Dex speaks for: the conversation's, when it is about this file.
 *
 * Dex sits on a file, so it shows work on that file and nothing else — a
 * conversation beside the editor may be about any of the project's assets. A
 * task names its file through what it proposes to change, what it produced, or
 * what the request referred to. One that names no file at all can only be told
 * apart in Local, where the file on screen is the only thing there is to work on.
 */
function taskForFile(task: AgentTask | null, file: FileMeta | null, local: boolean): AgentTask | null {
  if (!task || !file) return null;
  // Words exchanged are the conversation's; Dex shows runs.
  if (task.status === "idle") return null;
  const named = [
    task.suggestion?.targetFileId,
    ...task.messages.map((message) => message.reference?.fileId),
  ].filter((id): id is string => Boolean(id));
  if (named.includes(file.id) || file.artifactTaskId === task.id) return task;
  return local && named.length === 0 ? task : null;
}

function useDexExpression({
  task,
  bubble,
  panel,
  open,
  selected,
}: {
  task: AgentTask | null;
  bubble: RefObject<HTMLButtonElement | null>;
  panel: RefObject<HTMLElement | null>;
  open: boolean;
  selected: boolean;
}): DexState {
  const agent = useAgent();
  const [hovered, setHovered] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const runState = runStateOf(task);
  const online = useOnline();

  // A run that has just finished smiles once, briefly.
  const lastDone = useRef<string | null>(null);
  useEffect(() => {
    const key = runState === "complete" && task ? task.id : null;
    if (!key || key === lastDone.current) {
      if (!key) lastDone.current = null;
      return;
    }
    lastDone.current = key;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), DONE_MS);
    return () => window.clearTimeout(timer);
  }, [runState, task]);

  useEffect(() => {
    let timer = window.setTimeout(() => setAsleep(true), IDLE_MS);
    const wake = () => {
      setAsleep(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAsleep(true), IDLE_MS);
    };
    document.addEventListener("pointermove", wake, { passive: true });
    document.addEventListener("keydown", wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointermove", wake);
      document.removeEventListener("keydown", wake);
    };
  }, []);

  useEffect(() => {
    const button = bubble.current;
    if (!button) return;
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    button.addEventListener("pointerenter", enter);
    button.addEventListener("pointerleave", leave);
    button.addEventListener("focus", enter);
    button.addEventListener("blur", leave);
    return () => {
      button.removeEventListener("pointerenter", enter);
      button.removeEventListener("pointerleave", leave);
      button.removeEventListener("focus", enter);
      button.removeEventListener("blur", leave);
    };
  });

  // No connection outranks everything: nothing Dex could be doing is happening.
  if (!online) return "offline";
  const fromRun = dexStateFor(runState, task);
  if (fromRun) return fromRun;
  if (celebrating) return "done";
  if (selected) return "selected";
  const typing = typeof document !== "undefined" && panel.current?.contains(document.activeElement) === true;
  if (hovered || typing) return "hover";
  return !open && asleep ? "sleep" : "ready";
}
