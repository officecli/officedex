import { createRoot, type Root } from "react-dom/client";

import type { DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type { CanvasAdapter, CanvasSelection } from "../shell/editor/canvasContract";
import { CanvasTaskStore } from "./CanvasTaskStore";
import { CanvasContent } from "./CanvasContent";
import "./canvas.css";

/**
 * The desktop's implementation of `CanvasAdapter`.
 *
 * This layer is to `canvasContract.ts` what `src/services` is to `uiPort.ts`:
 * the desktop half of a contract the shell owns. The difference is that this
 * one is allowed to use React, because what it supplies is a component rather
 * than a service — Word/Excel/PowerPoint rendering is not a call that returns
 * a value, it is something that lives in a box the shell provides.
 *
 * **One adapter for all three types, not one each.** `EditorCanvasHost` mounts
 * an adapter when its identity changes and the contract reserves `unmount` for
 * the shell itself being torn down; handing it a different adapter per file
 * type would tear down and rebuild the canvas on every tab switch between a
 * deck and a document, which is exactly the thing decision 4 exists to prevent.
 * So the React root here is created once and re-rendered.
 *
 * Presentations, documents and workbooks are all wired. A type with no editor
 * renders nothing and the host's skeleton shows through.
 */

export interface DesktopCanvasDeps {
  readonly api: DesktopAPI;
  /** Told when the editor cannot load, so the shell can say so out loud. */
  readonly onUnavailable: (reason: string) => void;
}

export function createDesktopCanvas({ api, onUnavailable }: DesktopCanvasDeps): CanvasAdapter {
  let root: Root | null = null;
  /** The node `root` is attached to, so a repeat mount reuses it. */
  let mountedHost: HTMLElement | null = null;
  let current: FileMeta | null = null;
  /**
   * How the editor showing right now writes itself to disk, or null when none
   * is. Generalised from a presentation controller because each editor hands
   * back a different handle — a deck gives a controller, Writer gives the same
   * `WriterAgentEditor` the agent's edit path uses — and the only thing this
   * adapter ever wants from either of them is `save`.
   */
  let saveCurrent: (() => Promise<unknown>) | null = null;
  /**
   * How the editor showing right now reads its own selection, text included,
   * or null when it cannot. Reported by the leaf alongside `save`, and for the
   * same reason: only the mounted editor can answer, and which editor is
   * mounted changes under this adapter's feet.
   */
  let resolveCurrent: (() => Promise<CanvasSelection | null>) | null = null;
  const selectionListeners = new Set<(selection: CanvasSelection | null) => void>();
  const dirtyListeners = new Set<(dirty: boolean) => void>();

  const announceDirty = (dirty: boolean) => {
    for (const listener of dirtyListeners) listener(dirty);
  };

  const announceSelection = (selection: CanvasSelection | null) => {
    for (const listener of selectionListeners) listener(selection);
  };

  const setSave = (save: (() => Promise<unknown>) | null) => {
    saveCurrent = save;
  };

  const setResolveSelection = (resolve: (() => Promise<CanvasSelection | null>) | null) => {
    resolveCurrent = resolve;
  };

  function render() {
    if (!root) return;
    // One element, always the same component type, so React updates the tree
    // rather than rebuilding it. That is what keeps the task store alive — and
    // with it a drawing run's history — across every tab switch.
    root.render(
      <CanvasTaskStore api={api}>
        <CanvasContent
          api={api}
          file={current}
          onDirtyChange={announceDirty}
          onSelectionChange={announceSelection}
          onResolveSelection={setResolveSelection}
          onSave={setSave}
          onUnavailable={onUnavailable}
        />
      </CanvasTaskStore>,
    );
  }

  return {
    mount(host) {
      // Mounting the same node twice is a re-render, not a second root. The
      // host hands over one element for the life of the shell (decision 4), so
      // the only way this fires with a different node is a genuine remount.
      if (root && mountedHost === host) {
        render();
        return;
      }
      root?.unmount();
      root = createRoot(host);
      mountedHost = host;
      render();
    },

    show(file) {
      // A different document is a different editor, so the handle the old one
      // left behind is stale — and stale in the dangerous direction: `save()`
      // would write the document the user just switched away from. Clearing on
      // the branch that renders nothing was not enough, because switching
      // between two editable types never reaches it. Each leaf re-reports its
      // own handle once its editor is up.
      if (current?.id !== file.id) {
        saveCurrent = null;
        resolveCurrent = null;
        // Whatever was selected belonged to the document being left. Saying so
        // is what stops the composer quoting the previous file.
        announceSelection(null);
      }
      current = file;
      render();
    },

    hide() {
      // Home is showing. The document stays open behind it — the editor keeps
      // its session, its scroll position and its undo stack, and coming back
      // costs nothing.
      //
      // So this does nothing at all, deliberately. It used to clear `current`
      // and re-render, which renders null, which unmounts the editor: every
      // trip to Home was a document reload, the exact thing the comment here
      // said it was avoiding. The shell already hides the whole workspace
      // (`<main hidden>`), so there is nothing for this to do — a hidden iframe
      // keeps its document, an unmounted one does not.
    },

    unmount() {
      const dying = root;
      root = null;
      mountedHost = null;
      current = null;
      saveCurrent = null;
      resolveCurrent = null;
      selectionListeners.clear();
      dirtyListeners.clear();
      // Synchronously, so the host node is free before anything mounts into it
      // again. It used to be deferred to a microtask, and a mount that followed
      // immediately — StrictMode does exactly that — found the old root still
      // attached and created a second one on the same node, which React reports
      // as "createRoot() on a container that has already been passed to
      // createRoot()". Unmounting from an effect cleanup is allowed; the rule
      // that needs deferring is unmounting *during a render*, which this is not.
      dying?.unmount();
      queueMicrotask(() => dying?.unmount());
    },

    onSelection(listener) {
      // Documents push: Writer reports a selection summary on every caret move
      // and `DocxCanvas` turns it into a label. Presentations do not — they
      // answer `controller.inspect()` when asked — so a deck stays silent
      // rather than being polled for a chip that may never be used.
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },

    async resolveSelection() {
      if (!resolveCurrent) return null;
      return resolveCurrent();
    },

    onDirtyChange(listener) {
      dirtyListeners.add(listener);
      return () => dirtyListeners.delete(listener);
    },

    async save() {
      // Nothing editing means a sheet, or Home. Saving nothing is not a failure.
      if (!saveCurrent) return;
      await saveCurrent();
    },
  };
}
