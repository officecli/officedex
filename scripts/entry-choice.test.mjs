import assert from "node:assert/strict";
import test from "node:test";

import { resolveEntryChoice } from "./entry-choice.mjs";

/**
 * Worth a test because the failure mode is silent and expensive: a misspelled
 * flag used to produce a shell build while the person who typed it believed
 * they were holding the previous interface.
 */

test("defaults to the shell", () => {
  assert.equal(resolveEntryChoice(undefined), "shell");
  assert.equal(resolveEntryChoice(""), "shell");
  assert.equal(resolveEntryChoice("   "), "shell");
});

test("accepts both interfaces by name", () => {
  assert.equal(resolveEntryChoice("shell"), "shell");
  assert.equal(resolveEntryChoice("legacy"), "legacy");
  // Surrounding whitespace is a shell-quoting accident, not a typo.
  assert.equal(resolveEntryChoice(" legacy "), "legacy");
});

test("refuses a near miss rather than guessing", () => {
  // Each of these used to mean "shell", quietly.
  for (const value of ["Legacy", "LEGACY", "legcy", "old", "renderer", "true", "1"]) {
    assert.throws(() => resolveEntryChoice(value), /OFFICEDEX_ENTRY/, `accepted ${value}`);
  }
});

test("names both choices in the error, so the fix is in the message", () => {
  assert.throws(() => resolveEntryChoice("legcy"), /shell \| legacy/);
});
