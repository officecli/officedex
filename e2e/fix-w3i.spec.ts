/**
 * W3-I regression gate: the token convergence must not move a single pixel.
 *
 * This track replaces bare colour literals with tokens, adds a Status section
 * and a z-index ladder, and extends the type scale. Every one of those edits is
 * supposed to change *where a value comes from*, not what the value is — so the
 * only honest way to land it is to record what the shell renders beforehand and
 * assert the same numbers afterwards.
 *
 * Four passes, because no single one is sufficient:
 *
 *   1. `declarations` — walks the CSSOM of every `src/shell` stylesheet and
 *      resolves each colour / size declaration against `#shell`. This is the
 *      only pass that reaches rules no fixture can render: `:hover`, `:active`,
 *      `[data-applied="true"]`, `.is-drop-target`, the skeleton canvas. A hex
 *      and the token that replaces it both resolve to the same `rgb(...)`, so a
 *      swap that preserves appearance is invisible here and one that does not
 *      is a diff with the selector's name on it.
 *
 *   2. `tree` — the computed colour/size fingerprint of every element under
 *      `#shell`, for all ten combinations. Pass 1 reads rules in isolation;
 *      this one reads the cascade, which is what actually reaches the screen
 *      (and is the only pass that can see the `.shell-home` duplicate being
 *      collapsed).
 *
 *   3. `menu` — the same fingerprint for the portalled menu panel, which is not
 *      in the tree until something opens it.
 *
 *   4. `probes` — surfaces the fixture never renders (a failed page, an applied
 *      suggestion, a drop target, a dialog error, the canvas skeleton),
 *      mounted inside `#shell` so the real cascade applies, then fingerprinted.
 *      Pass 1 reads their rules, but one rule it cannot read at all, and this
 *      is where that one is actually checked — see ACCEPTED.
 *
 * The baseline lives in `docs/ui-audit-2026-09-19/fixes/W3-I/baseline.json` and
 * was recorded on a checkout of `4a716ea` with nothing else applied. It is a
 * snapshot of the whole shell, so a *deliberate* change to any rendered value —
 * by this track or a later one — is re-recorded rather than argued with; the
 * command is at the bottom of this comment. Passes 2-4 fail only on a key that
 * existed in the baseline and now reads differently, so adding or removing DOM
 * does not turn this red for work it is not about (see `compare`).
 *
 * There is deliberately no `test.skip` in this file, conditional or otherwise.
 * A missing baseline fails; a missing dev server fails. Nothing here reports
 * "skipped" and exit code 0.
 *
 *   npx vite --port 3151 --strictPort
 *   PLAYWRIGHT_BASE_URL=http://localhost:3151 npx playwright test e2e/fix-w3i.spec.ts
 *
 * To re-record after an accepted change:
 *   W3I_WRITE_BASELINE=1 PLAYWRIGHT_BASE_URL=... npx playwright test e2e/fix-w3i.spec.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { COMBINATIONS, open, type Combination } from "./ui-audit-helpers";

const BASELINE_PATH = "docs/ui-audit-2026-09-19/fixes/W3-I/baseline.json";
const WRITE = process.env.W3I_WRITE_BASELINE === "1";

interface Baseline {
  declarations: Record<string, string>;
  tree: Record<string, Record<string, string>>;
  menu: Record<string, Record<string, string>>;
  probes: Record<string, Record<string, string>>;
}

/**
 * The changes this track means to make, each keyed the way the pass reports it.
 *
 * Kept as exact keys rather than patterns: a prefix match would quietly absorb
 * the next unintended change that happens to share a selector, which is the one
 * thing this file exists to prevent. Every entry is justified in
 * `docs/ui-audit-2026-09-19/fixes/W3-I.md`.
 */
const ACCEPTED: Record<string, string> = {
  /*
   * `.shell-task-spinner` is the one rule the CSSOM cannot report.
   *
   * It is `border: 2px solid <track>` followed by `border-top-color: <head>`.
   * Once those two values are `var()`, the shorthand becomes a
   * pending-substitution value while a longhand for the same box overrides part
   * of it — a state with no serialisation: `getPropertyValue("border")` returns
   * empty *and* `cssText` drops the border, so both halves of the probe lose
   * it. Nothing is wrong with the rule; the reading of it is what fails, and it
   * only fails after the swap, which is precisely the shape of a false
   * positive.
   *
   * Rather than reshape the stylesheet to suit a measurement, the fourth test
   * below renders an actual `.shell-task-spinner` and asserts its four computed
   * border colours — the same claim, made where serialisation is not involved.
   */
  ".shell-task-spinner|border-top-width": "var() shorthand + longhand: unserialisable, covered by the rendered probe",
  ".shell-task-spinner|border-top-style": "var() shorthand + longhand: unserialisable, covered by the rendered probe",
  ".shell-task-spinner|border-right-color": "var() shorthand + longhand: unserialisable, covered by the rendered probe",
  ".shell-task-spinner|border-bottom-color": "var() shorthand + longhand: unserialisable, covered by the rendered probe",
  ".shell-task-spinner|border-left-color": "var() shorthand + longhand: unserialisable, covered by the rendered probe",
};

/**
 * Surfaces the ten fixture combinations never put on screen.
 *
 * Rendered, not replayed: each snippet is mounted inside `#shell` so the real
 * cascade applies to it, then fingerprinted like anything else. This is what
 * covers the state-only rules — a failed page, an applied suggestion, a drop
 * target, a dialog error, the canvas skeleton — and it is the only evidence
 * for `.shell-task-spinner`, whose rule the CSSOM cannot serialise.
 *
 * Hover / focus / active rules are not here, because they cannot be forced from
 * a detached node; the declaration pass reads those and reports them in full.
 */
const PROBE_HTML = `
<div class="shell-task-scroll">
  <span class="shell-task-spinner"></span>
  <ul class="shell-task-steps">
    <li class="shell-task-step is-done">done</li>
    <li class="shell-task-step is-active">active</li>
    <li class="shell-task-step">queued</li>
  </ul>
  <ul class="shell-task-outline">
    <li class="shell-task-outline-row" data-state="failed">
      <span class="shell-task-outline-index">1</span>
      <span class="shell-task-outline-title">failed</span>
    </li>
    <li class="shell-task-outline-row" data-state="repairing">
      <span class="shell-task-spinner"></span>
      <span class="shell-task-outline-title">repairing</span>
    </li>
    <li class="shell-task-outline-row" data-state="ready"><span>ready</span></li>
    <li class="shell-task-outline-row" data-state="generating"><span>generating</span></li>
  </ul>
  <p class="shell-task-user">user<blockquote>quote</blockquote><cite>cite</cite></p>
  <div class="shell-task-reply"><span class="shell-task-reply-label">label</span><p>reply</p></div>
  <div class="shell-task-suggestion" data-applied="true"><strong>s</strong><p>p</p><small>m</small></div>
  <div class="shell-task-suggestion"><strong>s</strong><p>p</p><small>m</small></div>
  <div class="shell-task-artifact"><div class="shell-task-artifact-head"><div><strong>a</strong><small>b</small></div></div></div>
  <div class="shell-task-question"><strong>q</strong><small>hint</small></div>
  <div class="shell-task-actions">
    <button class="shell-task-button is-primary">primary</button>
    <button class="shell-task-button">secondary</button>
    <button class="shell-task-button" disabled>disabled</button>
  </div>
  <div class="shell-task-empty"><strong>empty</strong><p>body</p></div>
</div>
<div class="shell-presence-panel"><button class="shell-presence-collapse">&ndash;</button></div>
<span class="shell-face-badge">2</span>
<div class="shell-tree">
  <div class="shell-tree-folder is-drop-target">
    <div class="shell-tree-folder-row is-current">
      <button class="shell-tree-folder-toggle"><span>folder</span><small>3</small></button>
      <button class="shell-tree-folder-add">+</button>
    </div>
    <div class="shell-tree-files">
      <div class="shell-tree-file-row is-current"><button class="shell-tree-file-open"><span>file</span></button></div>
      <div class="shell-tree-file-row"><button class="shell-tree-file-open"><span>file</span></button><button class="shell-tree-file-more">…</button></div>
    </div>
  </div>
  <p class="shell-tree-empty">empty</p>
  <button class="shell-tree-more">more</button>
</div>
<table class="shell-list">
  <thead><tr><th>Name</th><th>Folder</th><th>Last opened</th><th></th></tr></thead>
  <tbody class="is-drop-target"><tr class="is-current"><td><button class="shell-list-file"><span class="shell-list-dirty"></span><span>n</span></button></td><td>f</td><td>t</td><td><button class="shell-list-pin is-pinned">p</button></td></tr></tbody>
  <tbody><tr class="shell-list-group"><th>Today<small>2</small></th></tr><tr><td>x</td></tr></tbody>
</table>
<p class="shell-dialog-error">error</p>
<label class="shell-dialog-label">label</label>
<p class="shell-dialog-note">note</p>
<div class="shell-skeleton-paper">
  <span class="shell-skeleton-line shell-skeleton-line--eyebrow"></span>
  <span class="shell-skeleton-line shell-skeleton-line--title"></span>
  <span class="shell-skeleton-line shell-skeleton-line--heading"></span>
  <span class="shell-skeleton-line"></span>
  <span class="shell-skeleton-block"></span>
</div>
<div class="shell-skeleton-grid"><span class="shell-skeleton-cell shell-skeleton-cell--head">A</span><span class="shell-skeleton-cell">1</span></div>
<div class="shell-skeleton-filmstrip"><span class="shell-skeleton-thumb shell-skeleton-thumb--current"></span><span class="shell-skeleton-thumb"></span></div>
<div class="shell-skeleton-slide"></div>
<div class="shell-tab is-current"><button class="shell-tab-select"><span class="shell-tab-name">t</span><span class="shell-tab-dirty"></span></button><button class="shell-tab-bookmark">b</button><button class="shell-tab-close">x</button></div>
<div class="shell-tab"><button class="shell-tab-select"><span class="shell-tab-name">t</span></button></div>
<button class="shell-share">Share</button>
<button class="shell-save-state">Saved</button>
<div class="shell-tabs-icons"><button class="shell-icon-button">i</button></div>
<button class="shell-brand"><span class="shell-brand-mark">M</span><span class="shell-brand-name">OfficeDex</span><span class="shell-brand-chevron">v</span></button>
<button class="shell-sidebar-item is-current"><span>current</span></button>
<button class="shell-profile"><span class="shell-avatar">A</span><span>name</span></button>
<div class="shell-menu"><button class="shell-menu-item"><span class="shell-menu-icon">i</span><span class="shell-menu-label">label<small>note</small></span><span class="shell-menu-check"></span></button><button class="shell-menu-item" disabled>disabled</button></div>
<div class="shell-window-controls">
  <button class="shell-window-close"><span class="shell-window-glyph">x</span></button>
  <button class="shell-window-minimize"><span class="shell-window-glyph">-</span></button>
  <button class="shell-window-fullscreen"><span class="shell-window-glyph">+</span></button>
</div>
<div class="shell-home"><header class="shell-home-head"><h1>Heading</h1><p class="shell-home-lede">lede</p></header><h2 class="shell-home-subhead">sub</h2><button class="shell-home-new">new</button></div>
<div class="shell-hero"><h1>Hero</h1><p class="shell-hero-lede">lede</p><button class="shell-hero-prompt">prompt</button></div>
<div class="shell-hero-resume"><h2>Resume</h2><button class="shell-resume-card"><span class="shell-resume-title"><strong>t</strong><small>s</small></span></button></div>
`;

function readBaseline(): Baseline {
  const raw = readFileSync(BASELINE_PATH, "utf8");
  return JSON.parse(raw) as Baseline;
}

const recorded: Partial<Baseline> = {};

function settleBaseline(section: keyof Baseline, value: Baseline[keyof Baseline]) {
  (recorded as Record<string, unknown>)[section] = value;
  if (!WRITE) return;
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  const existing = (() => {
    try {
      return readBaseline();
    } catch {
      return { declarations: {}, tree: {}, menu: {}, probes: {} } as Baseline;
    }
  })();
  // Written without indentation on purpose: this is a machine artefact of
  // ~10,000 fingerprints, and pretty-printing it doubles the committed size
  // without making it any more readable by a human.
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ ...existing, ...recorded })}\n`, "utf8");
}

/**
 * Every colour/size declaration in the shell's stylesheets, resolved to the
 * value the browser would actually paint.
 *
 * Each rule's declarations are replayed onto a probe element inside `#shell`
 * and read back as *computed longhands*. Two properties of that method matter:
 *
 *   - it resolves. `#dfe2e6`, `var(--shell-menu-line)` and `color-mix(...)`
 *     all come back as the same kind of `rgb(...)`, which is exactly the
 *     equivalence this track is claiming.
 *   - it is substitution-independent. A shorthand written as
 *     `border: 1px solid #dfe2e6` is expanded into longhands by the CSSOM,
 *     while `border: 1px solid var(--shell-menu-line)` is held as a
 *     pending-substitution value and expands into nothing — so reading the
 *     *declarations* would report a spurious change on every single swap.
 *     Reading what the declarations compute to does not.
 *
 * Only longhands the rule actually moves are recorded: the probe is measured
 * empty first and anything matching that reading is dropped, so a rule
 * contributes its own effect and not the shell's inherited defaults.
 */
async function declarations(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const READ = [
      "color",
      "background-color",
      "background-image",
      "border-top-color",
      "border-right-color",
      "border-bottom-color",
      "border-left-color",
      "border-top-width",
      "border-top-style",
      "outline-color",
      "outline-width",
      "outline-style",
      "box-shadow",
      "fill",
      "stroke",
      "filter",
      "font-size",
      "font-weight",
      "font-family",
      "line-height",
      "letter-spacing",
      "opacity",
      "z-index",
    ];
    const BASE = "position:fixed;left:-99999px;top:0;";
    /*
     * Shorthands that carry a colour or a size, applied before the rest.
     *
     * The CSSOM cannot represent a rule that mixes a `var()` shorthand with a
     * longhand for the same box: `background: var(--x)` leaves
     * `getPropertyValue("background-color")` empty (pending substitution), and
     * `border: 2px solid var(--x)` followed by `border-top-color: var(--y)` —
     * which is what `.shell-task-spinner` is — serialises through `cssText`
     * with the border dropped entirely. Neither reading is complete on its own,
     * and both failure modes only appear *after* a literal becomes a token, so
     * a probe that used either one would report a change on every swap this
     * track makes and prove nothing.
     *
     * Taking the shorthands first and then replaying `cssText` over them
     * reconstructs both shapes. It assumes longhands follow their shorthand,
     * which is the only order these stylesheets use.
     */
    const SHORTHANDS = [
      "background",
      "border",
      "border-top",
      "border-right",
      "border-bottom",
      "border-left",
      "border-color",
      "border-width",
      "border-style",
      "outline",
      "font",
    ];
    const shell = document.querySelector("#shell") as HTMLElement;
    const probe = document.createElement("div");
    shell.appendChild(probe);

    const read = (rule: CSSStyleRule | null): Record<string, string> => {
      probe.style.cssText = BASE;
      if (rule) {
        for (const name of SHORTHANDS) {
          const value = rule.style.getPropertyValue(name);
          if (value) probe.style.setProperty(name, value);
        }
        probe.style.cssText = probe.style.cssText + rule.style.cssText;
      }
      const computed = getComputedStyle(probe);
      const out: Record<string, string> = {};
      for (const prop of READ) out[prop] = computed.getPropertyValue(prop);
      return out;
    };

    const empty = read(null);
    const out: Record<string, string> = {};

    for (const sheet of Array.from(document.styleSheets)) {
      const owner = sheet.ownerNode as HTMLElement | null;
      const id = owner?.getAttribute?.("data-vite-dev-id") ?? sheet.href ?? "";
      if (!/\/src\/shell\//.test(id)) continue;
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      const walk = (list: CSSRuleList, prefix: string) => {
        for (const rule of Array.from(list)) {
          if (rule instanceof CSSMediaRule) {
            walk(rule.cssRules, `${prefix}@media ${rule.conditionText} `);
            continue;
          }
          if (!(rule instanceof CSSStyleRule)) continue;
          const key = `${prefix}${rule.selectorText}`;
          const computed = read(rule);
          for (const prop of READ) {
            if (computed[prop] === empty[prop]) continue;
            out[`${key}|${prop}`] = computed[prop];
          }
          // The token tables themselves, read as authored: a custom property
          // has no computed form worth comparing, and its text is the thing.
          for (const name of Array.from(rule.style)) {
            if (!name.startsWith("--shell-")) continue;
            out[`${key}|${name}`] = rule.style.getPropertyValue(name).trim();
          }
        }
      };
      walk(rules, "");
    }
    probe.remove();
    return out;
  });
}

/**
 * One compact fingerprint per element, keyed by a stable path.
 *
 * Keyed by path and not by document index on purpose. An index-keyed snapshot
 * of 1500 elements reports every node after an inserted `<span>` as changed —
 * measured, one concurrent edit to the composer produced 886 "moved" rows, none
 * of which had moved. A gate that cries that loudly about a sibling being added
 * gets switched off. The path is the chain of `tag.class` from `#shell` down,
 * with an ordinal only among siblings that share the same key, so inserting a
 * node adds one entry and leaves the rest where they were.
 */
async function fingerprint(page: Page, root: string): Promise<Record<string, string>> {
  return page.evaluate((selector: string) => {
    const host = document.querySelector(selector);
    if (!host) return {};
    const classOf = (node: Element): string => {
      const raw = node.getAttribute("class") ?? "";
      // Sorted: React writes class lists in render order, which is not stable
      // across unrelated edits, and the set is what identifies the node.
      return raw.split(/\s+/).filter(Boolean).sort().join(".");
    };
    const out: Record<string, string> = {};
    const walk = (node: Element, path: string) => {
      const s = getComputedStyle(node);
      out[path] = [
        s.color,
        s.backgroundColor,
        s.borderTopColor,
        s.borderRightColor,
        s.borderBottomColor,
        s.borderLeftColor,
        s.fontSize,
        s.fontWeight,
        s.boxShadow,
        s.fill,
        s.stroke,
        s.filter,
        s.zIndex,
      ].join("|");
      const used = new Map<string, number>();
      for (const child of Array.from(node.children)) {
        const key = `${child.tagName.toLowerCase()}.${classOf(child)}`;
        const n = used.get(key) ?? 0;
        used.set(key, n + 1);
        walk(child, `${path}/${key}${n ? `[${n}]` : ""}`);
      }
    };
    walk(host, host.tagName.toLowerCase());
    return out;
  }, root);
}

interface Movement {
  changed: string[];
  added: number;
  removed: number;
}

/**
 * Compares two fingerprint maps.
 *
 * Only a key present in *both* readings can fail. This file's claim is that
 * every surface which existed before renders identically after; a node that has
 * appeared has no previous value to contradict, and a node that has gone is a
 * structural change belonging to whichever track removed it. Both are counted
 * and printed so they cannot pass unnoticed — but they do not turn this gate
 * red for work it is not about.
 */
function compare(before: Record<string, string> = {}, after: Record<string, string> = {}): Movement {
  const changed: string[] = [];
  let added = 0;
  let removed = 0;
  for (const key of Object.keys(after)) if (!(key in before)) added += 1;
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      removed += 1;
      continue;
    }
    if (before[key] === after[key]) continue;
    changed.push(`${key}\n    was ${before[key]}\n    now ${after[key]}`);
  }
  return { changed: changed.sort(), added, removed };
}

/**
 * Reports the declarations whose resolved value moved.
 *
 * Symmetric with `compare` below: only a key present in *both* readings can
 * fail. A declaration that did not exist before has no previous value to
 * contradict — that is a new rule, which is somebody's feature and not this
 * gate's business — while a declaration that changed, or disappeared, is
 * exactly what a "the values did not move" claim is about. Additions are
 * counted and printed so they are never silent.
 */
function diff(
  before: Record<string, string>,
  after: Record<string, string>,
): { moved: string[]; added: number } {
  const moved: string[] = [];
  let added = 0;
  for (const key of Object.keys(after)) if (!(key in before)) added += 1;
  for (const key of Object.keys(before)) {
    if (before[key] === after[key]) continue;
    if (key in ACCEPTED) continue;
    moved.push(`${key}: ${before[key]} -> ${after[key] ?? "(absent)"}`);
  }
  return { moved: moved.sort(), added };
}

/** Runs `compare` over a set of fingerprint maps and reports them as one. */
function compareAll(
  label: string,
  keys: readonly string[],
  baseline: Record<string, Record<string, string>>,
  after: Record<string, Record<string, string>>,
): string[] {
  const report: string[] = [];
  for (const key of keys) {
    const { changed, added, removed } = compare(baseline[key], after[key]);
    // eslint-disable-next-line no-console
    console.log(
      `W3I ${label} ${key}: ${Object.keys(after[key] ?? {}).length} nodes, ` +
        `${changed.length} changed, ${added} added, ${removed} removed`,
    );
    if (changed.length) report.push(`${key}:\n  ${changed.join("\n  ")}`);
  }
  return report;
}

test.describe("W3-I token convergence", () => {
  /*
 * A note on updating this baseline, because it will need updating again.
 *
 * This fingerprint is keyed by **selector text**, so any deliberate selector
 * refactor reads as "(absent)" even when nothing about the rendering changed.
 * That happened once already: S3-016 split `.shell-highlights button:focus-visible`
 * — a selector that caught both the cards inside the overflow track and the two
 * arrows outside it — into `-track` and `-controls`. The three declarations moved
 * to the new selectors unchanged, and all three *rendering* fingerprints stayed
 * at `0 changed`.
 *
 * So: the rendering fingerprints are what say whether users see a difference.
 * This one says whether the stylesheet still says the same things in the same
 * places. When they disagree, the rendering ones win, and this baseline gets
 * edited **entry by entry with the reason written down** — never regenerated
 * wholesale, which would silently absorb whatever else had drifted since.
 */
test("every shell declaration resolves to the value it resolved to before", async ({ page }) => {
    await open(page, "C6", { session: "fixes/W3-I" });
    const after = await declarations(page);
    settleBaseline("declarations", after);

    // Recorded, not asserted, when the baseline is being written — there is
    // nothing yet to compare against. Every other run compares.
    const baseline = WRITE ? after : readBaseline().declarations;
    const { moved, added } = diff(baseline, after);

    // eslint-disable-next-line no-console
    console.log(
      `W3I declarations: ${Object.keys(after).length} probed, ${moved.length} moved, ` +
        `${added} added, ${Object.keys(ACCEPTED).length} accepted`,
    );
    expect(moved, `resolved declaration values moved:\n${moved.join("\n")}`).toEqual([]);
  });

  test("every element under #shell renders the colours and sizes it rendered before", async ({ page }) => {
    const after: Record<string, Record<string, string>> = {};
    for (const combination of COMBINATIONS) {
      await open(page, combination, { session: "fixes/W3-I" });
      after[combination] = await fingerprint(page, "#shell");
    }
    settleBaseline("tree", after);

    const baseline = WRITE ? after : readBaseline().tree;
    const report = compareAll("tree", COMBINATIONS, baseline, after);
    expect(report, `rendered values moved:\n${report.join("\n")}`).toEqual([]);
  });

  test("the portalled menu renders the colours it rendered before", async ({ page }) => {
    // The menu is the one surface with no presence in the tree until it is
    // opened, and it owns five of the bare values this track removes.
    const combinations: Combination[] = ["C2", "C6", "C8"];
    const after: Record<string, Record<string, string>> = {};
    for (const combination of combinations) {
      await open(page, combination, { session: "fixes/W3-I" });
      await page.getByRole("button", { name: "Settings" }).first().click();
      await expect(page.locator(".shell-menu")).toBeVisible();
      after[combination] = await fingerprint(page, ".shell-menu");
      expect(
        Object.keys(after[combination]).length,
        `${combination}: the menu rendered no items`,
      ).toBeGreaterThan(3);
    }
    settleBaseline("menu", after);

    const baseline = WRITE ? after : readBaseline().menu;
    const report = compareAll("menu", combinations, baseline, after);
    expect(report, `menu values moved:\n${report.join("\n")}`).toEqual([]);
  });

  test("the state-only surfaces render the colours and sizes they rendered before", async ({ page }) => {
    // Two combinations, because Vite loads a stylesheet when the module that
    // imports it is first evaluated: `home.css` arrives with Home, `agent.css`
    // with the presence. Probing under both means every sheet this track edits
    // is present for at least one reading.
    const combinations: Combination[] = ["C2", "C6"];
    const after: Record<string, Record<string, string>> = {};
    for (const combination of combinations) {
      await open(page, combination, { session: "fixes/W3-I" });
      await page.evaluate((html: string) => {
        const host = document.createElement("div");
        host.id = "w3i-probe";
        host.setAttribute("style", "position:fixed;left:-99999px;top:0;width:900px");
        host.innerHTML = html;
        document.querySelector("#shell")!.appendChild(host);
      }, PROBE_HTML);
      after[combination] = await fingerprint(page, "#w3i-probe");

      // The probe is worthless if the rules it is meant to exercise are not
      // loaded, and an unstyled node produces a stable fingerprint that would
      // match a stale baseline forever. `.shell-task-spinner` is the reason
      // this test exists (see ACCEPTED), so it is the one asserted by name.
      const spinner = await page.locator("#w3i-probe .shell-task-spinner").first().evaluate((node) => {
        const s = getComputedStyle(node);
        return { top: s.borderTopColor, left: s.borderLeftColor, width: s.borderTopWidth };
      });
      expect(spinner, `${combination}: agent.css did not reach the probe`).toEqual({
        top: "rgb(116, 137, 151)",
        left: "rgb(213, 221, 226)",
        width: "2px",
      });
    }
    settleBaseline("probes", after);

    const baseline = WRITE ? after : readBaseline().probes;
    const report = compareAll("probes", combinations, baseline, after);
    expect(report, `state-only values moved:\n${report.join("\n")}`).toEqual([]);
  });
});
