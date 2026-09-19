/**
 * The desktop implementation of `UiPort`.
 *
 * The UI layer is built against `src/shared/uiPort.ts` and tested against the
 * in-memory fake in `src/shell/port/fake`. This is the other implementation of
 * the same contract — not an adapter over a second domain model, which is why
 * there is no translation layer here beyond mapping one record shape to
 * another.
 *
 * Nothing in this directory touches React. `UiPort` is a Promise interface, so
 * a service is a plain object over an injected `DesktopAPI`; the host decides
 * where that handle comes from and hands it in.
 *
 * Where the fake and the desktop could differ, **the fake wins**: the UI's
 * behaviour was built against it, so a divergence here is a bug in this file
 * even when the desktop's own answer is more precise. Those places are marked.
 */

import type { DesktopAPI } from "../shared/types";
import type { UiPort } from "../shared/uiPort";
import { createFolderService } from "./folders";
import { createFileService } from "./files";
import { createSettingsService } from "./settings";
import { createModelService } from "./models";
import { createAgentService } from "./agent";
import type { WindowControls } from "./window";
import { createWindowService } from "./window";

export interface DesktopUiPortOptions {
  readonly api: DesktopAPI;
  /**
   * Window controls. The desktop's live in the Wails runtime, which this
   * directory deliberately does not import — the host injects them, and a
   * browser harness can pass its own.
   */
  readonly window: WindowControls;
}

export function createDesktopUiPort({ api, window }: DesktopUiPortOptions): UiPort {
  const files = createFileService(api);
  return {
    folders: createFolderService(api, files),
    files,
    agent: createAgentService(api),
    models: createModelService(api),
    settings: createSettingsService(api),
    window: createWindowService(window),
    pickAttachmentPaths: () => api.openMultiFileDialog({
      filters: [{ name: "Office and image files", extensions: ["docx", "xlsx", "pptx", "pdf", "png", "jpg", "jpeg", "webp"] }],
    }),
  };
}
