import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import started from "electron-squirrel-startup";
import { AgentBridgeClient, bridgeResultToArtifact } from "./bridgeClient.js";
import { LocalStore } from "./localStore.js";
import { desktopWorkspaceDir, withDefaultOutputDir } from "./workspace.js";
import type { Artifact, BridgeEvent, GenerateInput } from "../shared/types.js";

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | undefined;
let bridge: AgentBridgeClient | undefined;
let store: LocalStore | undefined;
const currentDir = path.dirname(fileURLToPath(import.meta.url));

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "OfficeDex",
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: path.join(currentDir, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(currentDir, "../../dist/index.html"));
  }
}

async function ensureBridge(): Promise<AgentBridgeClient> {
  if (!bridge) {
    bridge = new AgentBridgeClient();
    bridge.onEvent((event: BridgeEvent) => {
      store?.recordEvent(event);
      const artifact = artifactFromEvent(event);
      if (artifact) {
        store?.recordArtifact(artifact);
      }
      mainWindow?.webContents.send("bridge:event", event);
    });
    await bridge.start();
  }
  return bridge;
}

function artifactFromEvent(event: BridgeEvent): Artifact | null {
  if (event.type !== "task.completed") {
    return null;
  }
  const result = event.payload?.result || event.payload;
  const artifact = bridgeResultToArtifact(result);
  return artifact ? { taskId: event.task_id, ...artifact } : null;
}

function registerIPC() {
  ipcMain.handle("bridge:initialize", async () => (await ensureBridge()).initialize());
  ipcMain.handle("bridge:capabilities", async () => (await ensureBridge()).getCapabilities());
  ipcMain.handle("bridge:generate", async (_event, input: GenerateInput) => {
    const workspaceDir = desktopWorkspaceDir(app.getPath("userData"));
    await mkdir(workspaceDir, { recursive: true });
    const result = await (await ensureBridge()).invokeGenerate(withDefaultOutputDir(input, workspaceDir));
    return { taskId: result.task_id, sessionId: result.session_id, status: result.status };
  });
  ipcMain.handle("bridge:respond", async (_event, input: { taskId: string; questionId?: string; optionId?: string; answer?: string }) =>
    (await ensureBridge()).respondTask(input),
  );
  ipcMain.handle("bridge:cancel", async (_event, taskID: string) => (await ensureBridge()).cancelTask(taskID));
  ipcMain.handle("shell:openPath", async (_event, filePath: string) => {
    const error = await shell.openPath(filePath);
    if (error) {
      throw new Error(error);
    }
  });
  ipcMain.handle("shell:openExternal", async (_event, url: string) => shell.openExternal(url));
}

app.whenReady().then(async () => {
  const userDataDir = app.getPath("userData");
  await mkdir(desktopWorkspaceDir(userDataDir), { recursive: true });
  store = new LocalStore(path.join(userDataDir, "officedex.sqlite"));
  await store.open();
  registerIPC();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  bridge?.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
