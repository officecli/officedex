import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyInitializeResult,
  verifyVersionOutput,
} from "./verify-officecli-canvas-contract.mjs";

const validInitializeResult = {
  server_version: "0.2.118",
  capabilities: {
    event_types: ["task.started", "task.vibe_tree", "task.completed"],
  },
  tools: [
    {
      name: "office.generate",
      input_schema: {
        document_type: "pptx|docx|xlsx|report|img|gif",
        mode: "fast|best",
        generation_mode: "plan",
      },
    },
  ],
};

test("accepts the expected OfficeCLI version output", () => {
  assert.doesNotThrow(() => verifyVersionOutput("officecli version 0.2.118 (abc, date)", "0.2.118"));
});

test("rejects a mismatched OfficeCLI version", () => {
  assert.throws(
    () => verifyVersionOutput("officecli version 0.2.117 (abc, date)", "0.2.118"),
    /expected OfficeCLI 0\.2\.118.*0\.2\.117/i,
  );
});

test("accepts the Canvas Vibe initialize contract", () => {
  assert.doesNotThrow(() => verifyInitializeResult(validInitializeResult, "0.2.118"));
});

test("rejects a runtime without task.vibe_tree", () => {
  const result = structuredClone(validInitializeResult);
  result.capabilities.event_types = ["task.started", "task.completed"];
  assert.throws(() => verifyInitializeResult(result, "0.2.118"), /task\.vibe_tree/);
});

test("rejects a runtime without generation_mode", () => {
  const result = structuredClone(validInitializeResult);
  delete result.tools[0].input_schema.generation_mode;
  assert.throws(() => verifyInitializeResult(result, "0.2.118"), /generation_mode/);
});

test("rejects initialize metadata from the wrong runtime version", () => {
  const result = structuredClone(validInitializeResult);
  result.server_version = "0.2.117";
  assert.throws(() => verifyInitializeResult(result, "0.2.118"), /server_version.*0\.2\.117/i);
});
