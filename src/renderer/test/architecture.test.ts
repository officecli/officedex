/**
 * Architecture gates.
 *
 * These are the invariants the P0–P4 refactor established. They are asserted
 * here rather than in a linter because this project's `lint` script is `tsc`
 * and nothing else — there is no ESLint config to hang a rule off. A test is
 * also a better place for it: each gate can say why it exists.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = "src/renderer";

function sourceFiles(directory: string, { includeTests = false } = {}): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      out.push(...sourceFiles(path, { includeTests }));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (!includeTests && /\.test\.tsx?$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("architecture", () => {
  const production = sourceFiles(RENDERER);

  // The desktop handle is injected. `bridge.ts` still exports the singleton —
  // it is what `services/desktopApi` uses as the provider's default value, so a
  // subtree without a provider behaves as it always did, and so the 35 tests
  // that mock the bridge module keep working. What must not come back is a
  // component or hook reaching for it directly: a view that grabs a global
  // cannot be rendered anywhere that global is wrong, which in practice means
  // it can only be rendered in this app, in this shape.
  it("no production code imports the bridge singleton", () => {
    const offenders = production
      .filter((path) => path !== join(RENDERER, "services", "desktopApi.tsx"))
      .filter((path) => !path.startsWith(join(RENDERER, "bridge")))
      .filter((path) => /import\s*\{[^}]*\bofficecli\b[^}]*\}\s*from/.test(read(path)));

    expect(offenders).toEqual([]);
  });

  // Controllers hold a domain's state and intents. They may read the store, the
  // injected api and each other; they may not reach into a view. A controller
  // that imports a screen cannot be reused behind a different one, which is the
  // whole reason they were extracted.
  it("controllers do not import screens or components", () => {
    const controllers = sourceFiles(join(RENDERER, "controllers"));
    const offenders = controllers.filter((path) => {
      const source = read(path);
      return /from\s+"\.\.\/screens\//.test(source)
        || /from\s+"\.\.\/components\//.test(source)
        || /from\s+"\.\.\/workbench\//.test(source);
    });

    expect(offenders).toEqual([]);
  });

  // The store is the task truth and the projection over it. Anything that
  // reduces events belongs in taskState.ts, which is pure and separately
  // tested; the store deliberately has no actions of its own.
  it("the store holds no business logic", () => {
    const store = read(join(RENDERER, "store", "taskStore.tsx"));
    expect(store).not.toMatch(/switch\s*\(/);
    expect(store).not.toContain("applyTaskEvent");
  });

  // The projection exists to be consumed. It spent four months written, tested
  // and called by nothing because its only possible call site was inside the
  // root component; if that happens again this goes red.
  it("the document projection has a production consumer", () => {
    const consumers = production.filter((path) =>
      path !== join(RENDERER, "documentModel.ts")
      && /projectTaskStateToDocuments|useDocumentProjection/.test(read(path)));

    expect(consumers.length).toBeGreaterThan(0);
  });
});
