import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HOST_RUNTIME_BOOTSTRAP,
  HOST_RUNTIME_FILE,
  collectWriterLocaleResources,
  injectHostRuntime,
} from "./sync-writer-component.mjs";

/**
 * Writer will not start without a host-provided i18n runtime.
 *
 * `writer-next-ui-react` reads `globalThis.s18n` at module scope and throws
 * when it is missing — and Writer's own note says it will not create one:
 * "生产 Host 需要由自己的启动链路提供同样的 runtime；Writer SDK 不会替 Host
 * 创建它." OfficeDex is that host and never did, so every .docx opened to an
 * empty frame with no error anywhere: the throw happens inside the embed's own
 * module graph, where no host callback can see it.
 *
 * Two properties matter and neither is obvious from reading the output:
 * the runtime has to be a *classic* script (module scripts are deferred as a
 * group, so one cannot run before another evaluates), and it has to come
 * *before* the module entry in document order.
 */

const MODULE_ENTRY = '<script type="module" crossorigin src="./assets/index-abc.js"></script>';
const PAGE = `<!doctype html>
<html>
  <head>
    <title>Writer</title>
    ${MODULE_ENTRY}
  </head>
  <body><div id="root"></div></body>
</html>
`;

test("puts the host runtime before the module entry", () => {
  const html = injectHostRuntime(PAGE);
  const runtimeAt = html.indexOf(HOST_RUNTIME_FILE);
  const moduleAt = html.indexOf('type="module"');
  assert.ok(runtimeAt > -1, "host runtime is not referenced");
  assert.ok(runtimeAt < moduleAt, "host runtime must load before the module entry");
});

test("loads it as a classic script", () => {
  const html = injectHostRuntime(PAGE);
  const tag = html.slice(html.indexOf(`<script src="./${HOST_RUNTIME_FILE}"`));
  const opening = tag.slice(0, tag.indexOf(">") + 1);
  assert.ok(!opening.includes("type=\"module\""), `host runtime must not be a module: ${opening}`);
  assert.ok(!opening.includes("defer"), `host runtime must not be deferred: ${opening}`);
});

test("is idempotent, so a re-sync does not stack bootstraps", () => {
  const once = injectHostRuntime(PAGE);
  assert.equal(injectHostRuntime(once), once);
});

// A Writer build that stopped shipping a module entry would otherwise produce a
// page with a bootstrap and nothing to bootstrap.
test("refuses a page with no module entry", () => {
  assert.throws(
    () => injectHostRuntime("<!doctype html><html><head></head><body></body></html>"),
    /no module entry/,
  );
});

/**
 * The other half: a runtime with no dictionaries in it.
 *
 * Providing `globalThis.s18n` gets Writer past the throw and no further —
 * Writer's own i18n module says it "不加载资源、不选择 locale ... 也不调用
 * setLocale", so a host that only installs the runtime renders a toolbar of
 * `toolbar.start` and `statusbar.words 0`. These tests run the bootstrap
 * against a stand-in runtime, which is the only way to check what it does with
 * a locale the dictionaries do not have.
 */

function runBootstrap(resources, languages, search) {
  const namespaces = new Map();
  const getS18n = (namespace) => {
    if (!namespaces.has(namespace)) {
      namespaces.set(namespace, {
        locale: null,
        registered: {},
        addLocaleResource(locale, resource) {
          this.registered[locale] = resource;
        },
        setLocale(locale) {
          this.locale = locale;
        },
      });
    }
    return namespaces.get(namespace);
  };
  const documentElement = { lang: "en" };
  const scope = {
    navigator: { languages },
    location: search === undefined ? undefined : { search },
    document: { documentElement },
  };
  // eslint-disable-next-line no-new-func -- the bootstrap ships as source so it can be exercised here.
  new Function(
    "globalThis",
    "getS18n",
    "resources",
    `${HOST_RUNTIME_BOOTSTRAP}\nbootstrapWriterI18n(getS18n, resources);`,
  )(scope, getS18n, resources);
  return { namespaces, scope };
}

const RESOURCES = {
  "writer-sdk": { "zh-CN": { "toolbar.start": "开始" } },
  "suite-components-toolbar-kit": {
    "zh-CN": { undo: "撤销" },
    "en-US": { undo: "Undo" },
  },
};

test("installs the runtime Writer reads at module scope", () => {
  const { scope } = runBootstrap(RESOURCES, ["zh-CN"]);
  assert.equal(typeof scope.s18n?.getS18n, "function");
});

test("registers each namespace's dictionary and selects that same locale", () => {
  const { namespaces } = runBootstrap(RESOURCES, ["zh-CN"]);
  for (const namespace of Object.keys(RESOURCES)) {
    const s18n = namespaces.get(namespace);
    assert.equal(s18n.locale, "zh-CN", namespace);
    assert.deepEqual(s18n.registered["zh-CN"], RESOURCES[namespace]["zh-CN"], namespace);
  }
});

// The failure this whole file exists for: the runtime defaults every namespace
// to navigator.languages[0], so registering zh-CN under "zh-CN" and leaving the
// locale at en-US produces exactly the raw keys it was meant to fix.
test("falls back to a dictionary that exists rather than leaving the locale empty", () => {
  const { namespaces } = runBootstrap(RESOURCES, ["en-US"]);
  assert.equal(namespaces.get("suite-components-toolbar-kit").locale, "en-US");
  const writer = namespaces.get("writer-sdk");
  assert.equal(writer.locale, "en-US", "writer-sdk synthesises en-US from zh-CN");
  assert.equal(writer.registered["en-US"]["toolbar.start"], "Home");
  assert.deepEqual(writer.registered["zh-CN"], RESOURCES["writer-sdk"]["zh-CN"]);
});

test("follows the host iframe lang query rather than the operating system", () => {
  const { namespaces, scope } = runBootstrap(RESOURCES, ["en-US"], "?mode=embed&lang=zh-CN");
  assert.equal(namespaces.get("writer-sdk").locale, "zh-CN");
  assert.equal(namespaces.get("suite-components-toolbar-kit").locale, "zh-CN");
  assert.equal(scope.document.documentElement.lang, "zh-CN");
});

test("names the ribbon tabs in English when the host asks for English", () => {
  const { namespaces, scope } = runBootstrap(RESOURCES, ["zh-CN"], "?lang=en-US");
  assert.equal(namespaces.get("writer-sdk").locale, "en-US");
  assert.equal(namespaces.get("writer-sdk").registered["en-US"]["toolbar.start"], "Home");
  assert.equal(namespaces.get("suite-components-toolbar-kit").locale, "en-US");
  assert.equal(scope.document.documentElement.lang, "en-US");
});

test("matches on language when the exact region is not shipped", () => {
  const { namespaces } = runBootstrap(RESOURCES, ["zh-TW"]);
  assert.equal(namespaces.get("suite-components-toolbar-kit").locale, "zh-CN");
});

test("survives a runtime with no navigator", () => {
  const { namespaces } = runBootstrap(RESOURCES, undefined);
  assert.equal(namespaces.get("suite-components-toolbar-kit").locale, "en-US");
});

test("reports a writer checkout whose locales moved instead of syncing without them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-locales-"));
  await assert.rejects(() => collectWriterLocaleResources(root), /locale directory is missing/);

  await mkdir(path.join(root, "packages/writer-next-ui-react/locales"), { recursive: true });
  await assert.rejects(() => collectWriterLocaleResources(root), /no dictionaries/);
});

test("reads dictionaries by locale and ignores the tooling files beside them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-locales-"));
  const writer = path.join(root, "packages/writer-next-ui-react/locales");
  const kit = path.join(
    root,
    "packages/writer-next-ui-react/node_modules/@shimo/suite-components-toolbar-kit/dist/locales",
  );
  await mkdir(writer, { recursive: true });
  await mkdir(kit, { recursive: true });
  await writeFile(path.join(writer, "zh-CN.json"), JSON.stringify({ "toolbar.start": "开始" }));
  await writeFile(path.join(writer, "duplicate-key-exceptions.json"), JSON.stringify(["x"]));
  await writeFile(path.join(kit, "en-US.json"), JSON.stringify({ undo: "Undo" }));

  const resources = await collectWriterLocaleResources(root);
  assert.deepEqual(Object.keys(resources["writer-sdk"]), ["zh-CN"]);
  assert.deepEqual(resources["suite-components-toolbar-kit"], { "en-US": { undo: "Undo" } });
});
