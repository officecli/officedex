/**
 * Composition root for the standalone shell.
 *
 * This is the only module that knows which UiPort implementation is in play.
 * While the service layer is built separately, it is always the in-memory fake:
 * no bridge, no Wails bindings, no network. At integration a real port is
 * selected here and nothing else in src/shell/ changes.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { PortProvider } from "./port/PortContext";
import { createFakePort } from "./port/fake/createFakePort";
import { ShellProvider } from "./state/ShellContext";
import "./tokens.css";

const container = document.getElementById("shell-root");
if (!container) throw new Error("shell-root container is missing from shell.html");

const port = createFakePort();

createRoot(container).render(
  <StrictMode>
    <PortProvider port={port}>
      <ShellProvider>
        <App />
      </ShellProvider>
    </PortProvider>
  </StrictMode>,
);
