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
import { UpdateGate } from "./chrome/UpdateGate";
import { createDesktopAPI, hasDesktopBackend, readBridgeEnvironment } from "../renderer/bridge/select";
import { LocaleProvider } from "../renderer/i18n";
import { ForceUpdateOverlay } from "../renderer/components/ForceUpdateOverlay";
import { ShellProvider } from "./state/ShellContext";
import { readDevFixture } from "./dev/fixture";
import "./tokens.css";

const container = document.getElementById("shell-root");
if (!container) throw new Error("shell-root container is missing from index.html");

/**
 * Null in a production build whatever the URL says — the guard is inside
 * `readDevFixture`, and Vite compiles the rest of that module out. See the note
 * there.
 */
const fixture = readDevFixture(window.location.search);

const port = fixture?.port ?? createShellPort();
const canvas = createShellCanvas();
const api = hasDesktopBackend() ? createDesktopAPI(readBridgeEnvironment()) : null;

/**
 * The mandatory-update page, standing alone.
 *
 * It normally only appears when a real updater reports a build the backend
 * refuses to serve, which makes it the one full-screen surface in this product
 * nobody can look at on purpose. `?forceUpdate=<phase>` renders it directly,
 * with a release that does not exist and buttons that do nothing, so its five
 * phases can be reviewed without a backend lying about a version.
 */
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
   * all-English shell (S8-005 / S4-009). Without a provider the shell would
   * still read `navigator.language` through the context default, but it would
   * ignore the locale the user picked in Settings — the provider is what makes
   * `officedex.locale` mean the same thing on both entry points.
   */
  <LocaleProvider>
    <UpdateGate api={api}>
      <PortProvider port={port}>
        <CanvasProvider adapter={canvas}>
          <SelectionProvider>
            <ShellProvider stateOverride={fixture?.stateOverride} persist={!fixture}>
              <App />
            </ShellProvider>
          </SelectionProvider>
        </CanvasProvider>
      </PortProvider>
    </UpdateGate>
  </LocaleProvider>
);

createRoot(container).render(<StrictMode>{root}</StrictMode>);
