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
import { ShellProvider } from "./state/ShellContext";
import "./tokens.css";

const container = document.getElementById("shell-root");
if (!container) throw new Error("shell-root container is missing from index.html");

const port = createShellPort();
const canvas = createShellCanvas();
const api = hasDesktopBackend() ? createDesktopAPI(readBridgeEnvironment()) : null;

createRoot(container).render(
  <StrictMode>
    <UpdateGate api={api}>
      <PortProvider port={port}>
        <CanvasProvider adapter={canvas}>
          <SelectionProvider>
            <ShellProvider>
              <App />
            </ShellProvider>
          </SelectionProvider>
        </CanvasProvider>
      </PortProvider>
    </UpdateGate>
  </StrictMode>,
);
