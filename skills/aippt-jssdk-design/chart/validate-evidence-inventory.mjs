#!/usr/bin/env node

import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(SCRIPT_DIR, "..");
const OFFICEDEX_ROOT = path.resolve(SKILL_ROOT, "..", "..");
const REPO_ROOT = path.resolve(OFFICEDEX_ROOT, "..");
const INVENTORY_PATH = path.join(SCRIPT_DIR, "evidence-inventory.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const inventory = JSON.parse(await fs.readFile(INVENTORY_PATH, "utf8"));

assert(inventory.schema_version === 1, "schema_version must be 1");
assert(
  inventory.status === "candidate_sources_only",
  "inventory status must stay candidate_sources_only until chart is admitted",
);
assert(Array.isArray(inventory.recipes), "recipes must be an array");
assert(inventory.recipes.length > 0, "recipes must not be empty");

const seenRecipeIds = new Set();
const missingPaths = [];
let blockedCount = 0;

for (const recipe of inventory.recipes) {
  assert(typeof recipe.recipe_id === "string", "recipe_id is required");
  assert(!seenRecipeIds.has(recipe.recipe_id), `duplicate recipe_id ${recipe.recipe_id}`);
  seenRecipeIds.add(recipe.recipe_id);
  assert(
    recipe.status === "needs_source_evidence",
    `${recipe.recipe_id} must remain needs_source_evidence until admitted`,
  );
  assert(
    recipe.source_kind === "training_fixture",
    `${recipe.recipe_id} source_kind must be training_fixture`,
  );
  assert(
    Array.isArray(recipe.source_paths) && recipe.source_paths.length > 0,
    `${recipe.recipe_id} must list source_paths`,
  );
  assert(
    Array.isArray(recipe.source_digests) &&
      recipe.source_digests.length === recipe.source_paths.length &&
      recipe.source_digests.every((digest) => /^sha256:[0-9a-f]{64}$/u.test(digest)),
    `${recipe.recipe_id} must bind every source_path to a sha256 digest`,
  );
  assert(
    Array.isArray(recipe.missing) && recipe.missing.length > 0,
    `${recipe.recipe_id} must list missing admission checks`,
  );
  if (recipe.reconstruction_program || recipe.verification_report) {
    assert(
      typeof recipe.reconstruction_program === "string" &&
        typeof recipe.verification_report === "string",
      `${recipe.recipe_id} candidate reconstruction must include program and verification_report`,
    );
    assert(
      Number.isFinite(recipe.candidate_raw_ssim),
      `${recipe.recipe_id} candidate reconstruction must include candidate_raw_ssim`,
    );
    for (const candidatePath of [
      recipe.reconstruction_program,
      recipe.verification_report,
    ]) {
      if (!(await exists(path.join(OFFICEDEX_ROOT, candidatePath)))) {
        missingPaths.push(`${recipe.recipe_id}: ${candidatePath}`);
      }
    }
  }
  blockedCount += 1;

  for (const [index, sourcePath] of recipe.source_paths.entries()) {
    const absolutePath = path.join(REPO_ROOT, sourcePath);
    if (!(await exists(absolutePath))) {
      missingPaths.push(`${recipe.recipe_id}: ${sourcePath}`);
      continue;
    }
    const actualDigest = await sha256(absolutePath);
    if (actualDigest !== recipe.source_digests[index]) {
      throw new Error(
        `${recipe.recipe_id}: digest mismatch for ${sourcePath}; expected ${recipe.source_digests[index]}, got ${actualDigest}`,
      );
    }
  }
}

if (missingPaths.length > 0) {
  throw new Error(`Missing chart evidence source paths:\n${missingPaths.join("\n")}`);
}

console.log(
  `chart evidence inventory ok: ${inventory.recipes.length} candidate recipes, ${blockedCount} blocked for formal generation`,
);
