#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { gitIdentity, worktreeRoot } from "./devlib.mjs";

const fileIndex = process.argv.indexOf("--instance-json");
let raw = process.env.OFFICEDEX_DEVCTL_INSTANCE_JSON || "";
if (fileIndex !== -1) {
  const file = process.argv[fileIndex + 1];
  if (!file) throw new Error("--instance-json requires a file path");
  raw = await readFile(file, "utf8");
}
if (!raw.trim()) throw new Error("provide --instance-json <file> or OFFICEDEX_DEVCTL_INSTANCE_JSON");

const expected = JSON.parse(raw);
const currentWorktree = worktreeRoot(process.cwd());
const currentGit = gitIdentity(currentWorktree);
const actual = await fetch(expected.runtime_url).then(async (response) => {
  if (!response.ok) throw new Error(`runtime endpoint returned HTTP ${response.status}`);
  return response.json();
});

const comparisons = {
  instance_id: expected.instance_id,
  worktree: path.resolve(currentWorktree),
  git_revision: currentGit.revision,
  dirty_fingerprint: currentGit.dirty_fingerprint,
};
for (const [key, value] of Object.entries(comparisons)) {
  const actualValue = key === "worktree" ? path.resolve(actual[key]) : actual[key];
  if (actualValue !== value || (expected[key] != null && (key === "worktree" ? path.resolve(expected[key]) : expected[key]) !== value)) {
    throw new Error(`runtime mismatch for ${key}: expected ${value}, instance=${expected[key]}, runtime=${actual[key]}`);
  }
}

console.log(JSON.stringify({ ok: true, instance_id: actual.instance_id, worktree: actual.worktree, git_revision: actual.git_revision, dirty_fingerprint: actual.dirty_fingerprint }));
