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
 * `writer-sdk` ships zh-CN only. An English shell used to show those Chinese
 * strings (S4-009). The bootstrap now synthesises an `en-US` dictionary from
 * the Chinese keys — chrome tabs get real English names, the rest a readable
 * label — so the iframe can follow `?lang=` from the host. The day writer
 * ships `locales/en-US.json`, `collectWriterLocaleResources` picks it up and
 * the synthesis is skipped.
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
 * dictionary under `zh-CN` is the raw-key bug written a second way. The host
 * iframe URL's `lang` query wins over `navigator.languages`, so the editor
 * follows the app language rather than the operating system's.
 */
export const HOST_RUNTIME_BOOTSTRAP = `
function preferredLocale(available, requested) {
  if (available.includes(requested)) return requested;
  const language = String(requested || "").toLowerCase().split("-")[0];
  const sameLanguage = available.find((locale) => locale.toLowerCase().split("-")[0] === language);
  return sameLanguage || available[0];
}

function requestedLocale() {
  try {
    const search = globalThis.location && globalThis.location.search;
    if (typeof search === "string" && search) {
      const match = /(?:^|[?&])lang=([^&]+)/.exec(search);
      if (match) return decodeURIComponent(match[1].replace(/\\+/g, " "));
    }
  } catch (e) {}
  const languages = globalThis.navigator && globalThis.navigator.languages;
  return (languages && languages[0]) || "en-US";
}

var WRITER_SDK_ENGLISH_CHROME = {
  "toolbar.start": "Home",
  "toolbar.insert": "Insert",
  "toolbar.page": "Layout",
  "toolbar.reference": "References",
  "toolbar.review": "Review",
  "toolbar.view": "View",
  "toolbar.help": "Help",
  "statusbar.page": "Pages",
  "statusbar.section": "Section",
  "statusbar.words": "Words",
  "statusbar.characterProperties": "Character",
};

function humanizeKey(key) {
  const placeholders = key.match(/\\{arg\\d+\\}/g);
  const words = key
    .replace(/\\{arg\\d+\\}/g, "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
  return placeholders && placeholders.length ? words + " " + placeholders.join(" ") : words;
}

function englishFrom(resource) {
  const out = {};
  for (const key of Object.keys(resource)) {
    out[key] = WRITER_SDK_ENGLISH_CHROME[key] || humanizeKey(key);
  }
  return out;
}

function bootstrapWriterI18n(getS18n, resources) {
  if (globalThis.s18n === undefined) globalThis.s18n = { getS18n };
  const requested = requestedLocale();
  let htmlLang = "en-US";
  for (const namespace of Object.keys(resources)) {
    const dictionaries = Object.assign({}, resources[namespace]);
    if (!dictionaries["en-US"] && dictionaries["zh-CN"]) {
      dictionaries["en-US"] = englishFrom(dictionaries["zh-CN"]);
    }
    const locale = preferredLocale(Object.keys(dictionaries), requested);
    const s18n = getS18n(namespace);
    for (const name of Object.keys(dictionaries)) {
      s18n.addLocaleResource(name, dictionaries[name]);
    }
    s18n.setLocale(locale);
    htmlLang = locale;
  }
  if (globalThis.document && globalThis.document.documentElement) {
    globalThis.document.documentElement.lang = htmlLang;
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
