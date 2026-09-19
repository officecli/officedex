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

/** Emitted next to index.html and loaded before the module entry. */
export const HOST_RUNTIME_FILE = "host-runtime.js";

/**
 * Where each namespace Writer translates through keeps its dictionaries,
 * relative to the writer checkout.
 *
 * Writer's own note leaves no room for interpretation — `writer-i18n.ts` says
 * "该模块不加载资源、不选择 locale、不订阅状态，也不调用 setLocale". Every one
 * of those four is the host's job, and the host was doing none of them: the
 * runtime below went in, Writer stopped throwing, and it came up rendering
 * `toolbar.start`, `statusbar.words 0` and `ribbon.workspace.edit` at the user.
 *
 * `writer-sdk` ships zh-CN only. That is not a bug here to fix: there is no
 * English dictionary in the writer repository at all, so an English build shows
 * Chinese Writer strings inside an otherwise-English shell. Raw dotted keys are
 * the worse of the two, and this stops being a question the day writer ships
 * `locales/en-US.json` — `localeResourcesFor` will pick it up with no change
 * here.
 */
const LOCALE_SOURCES = [
  { namespace: "writer-sdk", directory: "packages/writer-next-ui-react/locales" },
  {
    namespace: "suite-components-toolbar-kit",
    directory: "packages/writer-next-ui-react/node_modules/@shimo/suite-components-toolbar-kit/dist/locales",
  },
];

/** Dictionary files that are tooling, not translations. */
const NON_LOCALE_FILES = new Set(["duplicate-key-exceptions.json"]);

/**
 * Reads every dictionary each namespace ships, keyed by locale.
 *
 * A namespace whose directory is missing is reported rather than skipped: a
 * writer build that moved its locales would otherwise sync cleanly and ship the
 * raw keys again, which is precisely the failure this exists to end.
 */
export async function collectWriterLocaleResources(sourceDir) {
  const resources = {};
  for (const { namespace, directory } of LOCALE_SOURCES) {
    const from = path.join(sourceDir, directory);
    let entries;
    try {
      entries = await readdir(from);
    } catch {
      throw new Error(`Writer locale directory is missing: ${from}`);
    }
    const dictionaries = {};
    for (const entry of entries) {
      if (!entry.endsWith(".json") || NON_LOCALE_FILES.has(entry)) continue;
      dictionaries[entry.slice(0, -".json".length)] = JSON.parse(
        await readFile(path.join(from, entry), "utf8"),
      );
    }
    if (Object.keys(dictionaries).length === 0) {
      throw new Error(`Writer locale directory has no dictionaries: ${from}`);
    }
    resources[namespace] = dictionaries;
  }
  return resources;
}

/**
 * Builds the host runtime Writer requires before its module evaluates.
 *
 * `writer-next-ui-react/src/i18n/writer-i18n.ts` reads `globalThis.s18n` at
 * module scope and throws "Writer i18n requires Host-provided globalThis.s18n
 * before module evaluation" when it is missing. Writer's own note is explicit
 * that it will not create one: "生产 Host 需要由自己的启动链路提供同样的
 * runtime；Writer SDK 不会替 Host 创建它."
 *
 * OfficeDex is that production host and never provided it, so every .docx
 * opened to an empty frame — the embed threw inside its own module graph, which
 * is a place no host callback can see. Nothing appeared on screen, in a console
 * the user could reach, or in the log.
 *
 * It is the real `@shimo/simple-i18n` runtime, bundled here rather than
 * hand-written: a stand-in with the same shape gets Writer past the throw and
 * then renders a toolbar of raw keys, because the translations register against
 * this runtime's actual API. Half a fix looks enough like a whole one to be
 * worse than none — which is why the dictionaries are inlined here too, rather
 * than fetched. The runtime has to exist before the first module evaluates, and
 * nothing asynchronous can be relied on to have finished by then.
 *
 * Bundled as a classic script on purpose. Module scripts are deferred as a
 * group, so anything that must exist *before* the first module evaluates cannot
 * itself be one.
 */
async function buildHostRuntime(outFile, resources) {
  const esbuild = await import("esbuild");
  await esbuild.build({
    stdin: {
      contents: `import { getS18n } from "@shimo/simple-i18n";
${HOST_RUNTIME_BOOTSTRAP}
bootstrapWriterI18n(getS18n, ${JSON.stringify(resources)});`,
      resolveDir: path.dirname(fileURLToPath(import.meta.url)),
      loader: "ts",
    },
    outfile: outFile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    legalComments: "none",
  });
}

/**
 * The bootstrap, as source, so the test can run it against a fake runtime.
 *
 * `setLocale` is called with the locale the dictionary was actually chosen for,
 * not with the browser's: the runtime defaults each namespace to
 * `navigator.languages[0]`, and leaving it there while registering a zh-CN
 * dictionary under `zh-CN` is the raw-key bug written a second way.
 */
export const HOST_RUNTIME_BOOTSTRAP = `
function preferredLocale(available, requested) {
  if (available.includes(requested)) return requested;
  const language = requested.toLowerCase().split("-")[0];
  const sameLanguage = available.find((locale) => locale.toLowerCase().split("-")[0] === language);
  return sameLanguage || available[0];
}

function bootstrapWriterI18n(getS18n, resources) {
  if (globalThis.s18n === undefined) globalThis.s18n = { getS18n };
  const requested = (globalThis.navigator && globalThis.navigator.languages || [])[0] || "en-US";
  for (const namespace of Object.keys(resources)) {
    const dictionaries = resources[namespace];
    const locale = preferredLocale(Object.keys(dictionaries), requested);
    const s18n = getS18n(namespace);
    s18n.addLocaleResource(locale, dictionaries[locale]);
    s18n.setLocale(locale);
  }
}
`;


/**
 * Puts the host runtime ahead of the first module script.
 *
 * Asserted rather than assumed: a Writer build that stopped shipping a module
 * entry would otherwise produce a page with a bootstrap and nothing to bootstrap.
 */
export function injectHostRuntime(html) {
  if (html.includes(HOST_RUNTIME_FILE)) return html;
  const moduleTag = /<script\b[^>]*type=["']module["'][^>]*>/i.exec(html);
  if (!moduleTag) throw new Error("Writer component index has no module entry to bootstrap");
  const at = moduleTag.index;
  return `${html.slice(0, at)}<script src="./${HOST_RUNTIME_FILE}"></script>\n    ${html.slice(at)}`;
}

export async function syncWriterComponent({ distDir, publicDir, sourceDir, sourceRevision }) {
  if (!distDir || !publicDir || !sourceDir) {
    throw new Error("distDir, publicDir and sourceDir are required");
  }
  const indexPath = path.join(distDir, "index.html");
  const index = await readFile(indexPath, "utf8");
  if (!/<script\b[^>]*type=["']module["']/i.test(index)) {
    throw new Error(`Writer component index has no module entry: ${indexPath}`);
  }
  // Read before anything is removed: a writer checkout that moved its locales
  // should fail with the previous sync still on disk, not with a half-built one.
  const resources = await collectWriterLocaleResources(sourceDir);
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
  // The copy above brought the build's own index.html; this is the one change
  // the host makes to it.
  await buildHostRuntime(path.join(publicDir, HOST_RUNTIME_FILE), resources);
  await writeFile(path.join(publicDir, "index.html"), injectHostRuntime(index));
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
    sourceDir: values.get("source"),
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
