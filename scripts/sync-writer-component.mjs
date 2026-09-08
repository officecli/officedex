// Copies the Writer embed artifact (writer's apps/officedex-embed/dist) into
// public/writer, and writes the host manifest WriterEditorFrame checks before
// it mounts the iframe.
//
// The default-font closure is deliberately left behind: it is hundreds of
// megabytes and main.go embeds public/ verbatim through `//go:embed all:dist`.
// scripts/stage-writer-fonts.mjs stages it into build/writer-fonts instead,
// from where bundle-runtime.mjs copies it to Contents/Resources/writer-fonts
// and internal/writerfonts serves it.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must equal WRITER_EMBED_PROTOCOL_VERSION in src/shared/writerProtocol.ts and
// in writer's apps/officedex-embed/src/host-channel.ts.
const PROTOCOL_VERSION = 1;

/** Font payload directory the writer Vite plugin writes into the build. */
export const WRITER_FONT_DIRECTORY = "writer-next-default-fonts";

export async function syncWriterComponent({ distDir, publicDir, sourceRevision }) {
  if (!distDir || !publicDir) {
    throw new Error("distDir and publicDir are required");
  }
  const indexPath = path.join(distDir, "index.html");
  const index = await readFile(indexPath, "utf8");
  if (!/<script\b[^>]*type=["']module["']/i.test(index)) {
    throw new Error(`Writer component index has no module entry: ${indexPath}`);
  }
  await rm(publicDir, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });
  for (const entry of await readdir(distDir)) {
    if (entry === WRITER_FONT_DIRECTORY) continue;
    await cp(path.join(distDir, entry), path.join(publicDir, entry), {
      recursive: true,
      force: true,
      dereference: true,
    });
  }
  await writeFile(
    path.join(publicDir, "officedex-component.json"),
    `${JSON.stringify(
      {
        name: "writer",
        sourceRepository: "shimo/writer",
        protocolVersion: PROTOCOL_VERSION,
        sourceRevision: sourceRevision || "unknown",
      },
      null,
      2,
    )}\n`,
  );
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }
  return {
    distDir: values.get("dist"),
    publicDir: values.get("public"),
    sourceRevision: values.get("source-revision"),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  syncWriterComponent(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
