/**
 * Composition root for the shell.
 *
 * This is the only module that knows which UiPort implementation is in play.
 * Inside the desktop app that is the real service layer; anywhere else it is
 * the in-memory fake. `createShellPort` makes that call — nothing else in
 * src/shell/ changed when the real services arrived, which was the point of
 * building against a port in the first place.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { PortProvider } from "./port/PortContext";
import { createShellPort } from "./port/createShellPort";
import { ShellProvider } from "./state/ShellContext";
import "./tokens.css";

const container = document.getElementById("shell-root");
if (!container) throw new Error("shell-root container is missing from shell.html");

const port = createShellPort();

createRoot(container).render(
  <StrictMode>
    <PortProvider port={port}>
      <ShellProvider>
        <App />
      </ShellProvider>
    </PortProvider>
  </StrictMode>,
);
