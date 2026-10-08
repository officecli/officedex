// Where the Writer sources and the built Writer embed artifact live.
//
// OfficeDex consumes writer as a build artifact: writer's own
// `pnpm build:officedex-embed` produces apps/officedex-embed/dist, which
// scripts/build-embedded-writer.sh copies into build/writer/dist here. Nothing
// in this repository imports writer source.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * The writer checkout, a sibling of the OfficeDex main worktree. Derived from
 * the git common dir so this resolves the same way from a linked worktree.
 */
export function resolveWriterSource(explicit = process.env.WRITER_SOURCE_DIR) {
  const configured = String(explicit || "").trim();
  if (configured) return path.resolve(configured);
  const gitCommonDirectory = execFileSync(
    "git",
    ["-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  return path.resolve(path.dirname(gitCommonDirectory), "..", "writer");
}

/** The Writer embed build this repository consumes. */
export function resolveWriterEmbedDist(explicit = process.env.WRITER_DIST_DIR) {
  const configured = String(explicit || "").trim();
  if (configured) return path.resolve(configured);
  return path.join(ROOT, "build", "writer", "dist");
}

/** The staged default-font closure, served in dev and bundled for release. */
export function resolveWriterFontsDir(explicit = process.env.OFFICEDEX_WRITER_FONTS_DIR) {
  const configured = String(explicit || "").trim();
  if (configured) return path.resolve(configured);
  return path.join(ROOT, "build", "writer-fonts");
}

/**
 * The word2mow `convert` binary. Staged by
 * scripts/prefetch-word2mow-convert.mjs; the Go side reads the same env var.
 */
export function resolveWord2MowConvert(explicit = process.env.OFFICEDEX_WORD2MOW_CONVERT_BIN) {
  const configured = String(explicit || "").trim();
  if (configured) return path.resolve(configured);
  const name = process.platform === "win32" ? "convert.exe" : "convert";
  const staged = path.join(ROOT, "build", "writer-convert", name);
  return existsSync(staged) ? staged : "";
}
