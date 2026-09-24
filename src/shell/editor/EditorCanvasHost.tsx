import { useEffect, useRef } from "react";

import { useLocale, useT } from "../../renderer/i18n";
import type { FileMeta } from "../../shared/uiPort";
import { CanvasPlaceholder } from "./CanvasPlaceholder";
import type { CanvasAdapter } from "./canvasContract";
import { canvasLocaleTag, publishCanvasLocale } from "./canvasLocale";
import { publishCanvasBox } from "./canvasSurface";
import { fixtureGenerationTask } from "./slidesGenerating/generationTaskFixtures";
import { slidesGeneratingPreview } from "./slidesGenerating/slidesGeneratingPreview";

export interface EditorCanvasHostProps {
  file: FileMeta | null;
  /** False while Home is showing. The host stays mounted either way. */
  visible: boolean;
  adapter?: CanvasAdapter | null;
  /**
   * Show the canvas even though no library file is open.
   *
   * The live-drawing stage has nothing in `documents` to key on: a deck being
   * drawn is a run, not a file (`CreateLivePptxDraft` writes to
   * `workspaceDir/live/` and registers only a preview token), so `activeFile`
   * is null for its whole life and the `visible && file` guard below would hide
   * the very surface the run is meant to be on. The bundled recording has the
   * same shape and is what reaches here today.
   */
  fileless?: boolean;
  /**
   * When the recording was last asked for. It both restarts the replay and
   * decides whether the recording still outranks a run; only the demo uses it.
   */
  demoStartedAt?: string | null;
  /** The recording lost the canvas; see `CanvasAdapter.showFileless`. */
  onDemoSuperseded?: () => void;
}

/**
 * Decision 4 in one component: this element mounts once and is never unmounted
 * for a layout reason.
 *
 * The prototype had to fake continuity across a mode switch — snapshot the DOM,
 * slice it, hinge it in 3D — precisely because its `setMode` rebuilt the
 * editor from scratch and the document visibly jumped. Keeping the host node
 * stable makes the continuity real instead of simulated, costs nothing, and
 * avoids a technique that would not survive contact with an actual document
 * renderer (snapshotting one reliably at 60fps is not a given).
 *
 * The invariant is guarded by EditorCanvasHost.test.tsx, which asserts node
 * identity across a mode change, a Home round trip and a tab switch.
 */
export function EditorCanvasHost({
  file,
  visible,
  adapter,
  fileless,
  demoStartedAt,
  onDemoSuperseded,
}: EditorCanvasHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountedAdapter = useRef<CanvasAdapter | null>(null);
  const locale = useLocale();
  const t = useT();

  /**
   * The shell's language, on the channel the canvas root can read.
   *
   * Published from here rather than from `App` because this is the seam: the
   * canvas is a separate React tree (`createRoot` in `createDesktopCanvas`) and
   * the shell's `LocaleProvider` does not reach into it, so the one component
   * that stands on both sides has to carry the value across. See
   * `canvasLocale.ts`.
   *
   * `document.documentElement.lang` goes with it, because it is the same fact
   * and the audit measured it going wrong: `<html lang="en">` around a shell
   * whose own text had become Chinese (S4-009). The Sheet SDK reads the BCP-47
   * tag (`en-US` / `zh-CN`); an empty lang falls through to Chinese. Nothing in
   * the shell reads it, but assistive technology, hyphenation and the CJK font
   * fallback all do.
   */
  useEffect(() => {
    const value = locale === "zh" ? "zh" : "en";
    publishCanvasLocale(value);
    document.documentElement.lang = canvasLocaleTag(value) ?? "en-US";
  }, [locale]);

  /**
   * Where the canvas is, for the floating layer to keep out of.
   *
   * The editor reports its chrome in its own coordinates (`canvasSurface.ts`);
   * turning that into something a `position: fixed` panel can use needs the
   * box, and the box is the shell's fact, not the editor's. Measured rather
   * than derived from the layout constants: the canvas is a flex child of a
   * column whose width animates, and the presence would otherwise be reading
   * an arithmetic reconstruction of a box that is right there to measure.
   *
   * `ResizeObserver` and not a resize listener — the box changes when the
   * sidebar collapses and when the docked column opens, neither of which is a
   * window resize. Both change the canvas's width, so both are observed.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !visible) {
      // Home. Nothing is on screen to keep out of, and a hidden element
      // measures as a zero-sized box at the origin — which, taken literally,
      // is a keep-out region covering the top-left corner.
      publishCanvasBox(null);
      return;
    }
    const measure = () => {
      const rect = host.getBoundingClientRect();
      publishCanvasBox({
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
        publishCanvasBox(null);
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    // A window resize can change where the box is without changing its size
    // (a narrower window moves nothing here, but a shorter one does not
    // necessarily resize the canvas either while a transition is mid-flight).
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      publishCanvasBox(null);
    };
  }, [visible]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !adapter || mountedAdapter.current === adapter) return;
    mountedAdapter.current?.unmount();
    mountedAdapter.current = adapter;
    void adapter.mount(host);
    return () => {
      // Only a real teardown (the shell itself unmounting) reaches this.
      adapter.unmount();
      if (mountedAdapter.current === adapter) mountedAdapter.current = null;
    };
  }, [adapter]);

  useEffect(() => {
    const active = mountedAdapter.current;
    if (!active) return;
    // `showFileless` is optional: an adapter that cannot render without a file
    // keeps the skeleton rather than pretending. Falling through to `hide()` is
    // what leaves the placeholder in place.
    if (visible && fileless && active.showFileless) {
      active.showFileless({ demo: true, demoStartedAt });
    }
    else if (visible && file) active.show(file);
    else active.hide();
  }, [demoStartedAt, file, fileless, visible]);

  return (
    <div
      ref={hostRef}
      className="shell-canvas"
      data-canvas-host="true"
      data-file-type={file?.type ?? "doc"}
      role="document"
      aria-label={file ? file.name : t("shell.canvas.documentAria")}
    >
      {adapter ? null : <HostPlaceholder type={file?.type ?? "doc"} />}
    </div>
  );
}

function HostPlaceholder({ type }: { type: FileMeta["type"] }) {
  const phase = slidesGeneratingPreview();
  if (!phase) return <CanvasPlaceholder type={type} />;
  return <CanvasPlaceholder type="slides" mode="generating" task={fixtureGenerationTask(phase)} />;
}
