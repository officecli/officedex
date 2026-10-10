/**
 * Keyboard events do not bubble out of an iframe. Subscribe to each mounted
 * same-origin editor document, including replacements after load/navigation.
 * Production editor assets are served from the host origin.
 */
export function listenToShortcutDocuments(root: Window, listener: (event: KeyboardEvent) => void): () => void {
  const windows = new Map<Window, { document: Document; dispose: () => void }>();
  let disposed = false;
  const scan = () => {
    if (disposed) return;
    const live = new Set<Window>();
    const visit = (win: Window) => {
      let doc: Document;
      try { doc = win.document; } catch { return; }
      if (!doc) return;
      live.add(win);
      const previous = windows.get(win);
      if (previous?.document !== doc) {
        previous?.dispose();
        win.addEventListener("keydown", listener, true);
        const onLoad = (event: Event) => { if ((event.target as Element)?.tagName === "IFRAME") scan(); };
        doc.addEventListener("load", onLoad, true);
        const containsFrame = (node: Node) => node.nodeType === 1
          && ((node as Element).tagName === "IFRAME" || Boolean((node as Element).querySelector("iframe")));
        const observer = new MutationObserver(records => {
          if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(containsFrame))) scan();
        });
        observer.observe(doc, { childList: true, subtree: true });
        windows.set(win, { document: doc, dispose: () => {
          win.removeEventListener("keydown", listener, true);
          doc.removeEventListener("load", onLoad, true);
          observer.disconnect();
        } });
      }
      for (const frame of doc.querySelectorAll("iframe")) {
        if (frame.contentWindow) visit(frame.contentWindow);
      }
    };
    visit(root);
    for (const [win, binding] of windows) {
      if (!live.has(win)) { binding.dispose(); windows.delete(win); }
    }
  };
  scan();
  return () => {
    disposed = true;
    for (const binding of windows.values()) binding.dispose();
    windows.clear();
  };
}
