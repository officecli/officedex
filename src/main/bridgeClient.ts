import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import path from "node:path";
import { app } from "electron";
import type { Artifact, BridgeEvent, GenerateInput } from "../shared/types.js";

interface BridgeTransport {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(): void;
  onExit(callback: (code: number | null, signal: NodeJS.Signals | null) => void): void;
}

type TransportFactory = () => BridgeTransport;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface AgentBridgeClientOptions {
  binaryPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  createTransport?: TransportFactory;
  requestTimeoutMs?: number;
}

export class AgentBridgeClient {
  private transport?: BridgeTransport;
  private nextID = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(event: BridgeEvent) => void>();
  private sessionID = "default";
  private outputBuffer = Buffer.alloc(0);
  private stderrBuffer = "";
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: AgentBridgeClientOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async start(): Promise<void> {
    if (this.transport) {
      return;
    }
    this.transport = this.options.createTransport ? this.options.createTransport() : createProcessTransport(this.options);
    this.transport.onExit((code, signal) => {
      const stderr = this.stderrBuffer.trim();
      const suffix = stderr ? `\nstderr:\n${stderr}` : "";
      const error = new Error(`officecli agent-bridge exited: code=${code ?? "null"} signal=${signal ?? "null"}${suffix}`);
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      this.pending.clear();
      this.transport = undefined;
      this.outputBuffer = Buffer.alloc(0);
    });
    this.transport.stdout.on("data", (chunk) => this.handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    this.transport.stderr.on("data", (chunk) => {
      this.stderrBuffer = `${this.stderrBuffer}${String(chunk)}`.slice(-8192);
    });
  }

  stop(): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("officecli agent-bridge stopped"));
    }
    this.pending.clear();
    this.transport?.kill();
    this.transport = undefined;
    this.outputBuffer = Buffer.alloc(0);
  }

  onEvent(listener: (event: BridgeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize(): Promise<unknown> {
    return this.request("initialize");
  }

  getCapabilities(): Promise<unknown> {
    return this.request("capabilities/get");
  }

  async openSession(): Promise<string> {
    const result = (await this.request("session/open")) as { id?: string };
    this.sessionID = result.id || "default";
    return this.sessionID;
  }

  async invokeGenerate(input: GenerateInput): Promise<{ task_id: string; session_id: string; status: string }> {
    if (this.sessionID === "default") {
      await this.openSession();
    }
    const result = (await this.request("task/invoke", {
      session_id: this.sessionID,
      tool: "office.generate",
      interactive: true,
      output_format: "bundle",
      args: {
        document_type: input.documentType,
        topic: input.topic,
        prompt: input.prompt,
        mode: input.mode || "fast",
        runtime_mode: input.runtimeMode,
        file_path: input.sourceFile,
        out: input.outputDir,
        publish: input.publish,
        enable_images: input.enableImages,
        image_quality: input.imageQuality,
      },
    })) as { task_id: string; session_id: string; status: string };
    return result;
  }

  respondTask(params: { taskId: string; questionId?: string; optionId?: string; answer?: string }): Promise<unknown> {
    return this.request("task/respond", {
      task_id: params.taskId,
      question_id: params.questionId,
      option_id: params.optionId,
      answer: params.answer,
    });
  }

  cancelTask(taskID: string): Promise<unknown> {
    return this.request("task/cancel", { task_id: taskID });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (!this.transport) {
      throw new Error("officecli agent-bridge is not running");
    }
    const id = this.nextID++;
    const message = { jsonrpc: "2.0", id, method, params };
    this.transport.stdin.write(encodeJSONRPCMessage(message));
    return new Promise((resolve, reject) => {
      const key = String(id);
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`officecli bridge request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(key, { resolve, reject, timeout });
    });
  }

  private handleData(chunk: Buffer): void {
    this.outputBuffer = Buffer.concat([this.outputBuffer, chunk]);
    while (true) {
      const separator = this.outputBuffer.indexOf("\r\n\r\n");
      if (separator < 0) {
        return;
      }
      const header = this.outputBuffer.subarray(0, separator).toString("utf8");
      const match = /^content-length:\s*(\d+)$/im.exec(header);
      if (!match) {
        this.outputBuffer = this.outputBuffer.subarray(separator + 4);
        continue;
      }
      const contentLength = Number(match[1]);
      const bodyStart = separator + 4;
      const messageEnd = bodyStart + contentLength;
      if (this.outputBuffer.length < messageEnd) {
        return;
      }
      const body = this.outputBuffer.subarray(bodyStart, messageEnd).toString("utf8");
      this.outputBuffer = this.outputBuffer.subarray(messageEnd);
      this.handleMessageBody(body);
    }
  }

  private handleMessageBody(body: string): void {
    let message: any;
    try {
      message = JSON.parse(body);
    } catch {
      return;
    }
    if (typeof message.id === "number" || typeof message.id === "string") {
      const key = String(message.id);
      const pending = this.pending.get(key);
      if (!pending) {
        return;
      }
      this.pending.delete(key);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message || "officecli bridge request failed"));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (message.method && message.params) {
      const event = normalizeBridgeEvent(message.method, message.params);
      for (const listener of this.listeners) {
        listener(event);
      }
    }
  }
}

function encodeJSONRPCMessage(message: unknown): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function normalizeBridgeEvent(method: string, params: any): BridgeEvent {
  if (params && typeof params === "object" && typeof params.type === "string") {
    return params as BridgeEvent;
  }
  return { type: method, payload: params };
}

function createProcessTransport(options: AgentBridgeClientOptions): BridgeTransport {
  const binary = options.binaryPath || resolveOfficeCLIBinary();
  const child = spawn(binary, ["agent-bridge"], {
    cwd: options.cwd || process.cwd(),
    env: buildBridgeEnv(options.env),
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    kill: () => child.kill(),
    onExit: (callback) => child.once("exit", callback),
  };
}

export function buildBridgeEnv(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OFFICECLI_SKIP_SKILL_PREFLIGHT: "1",
    OFFICECLI_SKIP_PUBLISH_SETUP: "1",
    OFFICECLI_SKIP_UPDATE_CHECK: "1",
    ...env,
  };
}

function resolveOfficeCLIBinary(): string {
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, "officecli-bin", process.platform === "win32" ? "officecli.exe" : "officecli");
  }
  return process.env.OFFICECLI_DESKTOP_BINARY || "officecli";
}

export function bridgeResultToArtifact(result: unknown): Omit<Artifact, "taskId"> | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const value = result as Record<string, unknown>;
  const filePath = stringValue(value.file_path) || stringValue(value.filePath);
  if (!filePath) {
    return null;
  }
  const fileName = stringValue(value.file_name) || stringValue(value.fileName) || path.basename(filePath);
  const documentType = stringValue(value.document_type) || stringValue(value.documentType) || path.extname(fileName).replace(/^\./, "");
  const previewUrl = stringValue(value.access_url) || stringValue(value.preview_url) || stringValue(value.previewUrl);
  const fileID = stringValue(value.file_id) || stringValue(value.fileID);
  return {
    ...(fileID ? { fileID } : {}),
    filePath,
    fileName,
    documentType,
    ...(previewUrl ? { previewUrl } : {}),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
