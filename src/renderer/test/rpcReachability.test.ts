/**
 * Reachability contract for the desktop RPC surface.
 *
 * `DesktopAPI` is the whole of what the renderer can ask the desktop to do, and
 * it is the one part of this app an IA change must not touch. So it doubles as
 * the definition of "the features are still there": every method has to keep a
 * call site somewhere a user can reach.
 *
 * This is a static analysis, not a click-through. Walking the real UI to prove
 * runtime reachability would need a fixture per surface and would still miss
 * the ones behind a connector or an error state; what actually goes wrong in a
 * refactor is simpler than that — a call site gets dropped along with the
 * component that held it, and nothing notices. A name that appears nowhere in
 * the renderer is that bug, and this test is the thing that notices.
 *
 * When a method legitimately has no renderer call site, add it to UNWIRED with
 * the reason. Growing that list is a decision, which is the point of making it
 * explicit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where a call site can live. The renderer is the old UI; services is the layer
 * that implements UiPort for the new one. Scanning only the first would report
 * every RPC the new services consume as unreachable.
 */
const CALL_SITE_ROOTS = ["src/renderer", "src/services"];

/**
 * Methods with no renderer call site today, and what was found when each was
 * checked. This is a survey of the state this test was written in, not a
 * blessing: every line here is a desktop capability the UI cannot reach.
 *
 * Removing a line (by wiring the method up) is always fine. Adding one means
 * some feature just became unreachable — say so out loud before you do.
 *
 * Not the same thing as PENDING_CONSUMER below.
 */
const UNWIRED: Record<string, string> = {
  // The workbook→output lineage store is half-wired: App.tsx records a view
  // (saveOfficeProductView) and Home lists outputs (listOfficeProductOutputs).
  // The project, source, view-listing and refresh-plan halves have Go
  // implementations and no UI at all.
  saveOfficeProductProject: "Go side implemented; no UI writes a product project",
  listOfficeProductSources: "Go side implemented; no UI lists workbook sources",
  listOfficeProductViews: "Go side implemented; no UI lists workbook views",
  saveOfficeProductRefreshPlan: "Go side implemented; refresh plans are never persisted from the UI",
  listOfficeProductRefreshPlans: "Go side implemented; no UI reads refresh plans",

  // Its only caller would have been ArtifactStageShell, which nothing ever
  // mounted and which has now been deleted. The RPC is implemented on the Go
  // side and has no caller at all.
  artifactStageEdit: "Go side implemented; the shell that would have called it has been deleted",

  // Server-side image prompt templates. The renderer has a localStorage
  // implementation of the same idea in localImageTemplates.ts — which is itself
  // unconsumed, so neither the local nor the remote catalogue is on screen.
  listImageTemplates: "Go side implemented; no UI lists prompt templates",
  createImageTemplate: "Go side implemented; no UI creates one",
  createImageTemplatePublishRequest: "Go side implemented; no UI publishes one",

  copyImageToClipboard: "Go side implemented; the image viewer offers no copy action",
  setPreviewMode: "Go side implemented; nothing toggles preview mode from the renderer",
  // useAppUpdate drives the whole update flow from checkAppUpdate and the event
  // stream, so the status getter has no caller.
  getAppUpdateStatus: "Go side implemented; useAppUpdate reads status from checkAppUpdate and onAppUpdateEvent instead",

  // Declared on the renderer interface and wired through every transport, but
  // there is no ComposeCampaignImage on the Go side: all three transports would
  // throw. Unreachable at both ends.
  composeCampaignImage: "no Go implementation; every transport throws 'requires a newer OfficeDex runtime'",

  // Found when isCalled() started matching the handle instead of the bare
  // method name: the old pattern counted the local variable `previewArtifact`
  // in App.tsx as a call site. The RPC opens a preview window of its own and
  // nothing asks for it — every path goes through issuePreviewToken and renders
  // in-app instead.
  previewArtifact: "Go side implemented; every preview path uses issuePreviewToken and renders in-app",
};

/**
 * Landed, with its consumer scheduled — a construction state, not a dead end.
 *
 * The difference from UNWIRED matters. An unreachable capability is a defect;
 * a capability whose caller arrives next week is ordinary work in progress.
 * Collapsing the two would either hide real regressions in a growing exception
 * list, or make every half-finished feature look like one.
 *
 * Each entry names the step that will consume it. When that step lands the
 * entry goes away on its own — the method gets a call site and stops needing
 * an exception at all.
 */
const PENDING_CONSUMER: Record<string, string> = {
  // The agent service reduces live bridge events and task history rather than
  // reading the stored activity stream, so these two are still unconsumed. They
  // are what an activity/history view would read.
  listDocumentRuns: "no consumer yet · a run history view would read it",
  listDocumentActivities: "no consumer yet · an activity view would read it",
  // MoveDocument resolves the destination folder itself, so the service never
  // needs the path.
  folderPath: "no consumer yet · MoveDocument resolves the folder on the Go side",
};

/**
 * Whether a method is called on the desktop handle somewhere in `source`.
 *
 * The handle is matched by name, not just the method: an early version looked
 * for `.<method>` anywhere and reported `getDocument` as wired because
 * `PdfViewer` calls `pdfjsLib.getDocument`. Bare method names are not unique
 * enough — and the failure mode is the dangerous direction, a genuinely
 * unreachable RPC hidden by an unrelated library that happens to share a name.
 *
 * So this depends on a convention: **the injected `DesktopAPI` is always bound
 * to `api`, `officecli` or `desktop`.** If that ever stops being true, this
 * test starts reporting live methods as unreachable — loudly, which is the
 * right direction to fail in.
 */
function isCalled(method: string, source: string): boolean {
  return new RegExp(`\\b(?:api|officecli|desktop)\\??\\s*\\.\\s*${method}\\b`).test(source);
}

/** Extracts the member names of one interface body from a .ts source. */
function interfaceMembers(source: string, name: string): string[] {
  const header = new RegExp(`export interface ${name}(?:\\s+extends\\s+[^{]+)?\\s*{`);
  const start = source.search(header);
  if (start < 0) throw new Error(`interface ${name} not found`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(bodyStart + 1, end);
  const names = new Set<string>();
  // Members are declared either as `name(args): T` or `name: (args) => T`, in
  // both cases optionally `?`. Only top-level ones count: nested object types
  // in a signature are indented further and are not part of this surface.
  for (const line of body.split("\n")) {
    const match = /^ {2}(\w+)\??\s*[(:]/.exec(line);
    if (match) names.add(match[1]);
  }
  return [...names];
}

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      // `generated/` is the Wails binding output, not a call site a user reaches.
      if (entry === "generated" || entry === "node_modules") continue;
      out.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

describe("DesktopAPI reachability", () => {
  const types = readFileSync("src/shared/types.ts", "utf8");
  const verticals = readFileSync("src/shared/verticals.ts", "utf8");
  const methods = [
    ...interfaceMembers(types, "DesktopAPI"),
    ...interfaceMembers(verticals, "DesktopVerticalAPI"),
  ];

  // Minus the transports: bridge/ implements every method by definition, so
  // counting it as a call site would make this test vacuous. Test helpers are
  // excluded for the same reason — services/test/fakeDesktopApi.ts implements
  // the interface too.
  const callSites = CALL_SITE_ROOTS
    .flatMap((root) => sourceFiles(root))
    .filter((path) => !path.includes(join("renderer", "bridge")))
    .filter((path) => !path.includes(join("services", "test")))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  it("covers the whole interface", () => {
    // A guard on the extractor itself: a silent regex drift that returned two
    // names would make every assertion below pass.
    expect(methods.length).toBeGreaterThan(100);
    expect(methods).toContain("generate");
    expect(methods).toContain("getJiraConnection");
  });

  it("every RPC has a renderer call site", () => {
    const unreachable = methods
      .filter((method) => !(method in UNWIRED) && !(method in PENDING_CONSUMER))
      .filter((method) => !isCalled(method, callSites));

    expect(unreachable).toEqual([]);
  });

  it("no stale exceptions", () => {
    const stale = [...Object.keys(UNWIRED), ...Object.keys(PENDING_CONSUMER)]
      .filter((method) => !methods.includes(method));
    expect(stale).toEqual([]);
  });

  // A pending entry that already has its consumer is finished work still
  // carrying scaffolding. Drop the line.
  it("no pending entry that is already wired", () => {
    const arrived = Object.keys(PENDING_CONSUMER)
      .filter((method) => isCalled(method, callSites));
    expect(arrived).toEqual([]);
  });

  // The exception list is a ratchet. It may shrink freely; growing it means a
  // capability just went out of reach, and that should be an argument rather
  // than a diff nobody reads. PENDING_CONSUMER is deliberately not ratcheted —
  // it is expected to grow during a build-out and empty itself afterwards.
  //
  // 13 → 14 when isCalled() was tightened: `previewArtifact` had been counted
  // as reachable because a local variable shares its name. The capability did
  // not regress, the measurement got honest.
  it("the unwired list does not grow", () => {
    expect(Object.keys(UNWIRED)).toHaveLength(14);
  });
});
