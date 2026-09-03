import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONT_EXTENSIONS = new Set([".woff", ".woff2", ".ttf", ".otf"]);
const here = path.dirname(fileURLToPath(import.meta.url));
const allowlistPath = path.join(here, "bundled-font-allowlist.json");

/** Strip Vite's content hash and the weight/style suffix to get the family. */
export function fontFamilyOf(fileName) {
  const base = fileName.replace(/\.(woff2?|ttf|otf)$/i, "");
  const withoutHash = base.replace(/-[A-Za-z0-9_-]{8,}$/, "");
  const family = withoutHash.split(/[-_]/)[0];
  return family.toLowerCase();
}

async function collectFonts(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(full);
        continue;
      }
      if (FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(full);
    }
  }
  await walk(root);
  return found.sort();
}

export async function verifyBundledFonts(roots) {
  const allowlist = JSON.parse(await readFile(allowlistPath, "utf8"));
  const allowed = new Set(Object.keys(allowlist.families).map((name) => name.toLowerCase()));
  // Families known to be in the bundle whose redistribution basis is not
  // recorded in this repository. They do not fail the build, because they were
  // already shipping, but they are reported every run so the list gets shorter
  // rather than forgotten. Anything outside both sets is new and fails.
  const unresolved = new Set(Object.keys(allowlist.unresolved ?? {}).map((name) => name.toLowerCase()));
  const denied = Object.entries(allowlist.denied ?? {});

  const problems = [];
  const pending = new Set();
  let checked = 0;
  for (const root of roots) {
    for (const file of await collectFonts(root)) {
      checked += 1;
      const name = path.basename(file).toLowerCase();
      const deniedMatch = denied.find(([marker]) => name.includes(marker.toLowerCase()));
      if (deniedMatch) {
        problems.push(`${file}: ${deniedMatch[1]}`);
        continue;
      }
      const family = fontFamilyOf(path.basename(file));
      if (allowed.has(family)) continue;
      if (unresolved.has(family)) {
        pending.add(family);
        continue;
      }
      problems.push(`${file}: family "${family}" is not in scripts/bundled-font-allowlist.json`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Fonts without a redistribution licence are in the bundle:\n  ${problems.join("\n  ")}`);
  }
  return { checked, pending: [...pending].sort() };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) roots.push(path.join(here, "..", "dist"), path.join(here, "..", "public"), path.join(here, "..", "build", "presentation"));
  const existing = [];
  for (const root of roots) {
    try {
      await stat(root);
      existing.push(root);
    } catch {
      // A root that was never built is not a licence problem.
    }
  }
  const { checked, pending } = await verifyBundledFonts(existing);
  console.log(`verify-bundled-fonts: ${checked} font file(s) cleared across ${existing.length} root(s)`);
  if (pending.length > 0) {
    console.log(`verify-bundled-fonts: provenance still unrecorded for ${pending.join(", ")}`);
  }
}
