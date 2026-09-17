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

import type { FileMeta } from "../port/types";

/** A span the user selected inside the document, offered to the agent as a reference. */
export interface CanvasSelection {
  fileId: string;
  /** Human label for the reference chip, e.g. "MO launch plan.docx · Heading". */
  label: string;
  text: string;
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
}

/** What the shell offers an adapter; set by the host at integration time. */
export type CanvasAdapterFactory = () => CanvasAdapter;
