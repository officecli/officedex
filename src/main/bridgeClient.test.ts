import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AgentBridgeClient, bridgeResultToArtifact, buildBridgeEnv } from "./bridgeClient";

function encodeFramedMessage(message: unknown): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function decodeFramedMessage(raw: string): any {
  const separator = raw.indexOf("\r\n\r\n");
  expect(separator).toBeGreaterThan(0);
  const header = raw.slice(0, separator);
  const body = raw.slice(separator + 4);
  expect(header).toMatch(/^Content-Length: \d+$/);
  expect(Number(header.replace("Content-Length: ", ""))).toBe(Buffer.byteLength(body, "utf8"));
  return JSON.parse(body);
}

function createFakeTransport() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writes: string[] = [];

  stdin.on("data", (chunk) => {
    writes.push(String(chunk));
  });

  return {
    transport: {
      stdin,
      stdout,
      stderr,
      kill: () => undefined,
      onExit: () => undefined,
    },
    writes,
    send(message: unknown) {
      stdout.write(encodeFramedMessage(message));
    },
  };
}

describe("AgentBridgeClient", () => {
  it("sends framed JSON-RPC requests and resolves framed responses", async () => {
    const fake = createFakeTransport();
    const client = new AgentBridgeClient({ createTransport: () => fake.transport });

    await client.start();
    const pending = client.initialize();

    const request = decodeFramedMessage(fake.writes[0]);
    expect(request.method).toBe("initialize");
    expect(request.jsonrpc).toBe("2.0");

    fake.send({
      jsonrpc: "2.0",
      id: request.id,
      result: { server_name: "officecli-agent-bridge", capabilities: { methods: [] } },
    });

    await expect(pending).resolves.toMatchObject({ server_name: "officecli-agent-bridge" });
  });

  it("rejects requests that exceed the bridge timeout", async () => {
    const fake = createFakeTransport();
    const client = new AgentBridgeClient({ createTransport: () => fake.transport, requestTimeoutMs: 10 });

    await client.start();

    await expect(client.initialize()).rejects.toThrow("officecli bridge request timed out");
  });

  it("emits bridge task notifications from stdout", async () => {
    const fake = createFakeTransport();
    const client = new AgentBridgeClient({ createTransport: () => fake.transport });
    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));

    await client.start();
    fake.send({
      jsonrpc: "2.0",
      method: "task.progress",
      params: {
        event_id: "event-1",
        task_id: "task-1",
        type: "task.progress",
        payload: { message: "Rendering slides" },
      },
    });

    expect(events).toEqual([
      {
        event_id: "event-1",
        task_id: "task-1",
        type: "task.progress",
        payload: { message: "Rendering slides" },
      },
    ]);
  });

  it("sets desktop-safe bridge environment defaults", () => {
    expect(buildBridgeEnv({})).toMatchObject({
      OFFICECLI_SKIP_SKILL_PREFLIGHT: "1",
      OFFICECLI_SKIP_PUBLISH_SETUP: "1",
      OFFICECLI_SKIP_UPDATE_CHECK: "1",
    });
  });
});

describe("bridgeResultToArtifact", () => {
  it("extracts a local artifact from an office.generate result", () => {
    expect(
      bridgeResultToArtifact({
        file_path: "/tmp/Q3 Review.pptx",
        file_name: "Q3 Review.pptx",
        document_type: "pptx",
        access_url: "https://platform.officecli.io/p/share",
      }),
    ).toEqual({
      filePath: "/tmp/Q3 Review.pptx",
      fileName: "Q3 Review.pptx",
      documentType: "pptx",
      previewUrl: "https://platform.officecli.io/p/share",
    });
  });

  it("returns null when a result does not contain a file path", () => {
    expect(bridgeResultToArtifact({ status: "started" })).toBeNull();
  });
});
