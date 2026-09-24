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

import type { BinaryFileData, DesktopAPI } from "../shared/types";
import type { ImagePort, UiPort } from "../shared/uiPort";
import { translate } from "../renderer/i18n";
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
      filters: [{ name: translate("shell.service.picker.officeAndImages"), extensions: ["docx", "xlsx", "pptx", "pdf", "png", "jpg", "jpeg", "webp"] }],
    }),
    images: createImageService(api),
  };
}

/**
 * Pixels and pickers for the image surfaces.
 *
 * Bytes come through `readLocalImage` rather than an `<img>` pointed at the
 * path: the packaged webview cannot load `file://`, which is also why the
 * canvas reads its picture through the bridge.
 */
function createImageService(api: DesktopAPI): ImagePort {
  const toBlob = ({ data, mime }: { data: BinaryFileData; mime: string }) =>
    new Blob([data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data)], { type: mime });
  return {
    pickReferences: () => api.openMultiFileDialog({
      filters: [{ name: translate("shell.service.picker.images"), extensions: ["png", "jpg", "jpeg", "webp"] }],
    }),
    async importReference(file) {
      const extension = file.name.split(".").pop()?.toLowerCase() || file.type.split("/").pop() || "png";
      // An ArrayBuffer, not the File: the webview drops Blob bodies on the way
      // to Go, and the bridge encodes bytes itself.
      return api.savePastedImage(new Uint8Array(await file.arrayBuffer()), extension === "jpeg" ? "jpg" : extension);
    },
    async readPath(path) {
      return toBlob(await api.readLocalImage(path));
    },
    async readFile(fileId) {
      const record = await api.getDocument(fileId);
      return toBlob(await api.readLocalImage(record.filePath));
    },
    async saveCopy(fileId) {
      const record = await api.getDocument(fileId);
      return api.saveFileCopy(record.filePath, record.fileName);
    },
  };
}
