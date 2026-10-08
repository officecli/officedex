#!/usr/bin/env node
// Compares the hand-written renderer types in src/shared/types.ts with the
// Wails-generated classes in src/renderer/generated/wailsjs/go/models.ts.
//
// The generated file is what Go actually sends; the hand-written file is what
// the renderer believes. When both declare a type of the same name, every
// field the Go side has must exist on the renderer side and vice versa,
// otherwise a field is silently dropped on one end (GenerateInput lacked
// pptxBackend and runtimeMode for months). Optionality is reported but does
// not fail: Wails marks omitempty fields optional, the renderer sometimes does
// not, and neither direction loses data.
//
// Usage: node scripts/verify-bridge-types.mjs [--json]
// Exit 1 when a shared type has a field on one side only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const handWrittenPath = path.join(root, "src/shared/types.ts");
const generatedPath = path.join(root, "src/renderer/generated/wailsjs/go/models.ts");
// Renderer-only names that happen to collide with unrelated Go types.
const ignore = new Set(readIgnoreList());

function readIgnoreList() {
  const file = path.join(root, "scripts/bridge-type-drift-allowlist.json");
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8")).ignoreTypes ?? [];
}

function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function fieldsOf(members) {
  const out = new Map();
  for (const member of members) {
    if (!ts.isPropertySignature(member) && !ts.isPropertyDeclaration(member)) continue;
    if (!member.name || !ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)) continue;
    out.set(member.name.text, { optional: Boolean(member.questionToken) });
  }
  return out;
}

function collectHandWritten(source) {
  const types = new Map();
  ts.forEachChild(source, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name) types.set(node.name.text, fieldsOf(node.members));
  });
  return types;
}

function collectGenerated(source) {
  const types = new Map();
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name) types.set(node.name.text, fieldsOf(node.members));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return types;
}

const hand = collectHandWritten(parse(handWrittenPath));
const generated = collectGenerated(parse(generatedPath));
const shared = [...hand.keys()].filter((name) => generated.has(name) && !ignore.has(name)).sort();

const drift = [];
const notes = [];
for (const name of shared) {
  const left = hand.get(name);
  const right = generated.get(name);
  for (const field of right.keys()) if (!left.has(field)) drift.push({ type: name, field, missingIn: "src/shared/types.ts" });
  for (const field of left.keys()) if (!right.has(field)) drift.push({ type: name, field, missingIn: "generated models.ts (Go)" });
  for (const [field, meta] of left) {
    const other = right.get(field);
    if (other && other.optional !== meta.optional) notes.push({ type: name, field, renderer: meta.optional ? "optional" : "required", go: other.optional ? "optional" : "required" });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ shared: shared.length, drift, optionality: notes }, null, 2));
} else {
  console.log(`${shared.length} types are declared on both sides.`);
  for (const d of drift) console.log(`DRIFT ${d.type}.${d.field} is missing in ${d.missingIn}`);
  if (notes.length) console.log(`${notes.length} optionality differences (informational).`);
}
process.exit(drift.length ? 1 : 0);
