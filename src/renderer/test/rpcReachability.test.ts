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

const RENDERER_ROOT = "src/renderer";

/**
 * Methods with no renderer call site today, and what was found when each was
 * checked. This is a survey of the state this test was written in, not a
 * blessing: every line here is a desktop capability the UI cannot reach.
 *
 * Removing a line (by wiring the method up) is always fine. Adding one means
 * some feature just became unreachable — say so out loud before you do.
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
};

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

  // The renderer minus the transports: bridge/ implements every method by
  // definition, so counting it as a call site would make this test vacuous.
  const callSites = sourceFiles(RENDERER_ROOT)
    .filter((path) => !path.startsWith(join(RENDERER_ROOT, "bridge")))
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
      .filter((method) => !(method in UNWIRED))
      .filter((method) => !new RegExp(`[.?]\\s*${method}\\b`).test(callSites));

    expect(unreachable).toEqual([]);
  });

  it("no stale exceptions", () => {
    const stale = Object.keys(UNWIRED).filter((method) => !methods.includes(method));
    expect(stale).toEqual([]);
  });

  // The exception list is a ratchet. It may shrink freely; growing it means a
  // capability just went out of reach, and that should be an argument rather
  // than a diff nobody reads.
  it("the unwired list does not grow", () => {
    expect(Object.keys(UNWIRED)).toHaveLength(13);
  });
});
