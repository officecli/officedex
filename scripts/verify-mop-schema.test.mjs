import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readStamps, resolveWasmPackage, schemaMismatches } from "./verify-mop-schema.mjs";

test("reads both stamps from the files the runtime is checked against", () => {
  const stamps = readStamps();
  assert.deepEqual(
    stamps.map((stamp) => stamp.file),
    ["internal/mophttp/capabilities.go", "presentation-component/src/officedex-host-bridge.ts"],
  );
  for (const stamp of stamps) assert.ok(Number.isInteger(stamp.schemaVersion) && stamp.schemaVersion > 0);
  // The two must never drift apart from each other either.
  assert.equal(stamps[0].schemaVersion, stamps[1].schemaVersion);
});

test("names every stamp that disagrees with the runtime", () => {
  const stamps = [
    { file: "a.go", schemaVersion: 1081 },
    { file: "b.ts", schemaVersion: 1097 },
  ];
  assert.deepEqual(schemaMismatches(stamps, 1097), ["a.go stamps schema 1081, runtime reports 1097"]);
  assert.deepEqual(schemaMismatches(stamps.slice(1), 1097), []);
});

test("resolves the engine in the worker's order, not the stale bos snapshot", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "mop-schema-"));
  const make = (...parts) => {
    const directory = path.join(root, ...parts);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "mop_wasm.js"), "");
    writeFileSync(path.join(directory, "mop_wasm_bg.wasm"), "");
    return directory;
  };
  const bos = make("bos", "dist", "mop-wasm", "pkg");
  assert.ok(resolveWasmPackage(root).endsWith(path.join("bos", "dist", "mop-wasm", "pkg")));
  const packages = make("packages", "mop-wasm");
  assert.notEqual(resolveWasmPackage(root), bos);
  assert.ok(resolveWasmPackage(root).endsWith(path.join("packages", "mop-wasm")), packages);
});
