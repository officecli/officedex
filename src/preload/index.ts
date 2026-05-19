import { contextBridge, ipcRenderer } from "electron";
import type { BridgeEvent, DesktopAPI, GenerateInput } from "../shared/types.js";

const api: DesktopAPI = {
  initialize: () => ipcRenderer.invoke("bridge:initialize"),
  getCapabilities: () => ipcRenderer.invoke("bridge:capabilities"),
  generate: (input: GenerateInput) => ipcRenderer.invoke("bridge:generate", input),
  respond: (input: { taskId: string; questionId?: string; optionId?: string; answer?: string }) => ipcRenderer.invoke("bridge:respond", input),
  cancel: (taskId: string) => ipcRenderer.invoke("bridge:cancel", taskId),
  openPath: (filePath: string) => ipcRenderer.invoke("shell:openPath", filePath),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  onBridgeEvent(callback: (event: BridgeEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: BridgeEvent) => callback(payload);
    ipcRenderer.on("bridge:event", listener);
    return () => ipcRenderer.removeListener("bridge:event", listener);
  },
};

contextBridge.exposeInMainWorld("officecli", api);
