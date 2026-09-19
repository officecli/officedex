/**
 * The canvas slot contract.
 *
 * Word/Excel/PowerPoint rendering is deliberately *not* part of `UiPort`: it is
 * not a service call but a component the shell gives a box to. During
 * standalone UI development no adapter is registered and the host draws a
 * skeleton; at integration the desktop app registers an adapter that mounts
 * writer-component / @shimo/sdk-sheet / presentation-component into the host.
 *
 * The contract is shaped by decision 4: the host element outlives every mode
 * change, Home visit and tab switch, so an adapter is mounted once and told
 * about changes — it is never torn down and rebuilt to reflect a layout change.
 */

import type { FileMeta } from "../../shared/uiPort";

/** A span the user selected inside the document, offered to the agent as a reference. */
export interface CanvasSelection {
  fileId: string;
  /** Human label for the reference chip, e.g. "MO launch plan.docx · Heading". */
  label: string;
  /**
   * The selected words — **empty until they are needed**.
   *
   * Editors report *that* the selection changed far more cheaply than they
   * report *what* it says: Writer pushes a summary (a caret? how many
   * paragraphs?) on every cursor move, while the text costs a round trip into
   * the embed that also re-targets the editor's one tracked edit scope. So the
   * push carries the label and `resolveSelection` fetches the text at the
   * moment the message is actually sent.
   */
  text: string;
}

/**
 * A proposed change, shown *inside* the document rather than only in the panel.
 *
 * The prototype put the draft where the change would land — a block inserted
 * after the referenced paragraph, with Apply and Discard on it — so the user
 * read the proposal in the place it affects instead of comparing a panel
 * summary against a document across the window.
 *
 * **This part of the contract has no implementation yet.** The shell cannot
 * draw inside a mounted editor, so only an adapter can honour it, and none
 * does; the two methods are optional and the suggestion stays in the panel
 * where an adapter cannot show it. The shape is a proposal to whoever wires
 * the editors up — it is small on purpose (one text, one target, one action)
 * because every editor would have to implement it and docx, xlsx and pptx
 * agree on very little.
 */
export interface CanvasDraft {
  suggestionId: string;
  fileId: string;
  /** What the agent proposes, as text. */
  text: string;
  /** The span the run was given, when it was given one. */
  reference?: CanvasSelection;
}

export interface CanvasAdapter {
  /** Called once, with the persistent host element. */
  mount(host: HTMLElement): void | Promise<void>;
  /** The visible file changed, or became visible again after Home. */
  show(file: FileMeta): void;
  /** The workspace is hidden (Home). The adapter keeps its state. */
  hide(): void;
  /** Called only when the shell itself is torn down. */
  unmount(): void;
  /** Selection changes drive the agent's reference chip. Returns unsubscribe. */
  onSelection(listener: (selection: CanvasSelection | null) => void): () => void;
  /**
   * The current selection, text included, read once because it is about to be
   * sent. Optional: without it the reference travels as a label alone.
   *
   * Separate from `onSelection` because it is not free. In Writer it is
   * `capture("selection")`, which tracks a range for a later `apply` and
   * *replaces* whatever was tracked before — running it on every cursor move
   * would expire the scope an in-flight agent edit is holding. Calling it when
   * the user presses Send is both the cheapest and the most correct moment:
   * one call, and the scope it leaves behind belongs to the message that is
   * going out.
   *
   * Rejections are the caller's to swallow: a reference that could not be read
   * must not stop the message.
   */
  resolveSelection?(): Promise<CanvasSelection | null>;
  /**
   * Writes the open document back to disk.
   *
   * The editor is the only thing that has the bytes — `files.save` on the port
   * clears the dirty flag and writes nothing, which is fine while the canvas is
   * a skeleton and a lie the moment a real editor is mounted. The shell saves
   * by calling this first and the port second.
   */
  save(): Promise<void>;
  /**
   * The open document became dirty, or stopped being. Returns unsubscribe.
   *
   * Symmetric with `onSelection`, and for the same reason: the editor is the
   * only thing that knows. Nothing else in the app can tell that a user typed.
   */
  onDirtyChange(listener: (dirty: boolean) => void): () => void;
  /**
   * Show, replace or remove the in-document draft. Optional: an editor that
   * cannot render one leaves it out, and nothing else changes.
   */
  showDraft?(draft: CanvasDraft | null): void;
  /**
   * The user acted on the draft from inside the document. Returns unsubscribe.
   *
   * Only `apply` for now: it is the one action the port can carry out
   * (`agent.applySuggestion`). A Discard would be a local dismissal the
   * service layer has no notion of, and inventing one here would make the
   * document offer something the rest of the app cannot honour.
   */
  onDraftAction?(listener: (action: "apply") => void): () => void;
}

/** What the shell offers an adapter; set by the host at integration time. */
export type CanvasAdapterFactory = () => CanvasAdapter;
