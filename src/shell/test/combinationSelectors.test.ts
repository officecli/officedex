/**
 * Wave 4 gate 4, for OD-UI-1.2: every rule that depends on the workspace's
 * state names a state the workspace can be in.
 *
 * The design lays its three columns out from state classes on `#dx-workspace`
 * — `.dx-compact`, `.dx-with-chat`, `.dx-chat-right`, `.dx-workspace-closed`
 * and six more — and its stylesheets combine them freely:
 * `#dx-workspace.dx-compact.dx-chat-right:not(.dx-workspace-closed)`. Ten
 * classes are a thousand combinations on paper and a few dozen in practice,
 * and nothing in a selector says which kind it is. A rule written for a
 * combination that cannot occur is dead; a rule that was meant for one state
 * and matches three is a layout bug in the two nobody looked at.
 *
 * So the gate asks two questions of every such selector, and answers both from
 * the product rather than from a list somebody typed:
 *
 *  - **Can it match at all?** The reachable states are found by walking the
 *    reducer from a cold start with every navigation it has, and turned into
 *    classes by `workspaceClasses` — the function `App.tsx` calls. A selector
 *    no reachable state satisfies is reported.
 *  - **Which of the ten reviewed shells does it cover?** `SHELL_COMBINATIONS`
 *    is the table the audit specs and the fixture walk. REGISTRY pins, for each
 *    state selector, the ones it matches; the set is recomputed on every run,
 *    so narrowing a selector — or the generator rewriting one — is red until
 *    the registry agrees. An empty set is allowed and means "reachable, and
 *    outside the ten": the audit has never looked at it.
 *
 * **Known blind spots.**
 *
 * 1. It reads selector text, not the cascade. Two registered rules can still
 *    fight over one property.
 * 2. It sees state expressed on `#dx-workspace` and `#shell`. A difference
 *    expressed some other way — an attribute on an inner element, a container
 *    query, a media query — is outside it. The narrow-window layout
 *    (`@media (max-width: 900px)`) is the large one.
 * 3. Reachable is not sensible. The walk finds every state the reducer can
 *    produce; it does not know that a floating conversation over Assets with
 *    the sidebar hidden is a state nobody designed for.
 * 4. The registry is keyed by selector text, not by `file:line`: line numbers
 *    move every time somebody edits the file above, and the generated
 *    stylesheets are rewritten whole.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SHELL_COMBINATIONS, type ShellCombination } from "../dev/fixture";
import {
  hydrateShellState,
  initialShellState,
  shellReducer,
  type ChatRef,
  type ShellAction,
  type ShellState,
} from "../state/shellReducer";
import { WORKSPACE_STATE_CLASSES, workspaceClasses } from "../state/workspaceClasses";
import { cssFiles } from "./cssModel";

const COMBINATION_IDS = Object.keys(SHELL_COMBINATIONS) as ShellCombination[];

/* --------------------------------------------------------- reachable states */

const CHAT: ChatRef = { folderId: "project", conversationId: "chat" };

/** Every way the user can move the workspace, with one file and one conversation. */
const MOVES: ShellAction[] = [
  { type: "go", page: "home" },
  { type: "go", page: "local" },
  { type: "go", page: "projects" },
  { type: "go", page: "settings" },
  { type: "go", page: "image" },
  { type: "open-chat", chat: CHAT },
  { type: "open-file", fileId: "file" },
  { type: "open-local-file", fileId: "file" },
  { type: "activate-file", fileId: "file" },
  { type: "close-file", fileId: "file" },
  { type: "toggle-workspace" },
  { type: "toggle-chat-display" },
  { type: "swap-chat" },
  { type: "toggle-nav" },
  { type: "enter-stage" },
];

/** The classes of every state the reducer can reach, as sorted, joined sets. */
function reachableClassSets(): Set<string> {
  const seen = new Set<string>();
  const queue: ShellState[] = [initialShellState];
  const out = new Set<string>();
  while (queue.length > 0) {
    const state = queue.pop()!;
    const id = JSON.stringify(state);
    if (seen.has(id)) continue;
    seen.add(id);
    // The two facts that are not shell state vary freely; `workspaceClasses`
    // is what decides when each of them can show.
    for (const peek of [false, true]) {
      for (const hasWorkspaceToggle of [false, true]) {
        out.add(workspaceClasses(state, { peek, hasWorkspaceToggle }).join(" "));
      }
    }
    for (const move of MOVES) queue.push(shellReducer(state, move));
  }
  return out;
}

/** What a reviewed shell puts on `#dx-workspace`, at rest. */
function classesOf(name: ShellCombination): string[] {
  const state = hydrateShellState({ ...SHELL_COMBINATIONS[name], openFileIds: ["file"], activeFileId: "file" });
  // At rest: nothing is being hovered, and a conversation with a document or
  // its Assets beside it has its switch.
  return workspaceClasses(state, { peek: false, hasWorkspaceToggle: state.chat !== null });
}

/* ---------------------------------------------------------------- selectors */

interface ScopedRule {
  /** `#dx-workspace.dx-compact:not(.dx-chat-right)` — the part that names a state. */
  root: string;
  selector: string;
  file: string;
}

const ROOT = /^#dx-workspace((?:\.[\w-]+|:not\(\.[\w-]+\))+)/;

export function scopedRules(files: string[]): ScopedRule[] {
  const out: ScopedRule[] = [];
  for (const file of files) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
    for (const match of css.matchAll(/(^|[};])([^{};]*?)\{/g)) {
      // A list is not one rule for this purpose: each selector in it styles
      // something, and each is a separate thing to be accountable for.
      for (const part of match[2].split(/,(?![^(]*\))/)) {
        const selector = part.trim().replace(/\s+/g, " ");
        const root = ROOT.exec(selector)?.[0];
        if (root) out.push({ root, selector, file });
      }
    }
  }
  return out;
}

interface Requirement {
  present: string[];
  absent: string[];
}

export function requirementOf(root: string): Requirement {
  const states = ROOT.exec(root)?.[1] ?? "";
  return {
    absent: [...states.matchAll(/:not\(\.([\w-]+)\)/g)].map((match) => match[1]),
    present: [...states.replace(/:not\([^)]*\)/g, "").matchAll(/\.([\w-]+)/g)].map((match) => match[1]),
  };
}

const satisfies = (classes: readonly string[], { present, absent }: Requirement) =>
  present.every((name) => classes.includes(name)) && absent.every((name) => !classes.includes(name));

export const combinationsFor = (root: string): ShellCombination[] =>
  COMBINATION_IDS.filter((name) => satisfies(classesOf(name), requirementOf(root)));

/**
 * The declaration: which of the ten reviewed shells each state selector covers.
 *
 *   C1  Home                      C6  document, conversation on the right, sidebar hidden
 *   C2  Home, sidebar hidden      C7  document, conversation floating, sidebar hidden
 *   C3  Local                     C8  conversation alone (content region closed)
 *   C4  conversation + Assets     C9  Local document, sidebar hidden
 *   C5  conversation + document   C10 Settings
 */
const REGISTRY: Record<string, readonly ShellCombination[]> = {
  // ---- the sidebar, hidden -------------------------------------------------
  "#dx-workspace.dx-compact": ["C2", "C6", "C7", "C9"],
  "#dx-workspace:not(.dx-compact)": ["C1", "C3", "C4", "C5", "C8", "C10"],
  // Shown while the pointer is at the window's edge. A hover, so no shell at rest.
  "#dx-workspace.dx-compact.dx-sidebar-peek": [],
  "#dx-workspace.dx-compact:not(.dx-with-chat)": ["C2", "C9"],
  "#dx-workspace.dx-compact:not(.dx-chat-right)": ["C2", "C7", "C9"],
  "#dx-workspace.dx-compact:not(.dx-chat-right):not(.dx-chat-floating)": ["C2", "C9"],
  "#dx-workspace.dx-compact.dx-with-chat:not(.dx-workspace-closed)": ["C6", "C7"],
  "#dx-workspace.dx-compact.dx-chat-floating": ["C7"],
  "#dx-workspace.dx-chat-floating.dx-compact": ["C7"],
  // Which side is a preference and is kept on Home, so this one matches a
  // hidden sidebar with no conversation open as well.
  "#dx-workspace.dx-compact.dx-chat-right": ["C6"],
  "#dx-workspace.dx-compact.dx-chat-right.dx-with-chat": ["C6"],
  "#dx-workspace.dx-compact.dx-chat-right:not(.dx-workspace-closed)": ["C6"],
  // Reachable — hide the sidebar, swap sides, close the content region — and
  // outside the ten. The band of global controls has to move for it.
  "#dx-workspace.dx-compact.dx-chat-right.dx-workspace-closed": [],

  // ---- a conversation beside the content ----------------------------------
  "#dx-workspace.dx-with-chat": ["C4", "C5", "C6", "C7", "C8"],
  "#dx-workspace:not(.dx-compact).dx-with-chat": ["C4", "C5", "C8"],
  "#dx-workspace.dx-with-chat:not(.dx-workspace-closed)": ["C4", "C5", "C6", "C7"],
  "#dx-workspace.dx-with-chat.dx-workspace-closed": ["C8"],
  "#dx-workspace.dx-workspace-closed": ["C8"],
  "#dx-workspace.dx-has-workspace-toggle": ["C4", "C5", "C6", "C7", "C8"],
  "#dx-workspace.dx-workspace-closed.dx-has-workspace-toggle": ["C8"],

  // ---- on the right --------------------------------------------------------
  "#dx-workspace.dx-chat-right": ["C6"],
  "#dx-workspace.dx-with-chat.dx-chat-right": ["C6"],
  "#dx-workspace.dx-with-chat.dx-chat-right:not(.dx-workspace-closed)": ["C6"],
  "#dx-workspace.dx-chat-right.dx-has-workspace-toggle": ["C6"],
  // The conversation alone, on the right. Reachable and outside the ten.
  "#dx-workspace.dx-with-chat.dx-chat-right.dx-workspace-closed": [],

  // ---- floating ------------------------------------------------------------
  "#dx-workspace.dx-chat-floating": ["C7"],
  "#dx-workspace.dx-chat-floating.dx-with-chat": ["C7"],
  // Floating, having been docked on the right. Reachable and outside the ten.
  "#dx-workspace.dx-chat-floating.dx-with-chat.dx-chat-right": [],

  // ---- pages ---------------------------------------------------------------
  "#dx-workspace.dx-at-settings": ["C10"],
};

/**
 * State on the root that is an axis across the table rather than a coordinate
 * in it: every shell is loading before it has loaded, either theme, with or
 * without reduced motion, and while the divider is being dragged.
 */
const PHASES = [
  '.shell[data-loaded="false"]',
  '#shell[data-theme="dark"]',
  "#shell[data-theme=dark]",
  "#shell.dx-reduced",
  "#shell.dx-resizing",
];

describe("workspace state selectors", () => {
  const rules = scopedRules(cssFiles("src/shell"));
  const roots = [...new Set(rules.map((rule) => rule.root))];
  const reachable = [...reachableClassSets()].map((set) => (set ? set.split(" ") : []));

  it("name only states the workspace has", () => {
    const known = new Set<string>(WORKSPACE_STATE_CLASSES);
    const unknown = rules
      .filter(({ root }) => {
        const { present, absent } = requirementOf(root);
        return [...present, ...absent].some((name) => !known.has(name));
      })
      .map(({ file, selector }) => `${file}  ${selector}`);
    expect(unknown, "a state class `workspaceClasses` never sets matches nothing, ever").toEqual([]);
  });

  it("each match a state the reducer can reach", () => {
    const dead = roots.filter((root) => !reachable.some((classes) => satisfies(classes, requirementOf(root))));
    expect(dead, "a rule that no reachable state satisfies is dead CSS").toEqual([]);
  });

  it("are all registered", () => {
    const unregistered = roots.filter((root) => !(root in REGISTRY));
    expect(unregistered, "a new #dx-workspace state selector must declare the shells it covers").toEqual([]);
  });

  it("cover the reviewed shells the registry says they do", () => {
    const wrong: string[] = [];
    for (const root of roots) {
      const declared = REGISTRY[root];
      if (!declared) continue;
      const actual = combinationsFor(root);
      if (actual.join(",") !== [...declared].join(",")) {
        wrong.push(`${root}\n    declared ${declared.join("/") || "none"}\n    matches  ${actual.join("/") || "none"}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("leave no entry for a selector that is gone", () => {
    const stale = Object.keys(REGISTRY).filter((root) => !roots.includes(root));
    expect(stale, "delete the entry, do not leave the registry describing CSS that is gone").toEqual([]);
  });

  it("are the only state the stylesheets read off the root", () => {
    // Anything else scoped on `#shell` is a new axis, and a new axis is a
    // decision about all ten shells at once.
    const other = new Set<string>();
    for (const file of cssFiles("src/shell")) {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of css.matchAll(/(?:^|[\s,};])((?:#shell|\.shell)(?:\[[^\]]+\]|\.[\w-]+)+)/g)) {
        other.add(match[1]);
      }
    }
    expect([...other].sort()).toEqual([...PHASES].sort());
  });

  it("reaches the states the ten shells are in", () => {
    // The walk and the table answer the same question two ways. A reviewed
    // shell the reducer cannot produce is a fixture reviewing a fiction.
    const unreachable = COMBINATION_IDS.filter(
      (name) => !reachable.some((classes) => classes.join(" ") === classesOf(name).join(" ")),
    );
    expect(unreachable).toEqual([]);
  });

  // A guard on the parser, in the spirit of deadControls.test.ts: a change that
  // made `scopedRules` find nothing would turn every assertion above green
  // while checking no CSS at all.
  it("finds the rules it is meant to be checking", () => {
    expect(rules.length).toBeGreaterThanOrEqual(50);
    expect(roots.length).toBeGreaterThanOrEqual(20);
    expect(reachable.length).toBeGreaterThanOrEqual(20);
    expect(new Set(rules.map(({ file }) => file)).size).toBeGreaterThanOrEqual(2);
  });
});
