#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 15_000;

/** The id this gate asks under, and the only one it will accept an answer on. */
const INITIALIZE_ID = 1;

export function verifyVersionOutput(output, expectedVersion) {
  const text = String(output ?? "").trim();
  const match = text.match(/officecli\s+version\s+v?(\d+\.\d+\.\d+)/i);
  const actual = match?.[1];
  if (actual !== expectedVersion) {
    throw new Error(`expected OfficeCLI ${expectedVersion}, got ${actual || text || "unknown"}`);
  }
}

export function verifyInitializeResult(result, expectedVersion) {
  if (!result || typeof result !== "object") {
    throw new Error("OfficeCLI initialize result is missing");
  }
  if (result.server_version !== expectedVersion) {
    throw new Error(`OfficeCLI server_version is ${String(result.server_version)}, expected ${expectedVersion}`);
  }

  const eventTypes = result.capabilities?.event_types;
  if (!Array.isArray(eventTypes) || !eventTypes.includes("task.vibe_tree")) {
    throw new Error("OfficeCLI Canvas contract is missing task.vibe_tree");
  }

  const generateTool = Array.isArray(result.tools)
    ? result.tools.find((tool) => tool?.name === "office.generate")
    : undefined;
  if (!generateTool?.input_schema || !("generation_mode" in generateTool.input_schema)) {
    throw new Error("OfficeCLI Canvas contract is missing office.generate generation_mode");
  }
}

export async function verifyOfficecliCanvasContract({ binary, expectedVersion, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!binary) throw new Error("--binary is required");
  if (!expectedVersion) throw new Error("--expected is required");

  const versionOutput = execFileSync(binary, ["--version"], { encoding: "utf8" });
  verifyVersionOutput(versionOutput, expectedVersion);

  const child = spawn(binary, ["agent-bridge"], {
    env: {
      ...process.env,
      OFFICECLI_SKIP_SKILL_PREFLIGHT: "1",
      OFFICECLI_SKIP_PUBLISH_SETUP: "1",
      OFFICECLI_SKIP_UPDATE_CHECK: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const responsePromise = readLspResponse(child, timeoutMs);
    child.stdin.write(encodeLspMessage({ jsonrpc: "2.0", id: INITIALIZE_ID, method: "initialize" }));
    const response = await responsePromise;
    if (response?.error) {
      throw new Error(`OfficeCLI initialize failed: ${JSON.stringify(response.error)}`);
    }
    verifyInitializeResult(response?.result, expectedVersion);
  } finally {
    child.kill();
  }
}

function encodeLspMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
    body,
  ]);
}

function readLspResponse(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for OfficeCLI initialize after ${timeoutMs}ms${stderr ? `: ${stderr.trim()}` : ""}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const onStderr = (chunk) => {
      stderr += String(chunk);
    };
    const onError = (error) => fail(error);
    const onExit = (code, signal) => {
      fail(new Error(`OfficeCLI agent-bridge exited before initialize response (code=${code ?? ""}, signal=${signal ?? ""})${stderr ? `: ${stderr.trim()}` : ""}`));
    };
    /*
     * Drain frames until the answer to *this* request arrives.
     *
     * The bridge is a JSON-RPC server, not a request/response pipe: it emits
     * `event` notifications whenever it has something to say, including before
     * it has answered anything. A run left over from a previous session is
     * enough — it resumes on startup and announces itself, and this gate used
     * to take that first frame as the initialize response, find no `result` on
     * a notification, and fail the whole build with "OfficeCLI initialize
     * result is missing".
     *
     * Observed exactly that: a stuck run announced `run.failed: run was
     * resumed too many times without finishing` ahead of the response, and a
     * build that had nothing wrong with it stopped here.
     *
     * So frames are consumed until one carries this request's id. Notifications
     * have no id at all, which is what makes them skippable rather than
     * ambiguous.
     */
    const onStdout = (chunk) => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
      for (;;) {
        const headerEnd = stdout.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = stdout.subarray(0, headerEnd).toString("ascii");
        const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
        if (!match) {
          fail(new Error(`OfficeCLI initialize response is missing Content-Length: ${header}`));
          return;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (stdout.length < bodyStart + length) return;
        const body = stdout.subarray(bodyStart, bodyStart + length).toString("utf8");
        stdout = stdout.subarray(bodyStart + length);
        let frame;
        try {
          frame = JSON.parse(body);
        } catch (error) {
          fail(new Error(`invalid OfficeCLI initialize JSON: ${error instanceof Error ? error.message : String(error)}`));
          return;
        }
        if (frame && frame.id === INITIALIZE_ID) {
          cleanup();
          resolve(frame);
          return;
        }
      }
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--binary" && arg !== "--expected") {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  return { binary: values.get("--binary"), expectedVersion: values.get("--expected") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parsed = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  verifyOfficecliCanvasContract({
    binary: parsed.binary || path.join("build", "officecli", process.platform === "win32" ? "officecli.exe" : "officecli"),
    expectedVersion: parsed.expectedVersion || pkg.officecliVersion,
  })
    .then(() => {
      process.stdout.write("Verified OfficeCLI Canvas Vibe contract.\n");
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
