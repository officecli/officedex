#!/usr/bin/env node
// Stage the Writer default-font closure into build/writer-fonts so
// bundle-runtime.mjs can copy it into Contents/Resources/writer-fonts.
//
// The closure is hundreds of megabytes. main.go embeds dist/ verbatim with
// `//go:embed all:dist`, so it must never travel through public/writer into
// the Go binary; internal/writerfonts serves it from Resources at runtime and
// the Vite dev server serves it from here.
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WRITER_FONT_DIRECTORY } from "./sync-writer-component.mjs";
import { resolveWriterEmbedDist } from "./writer-source.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEFAULT_DEST = path.join(ROOT, "build", "writer-fonts");

/** The three delivery roots writerNextDefaultFontsPlugin writes. */
export const WRITER_FONT_ROOTS = Object.freeze(["prebuilt", "files", "draw"]);

export async function stageWriterFonts({ distDir, dest = DEFAULT_DEST } = {}) {
  const source = path.join(distDir || resolveWriterEmbedDist(), WRITER_FONT_DIRECTORY);
  if (!existsSync(source)) {
    throw new Error(
      `Writer default-font closure not found: ${source}; run \`npm run build:writer\` first`,
    );
  }
  const missing = WRITER_FONT_ROOTS.filter((name) => !existsSync(path.join(source, name)));
  if (missing.length > 0) {
    throw new Error(
      `Writer default-font closure is incomplete at ${source}; missing ${missing.join(", ")}`,
    );
  }

  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  for (const name of WRITER_FONT_ROOTS) {
    await cp(path.join(source, name), path.join(dest, name), {
      recursive: true,
      force: true,
      dereference: true,
    });
  }

  const files = await countFiles(dest);
  await writeFile(
    path.join(dest, "writer-fonts.json"),
    `${JSON.stringify({ name: "writer-next-default-fonts", source, ...files }, null, 2)}\n`,
  );
  return { source, dest, ...files };
}

async function countFiles(root) {
  let files = 0;
  let bytes = 0;
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(full)).size;
      }
    }
  };
  await walk(root);
  return { files, bytes };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  stageWriterFonts()
    .then(({ source, dest, files, bytes }) =>
      console.log(
        `[stage-writer-fonts] ${source} -> ${dest} (${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB)`,
      ),
    )
    .catch((error) => {
      console.error(`[stage-writer-fonts] ${error.message}`);
      process.exit(1);
    });
}
