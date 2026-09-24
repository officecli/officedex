/**
 * Composition root for the shell, and the application's entry point.
 *
 * This is the only module that knows which UiPort implementation is in play.
 * Inside the desktop app that is the real service layer; a plain browser gets
 * the explicit empty browser-preview service, while tests inject the
 * in-memory fake directly. `createShellPort` makes that call — nothing else
 * in src/shell/ needs to know which transport is present.
 *
 * The canvas adapter is the same arrangement for the other contract the shell
 * owns: the real embedded editors on the desktop, and a clearly empty canvas
 * when no desktop bridge is present.
 *
 * `UpdateGate` wraps everything because a mandatory update outranks the whole
 * application — see the note there. It is the one piece of the old entry point
 * that had to come across with the entry itself rather than as a feature.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { PortProvider } from "./port/PortContext";
import { createShellPort } from "./port/createShellPort";
import { CanvasProvider } from "./canvas/CanvasContext";
import { SelectionProvider } from "./canvas/SelectionContext";
import { createShellCanvas } from "./port/createShellCanvas";
import { publishEditorChrome, readCanvasSurface } from "./editor/canvasSurface";
import { readCanvasLocale } from "./editor/canvasLocale";import { UpdateGate } from "./chrome/UpdateGate";
import { createDesktopAPI, hasDesktopBackend, readBridgeEnvironment } from "../renderer/bridge/select";
import { LocaleProvider } from "../renderer/i18n";
import { ForceUpdateOverlay } from "../renderer/components/ForceUpdateOverlay";
import { ShellProvider } from "./state/ShellContext";
import { readDevFixture } from "./dev/fixture";
import { deckDemoEnabled } from "./dev/deckDemo";
import { mountWindowChrome } from "../renderer/windowChrome";
import "./tokens.css";

const container = document.getElementById("shell-root");
if (!container) throw new Error("shell-root container is missing from index.html");

/*
 * Who draws the window controls, settled before the first render.
 *
 * On macOS the desktop window hides its title bar but keeps the system's
 * traffic lights, which float over the page's top-left corner. This stamps
 * `data-window-chrome="overlay"` on <html> so `WindowBar` knows not to draw a
 * second set underneath them, and installs the guard that stops a window drag
 * from selecting the whole page. Must run before `render`: the window bar reads
 * the attribute while rendering.
 */
mountWindowChrome();

/**
 * Null in a production build whatever the URL says — the guard is inside
 * `readDevFixture`, and Vite compiles the rest of that module out. See the note
 * there.
 */
const fixture = readDevFixture(window.location.search);

const port = fixture?.port ?? createShellPort();
const canvas = createShellCanvas();
const api = hasDesktopBackend() ? createDesktopAPI(readBridgeEnvironment()) : null;

/*
 * A fixture editor's chrome, for a browser that has no editors.
 *
 * Published here rather than inside `readDevFixture` because publishing is an
 * effect and that function is a parser; and here rather than in a component
 * because there is no component for an editor that is not mounted. Dev only —
 * `fixture` is null in a production build, see the note in `dev/fixture.ts`.
 */
if (fixture?.canvasChrome) publishEditorChrome(fixture.canvasChrome);

/*
 * A read handle on the two canvas channels, for the fixture only.
 *
 * Both are module state by design (see `canvasSurface.ts`) and neither has a
 * DOM projection, so a regression test could otherwise only assert their
 * *consequences* — a panel that moved, a status bar that went. Those are worth
 * asserting and this file's spec does, but a consequence test cannot tell "the
 * channel is empty" from "the channel is full and the consumer ignored it",
 * which is the one distinction this whole wave is about.
 *
 * Guarded by `fixture`, which is null in a production build.
 */
if (fixture) {
  (window as unknown as Record<string, unknown>).__officedexCanvas = {
    surface: readCanvasSurface,
    locale: readCanvasLocale,
  };
}

/**
 * The mandatory-update page, standing alone.
 *
 * It normally only appears when a real updater reports a build the backend
 * refuses to serve, which makes it the one full-screen surface in this product
 * nobody can look at on purpose. `?forceUpdate=<phase>` renders it directly,
 * with a release that does not exist and buttons that do nothing, so its five
 * phases can be reviewed without a backend lying about a version.
 */
/*
 * Boot state, from the URL, outside the dev fixture.
 *
 * `?deckDemo=1` is the shortcut to Home's "watch a deck being drawn" button.
 * It cannot live in `readDevFixture`: that module is compiled out of production
 * and this is a real entry a build should honour — the button is the product
 * path and this is the same state, set from the address bar. The recording is
 * one the app ships and it draws into a scratch draft, so there is nothing
 * here that needs a guard.
 */
const shellStateOverride = {
  ...fixture?.stateOverride,
  ...(deckDemoEnabled() ? { demo: true, home: false } : {}),
};

const root = fixture?.forceUpdate ? (
  <LocaleProvider>
    <ForceUpdateOverlay
      release={fixture.forceUpdate.release}
      phase={fixture.forceUpdate.phase}
      progress={{ bytesDone: 46_137_344, bytesTotal: 118_489_088 }}
      error={fixture.forceUpdate.phase === "error" ? "The download could not be verified." : null}
      currentVersion="1.3.2"
      onUpdate={() => {}}
      onInstall={() => {}}
    />
  </LocaleProvider>
) : (
  /*
   * The shell speaks the same language as the rest of the app.
   *
   * `LocaleProvider` used to wrap only the force-update page, which is exactly
   * how a Chinese system ended up with a Chinese update screen in front of an
   * all-English shell (S8-005 / S4-009). The default language is English;
   * the provider is what makes `officedex.locale` (the Settings choice) mean
   * the same thing on both entry points.
   */
  <LocaleProvider>
    <UpdateGate api={api}>
      <PortProvider port={port}>
        <CanvasProvider adapter={canvas}>
          <SelectionProvider>
            <ShellProvider stateOverride={shellStateOverride} persist={!fixture}>
              <App />
            </ShellProvider>
          </SelectionProvider>
        </CanvasProvider>
      </PortProvider>
    </UpdateGate>
  </LocaleProvider>
);

createRoot(container).render(<StrictMode>{root}</StrictMode>);
