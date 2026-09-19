/**
 * Wave 4 gate 4: every shell-combination rule declares which shells it covers.
 *
 * The shell writes five attributes on its root (`App.tsx`), and the CSS reacts
 * to four of them. That is a 10-cell state space (`SHELL_COMBINATIONS`) styled
 * by a handful of selectors, and S5's table 8 is what happens when nobody keeps
 * a map of it:
 *
 *   - `#shell[data-mode="agent"][data-home="false"][data-presence="docked"]
 *     .shell-tabs` turns out to cover exactly two of the ten shells, and in
 *     doing so drops the `max(…, 132px)` floor the base rule has. It does not
 *     break today only because `TASK_MIN_WIDTH` is 320 at run time — a
 *     JavaScript constant holding up a CSS guarantee.
 *   - Editor mode has no rule of its own at all; four shells are styled
 *     entirely by the agent-shaped defaults.
 *   - `data-presence` has one rule, `data-loaded` none.
 *
 * None of that is visible from reading any single rule. The gate is therefore
 * not "is this rule correct" — CSS cannot be asked that — but "does the author
 * know what it hits": a combination-scoped selector must appear in REGISTRY
 * with the exact set of shells it matches, and the set is recomputed from
 * `SHELL_COMBINATIONS` on every run. Add a rule and the gate is red until you
 * say which shells you meant; narrow an existing one and it is red until the
 * registry agrees.
 *
 * The expected sets are *derived*, never typed twice: `SHELL_COMBINATIONS` is
 * imported from `../dev/fixture` (the same table the audit specs and the
 * fixture server use) and the presence axis comes from `effectivePlacement`,
 * so the "which shells exist" question has one answer in the repository.
 *
 * **Known blind spots.**
 *
 * 1. It reads selector text, not the cascade. Two registered rules can still
 *    fight — `chrome.css` has a pair that both set `.shell-brand`'s width,
 *    one as `36px` and one as `var(--shell-row-h)`, so changing the token moves
 *    only one of them (S5 table 8, conclusion 4). Both are registered, both
 *    match the same shells, and this gate is happy. Catching that needs a
 *    cascade model; what stops it in practice is that the two rules are now
 *    adjacent entries in one list.
 * 2. It only sees rules scoped on the *root*. A combination difference
 *    expressed some other way — a `data-` attribute on an inner element, a
 *    class toggled in TSX, a container query — is outside it.
 * 3. It cannot tell a rule that matches nothing *useful* from one that matches
 *    nothing at all; it only fails the second case.
 * 4. The registry is keyed by selector text, not by `file:line`. That is
 *    deliberate: line numbers move every time somebody edits the file above,
 *    and a gate that goes red for unrelated edits gets deleted. The cost is
 *    that moving a rule verbatim between files is invisible here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SHELL_COMBINATIONS, type ShellCombination } from "../dev/fixture";
import { effectivePlacement, initialShellState } from "../state/shellReducer";

/** Every stylesheet the shell entry loads. */
const STYLESHEETS = [
  "src/shell/tokens.css",
  "src/shell/app.css",
  "src/shell/chrome/chrome.css",
  "src/shell/chrome/menu.css",
  "src/shell/nav/nav.css",
  "src/shell/agent/agent.css",
  "src/shell/composer/composer.css",
  "src/shell/home/home.css",
  "src/shell/home/highlights.css",
  "src/shell/home/taskList.css",
];

/**
 * What each combination puts on the root element.
 *
 * Mirrors `App.tsx`'s five `data-*` props. `data-presence` goes through
 * `effectivePlacement` rather than through the fixture's `placement` field,
 * because that is what the DOM actually gets: docking is Agent-mode-only, so
 * the two Editor Home shells report `floating` even though nothing is floating
 * there — and a selector written against `[data-presence="floating"]` really
 * does match them.
 *
 * `data-loaded` is the one attribute that is not part of a combination's
 * identity: all ten shells pass through `"false"` on the way to `"true"`, so it
 * is an axis *across* the table rather than a coordinate in it. It used to be
 * pinned to `"true"` here, on the reasoning that `"true"` is what the user
 * sees — which was accurate while no rule read the attribute at all (the
 * header above says so), and became a trap the moment one did: the first
 * loading rule written would have matched zero combinations and been reported
 * as dead CSS. Both phases are evaluated below instead.
 */
const LOAD_PHASES = ["true", "false"] as const;

function attributesOf(name: ShellCombination, loaded: string): Record<string, string> {
  const combination = SHELL_COMBINATIONS[name] as {
    mode: "agent" | "editor";
    home: boolean;
    navCollapsed: boolean;
    placement?: "docked" | "floating";
  };
  const state = {
    ...initialShellState,
    mode: combination.mode,
    home: combination.home,
    navCollapsed: combination.navCollapsed,
    presence: {
      ...initialShellState.presence,
      placement: combination.placement ?? initialShellState.presence.placement,
    },
  };
  return {
    "data-mode": state.mode,
    "data-home": String(state.home),
    "data-nav-collapsed": String(state.navCollapsed),
    "data-presence": effectivePlacement(state),
    "data-loaded": loaded,
  };
}

const COMBINATION_IDS = Object.keys(SHELL_COMBINATIONS) as ShellCombination[];

interface ScopedRule {
  selector: string;
  at: string;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

/**
 * Every root-scoped selector in the shell's stylesheets.
 *
 * Splits selector lists on commas and keeps the individual selectors, because
 * a list is not one rule for this purpose: `.shell[…] .shell-brand-name,
 * .shell[…] .shell-brand-chevron` styles two different things and each of them
 * is a separate thing to be accountable for.
 */
export function scopedRules(sources: Array<{ path: string; text: string }>): ScopedRule[] {
  const out: ScopedRule[] = [];
  for (const { path, text } of sources) {
    const css = withoutComments(text);
    for (const match of css.matchAll(/(^|[};])([^{};]*?)\{/g)) {
      const list = match[2];
      if (!/(#shell|\.shell)\[data-/.test(list)) continue;
      const line = css.slice(0, match.index! + match[1].length).split("\n").length;
      for (const selector of list.split(",")) {
        const trimmed = selector.trim().replace(/\s+/g, " ");
        if (!/^(#shell|\.shell)\[data-/.test(trimmed)) continue;
        out.push({ selector: trimmed, at: `${path}:${line}` });
      }
    }
  }
  return out;
}

/** The shells a root-scoped selector applies to, in either load phase. */
export function combinationsFor(selector: string): ShellCombination[] {
  const root = selector.split(" ")[0];
  const predicates = [...root.matchAll(/\[([a-z-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)].map((match) => ({
    attribute: match[1],
    value: match[2],
  }));
  return COMBINATION_IDS.filter((name) =>
    LOAD_PHASES.some((loaded) => {
      const attributes = attributesOf(name, loaded);
      return predicates.every(({ attribute, value }) =>
        value === undefined ? attribute in attributes : attributes[attribute] === value,
      );
    }),
  );
}

/**
 * The declaration. A selector is in here or the gate is red.
 *
 * Read this as the answer to "which of the ten shells does the product look
 * different in, and why". Fifteen of the eighteen entries are the collapsed
 * rail, which is the one axis anybody has actually styled.
 */
const REGISTRY: Record<string, readonly ShellCombination[]> = {
  // The rail: five shells, every mode, Home and workspace alike.
  '.shell[data-nav-collapsed="true"] .shell-sidebar': ["C1", "C3", "C5", "C7", "C9"],
  '#shell[data-nav-collapsed="true"] .shell-sidebar-brand': ["C1", "C3", "C5", "C7", "C9"],
  '#shell[data-nav-collapsed="true"] .shell-sidebar-brand .shell-brand': ["C1", "C3", "C5", "C7", "C9"],
  // These two set the same three properties on `.shell-brand` as the entry
  // above, one through `36px` and one through `var(--shell-row-h)`. Kept
  // adjacent on purpose: they are a known duplication (S5 table 8, conclusion
  // 4), and the next person to change the row height has to see both.
  '.shell[data-nav-collapsed="true"] .shell-brand': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-brand-name': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-brand-chevron': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-sidebar-item': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-sidebar-footer': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-profile': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-tree-files': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-tree-folder-toggle > span': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-tree-folder-toggle > small': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-tree-chevron': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-tree-folder-add': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-tree-section-head': ["C1", "C3", "C5", "C7", "C9"],
  // The rail keeps the "New folder" button and drops only its label. Splitting
  // the entry above was S1-008's fix: it hid the head outright, and with it the
  // shell's only folder-creation control, in every collapsed shell.
  '.shell[data-nav-collapsed="true"] .shell-tree-section-head > span': ["C1", "C3", "C5", "C7", "C9"],
  '.shell[data-nav-collapsed="true"] .shell-tree-folder-toggle': ["C1", "C3", "C5", "C7", "C9"],

  /*
   * The loading phase: all ten shells, because every shell has one.
   *
   * Two things happen while the workspace is being read, and they are two rules
   * because they are two different claims. The first withdraws the empty-state
   * sentence — "No files yet" is a statement about a library nobody has opened
   * yet. The second puts a bar where the list will be. Before them,
   * `data-loaded` was written by `App.tsx` and read by nothing, so a directory
   * scan and an empty workspace were the same screen (S6-013 / S5-010).
   */
  '.shell[data-loaded="false"] .shell-list-empty': [
    "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
  ],
  '.shell[data-loaded="false"] .shell-tree-empty': [
    "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
  ],
  '.shell[data-loaded="false"] .shell-sidebar-body::before': [
    "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
  ],
  '.shell[data-loaded="false"] .shell-home-list::before': [
    "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
  ],

  // Home: the tab strip's actions are not drawn there.
  '#shell[data-home="true"] .shell-tabs-actions': ["C1", "C2", "C3", "C4"],

  /*
   * The two-shell rule, and the one worth staring at.
   *
   * It replaces `.shell-tabs`'s `padding-left: max(var(--shell-nav-w), 132px)`
   * with `calc(var(--shell-nav-w) + var(--shell-task-w))` — dropping the 132px
   * floor that keeps the macOS traffic lights clear of the first tab. It is
   * safe only while `--shell-task-w` stays at or above `TASK_MIN_WIDTH` (320),
   * a reducer constant. Lower that constant and C5 loses its window controls
   * under a tab, with no CSS anywhere admitting the dependency.
   */
  '#shell[data-mode="agent"][data-home="false"][data-presence="docked"] .shell-tabs': ["C5", "C6"],
};

describe("shell combination selectors", () => {
  const sources = STYLESHEETS.map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const rules = scopedRules(sources);

  it("every combination-scoped rule is registered", () => {
    const unregistered = rules
      .filter(({ selector }) => !(selector in REGISTRY))
      .map(({ at, selector }) => `${at}  ${selector}`);
    expect(
      unregistered,
      "a new #shell[data-*] rule must declare the combinations it covers in REGISTRY",
    ).toEqual([]);
  });

  it("each registration names the combinations the selector actually matches", () => {
    const wrong: string[] = [];
    for (const { selector, at } of rules) {
      const declared = REGISTRY[selector];
      if (!declared) continue;
      const actual = combinationsFor(selector);
      if (actual.join(",") !== [...declared].join(",")) {
        wrong.push(`${at}  ${selector}\n    declared ${declared.join("/")}\n    matches  ${actual.join("/")}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("no registered selector matches nothing", () => {
    const dead = rules
      .filter(({ selector }) => combinationsFor(selector).length === 0)
      .map(({ at, selector }) => `${at}  ${selector}`);
    expect(dead, "a rule that no shell satisfies is dead CSS").toEqual([]);
  });

  it("the registry has no entries for rules that no longer exist", () => {
    const present = new Set(rules.map(({ selector }) => selector));
    const stale = Object.keys(REGISTRY).filter((selector) => !present.has(selector));
    expect(stale, "delete the entry, do not leave the registry describing CSS that is gone").toEqual([]);
  });

  // A guard on the parser, in the spirit of deadControls.test.ts: a change that
  // made `scopedRules` find nothing would turn all four assertions above green
  // while checking no CSS at all.
  it("finds the rules it is meant to be checking", () => {
    expect(rules.length).toBeGreaterThanOrEqual(15);
    expect(new Set(rules.map(({ at }) => at.split(":")[0])).size).toBeGreaterThanOrEqual(3);
  });
});
