/**
 * Wave 4b gate 6: a z-index comes from the ladder, and sorts where it claims to.
 *
 * Two findings, one gate, because neither half is worth much alone.
 *
 * The first half is the boring one. Before W3-I the shell's five z-indexes were
 * five literals in four stylesheets with no table anywhere, which is how
 * `.shell-menu` came to be 60 underneath a `.shell-presence` of 200 (S2-010):
 * 60 had always worked, because a menu opened inside the floating panel was a
 * DOM child of it and inherited the panel's own 200, so nobody had ever seen
 * the number fail until W1-A portalled menus out to `#shell` and made them
 * compare against the panel for the first time. A number picked without seeing
 * the others is the defect, so the assertion is not "the value is in this set"
 * but "the value is a `var(--shell-z-*)`" — which makes adding a rung an edit
 * to `tokens.css` and to the table below, rather than a line somebody writes.
 *
 * The second half is the one that actually bites. A ladder is only true inside
 * one stacking context, and `composer.css:5` opens another: `container-type:
 * inline-size` on `.shell-cx` applies layout containment per css-contain-3,
 * which means `.shell-cx-drop`'s 10 and `.shell-mention`'s 180 sort against
 * each other and against nothing else (S5-005). Printed in a table beside 200
 * and 300 those two numbers are a lie, and a gate that only checked membership
 * would bless them. So every z-index here has to name the context it sorts in,
 * the named context has to really open one — verified by re-reading the CSS,
 * not by trusting the claim — and the root rungs and the local rungs are
 * disjoint sets. That disjointness is the "intersection must be empty"
 * requirement stated as something a machine can check.
 *
 * **Known blind spots.**
 *
 * 1. **Containment comes from the DOM, and this reads CSS.** `.shell-mention`
 *    is inside `.shell-cx` because `Composer.tsx` renders it there; no amount
 *    of selector analysis recovers that, since these are flat BEM-ish names
 *    with no descendant combinators. So `context:` below is an *assertion made
 *    by a person*, and what the gate checks is that the assertion is internally
 *    consistent and that the CSS still supports it — not that it is true of the
 *    rendered tree. The complement belongs at run time: `elementFromPoint` on
 *    the centre of a panel, in `e2e/`. That is the right home for it and it is
 *    not written yet.
 * 2. **`@keyframes` blocks are skipped.** An element running a `transform`
 *    animation does open a stacking context while it runs, so the companion's
 *    seven keyframed transforms are a context that exists only during the
 *    animation. They are excluded because the alternative is registering
 *    seventeen keyframe steps whose stacking effect is transient and which have
 *    no positioned descendants; if a keyframed element ever wraps a z-index,
 *    this gate will not say so.
 * 3. **It sees stylesheets.** `attentionOverlay.ts` assigns `zIndex: "3"` to an
 *    element's inline style from TypeScript, which no CSS scan can reach. That
 *    one is registered below rather than left invisible, but the registry is a
 *    list of what was found, not a rule.
 * 4. The right long-term fix is not a cleverer scan of either kind: it is that
 *    `position` and `z-index` are set by one shared helper that takes a rung
 *    name, so there is no literal to find.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { opensStackingContext, parseCss, parseShellCss } from "./cssModel";

/**
 * The ladder, copied from `tokens.css` — and asserted equal to it below, so the
 * copy cannot drift. Three groups, because they answer three different
 * questions; see the long note in `tokens.css` for the argument.
 */
const LADDER: Record<string, string> = {
  // Root context: these compare directly against each other.
  "--shell-z-mode-switch": "1",
  "--shell-z-chrome": "3",
  "--shell-z-home-drop": "150",
  "--shell-z-presence": "200",
  "--shell-z-menu": "300",
  "--shell-z-viewer": "350",
  "--shell-z-gate": "400",
  // Composer-local: meaningful only inside `.shell-cx`.
  "--shell-z-cx-drop": "10",
  "--shell-z-cx-mention": "180",
  // Declared, not applied — `renderer/ui/styles/components.css` is shared with
  // the old renderer and is not this shell's to edit. They are on the ladder so
  // the 800-wide gap above 200 is visible rather than discovered by collision.
  "--shell-z-legacy-dialog": "1000",
  "--shell-z-legacy-popover": "1050",
  "--shell-z-legacy-toast": "1100",
  "--shell-z-legacy-tooltip": "1200",
};

const ROOT_RUNGS = [
  "--shell-z-mode-switch",
  "--shell-z-chrome",
  "--shell-z-home-drop",
  "--shell-z-presence",
  "--shell-z-menu",
  "--shell-z-viewer",
  "--shell-z-gate",
];

interface StackingContext {
  file: string;
  selector: string;
  property: string;
  /** z-index-bearing selectors that sort inside this context, not at the root. */
  traps: string[];
  /** Rungs that mean nothing outside it. Empty unless `traps` is non-empty. */
  localRungs: string[];
  why: string;
}

const LEAF = "a leaf control's own fade; it has no positioned descendants";
const MARK = "inside the companion mark, which is a drawing: SVG shapes only";

/**
 * Every declaration that opens a stacking context, in every stylesheet that
 * also declares a z-index.
 *
 * Scoped that way on purpose. Registering all nineteen openers in `src/shell`
 * would mean annotating `nav.css`'s drag fade, which can trap nothing because
 * nothing under the file tree is positioned — and a table that is mostly noise
 * is a table nobody re-reads when it matters. The cost of the narrower scope is
 * stated as blind spot 5 below: an opener in a stylesheet with no z-index of
 * its own could still wrap a z-index from another stylesheet. It does not
 * today — `app.css`, which owns every ancestor of the others, declares one
 * z-index of its own and no opener at all — and the guard below asserts that
 * stays true.
 */
const STACKING_CONTEXTS: StackingContext[] = [
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx",
    property: "container-type",
    traps: [".shell-cx-drop", ".shell-mention"],
    localRungs: ["--shell-z-cx-drop", "--shell-z-cx-mention"],
    why:
      "S5-005. `inline-size` is here for the composer's four container queries, " +
      "and layout containment comes with it whether or not anyone wanted it. " +
      "Both numbers inside are therefore composer-local; `.shell-cx` itself is " +
      "`z-index: auto`, so the composer as a whole sorts by document order.",
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-mention-enter",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF + " — the ⏎ hint in a mention row, a bare <span>",
  },
  {
    file: "src/shell/agent/agent.css",
    selector:
      '.shell-presence[data-expanded="false"][data-edge="left"], ' +
      '.shell-presence[data-expanded="false"][data-edge="right"], ' +
      '.shell-presence[data-expanded="false"][data-edge="top"], ' +
      '.shell-presence[data-expanded="false"][data-edge="bottom"]',
    property: "opacity",
    traps: [],
    localRungs: [],
    why:
      "This is the z-index element itself, tucked to an edge. An element's own " +
      "opacity opens a context for its descendants; it does not move where the " +
      "element's own z-index sorts, so `--shell-z-presence` still means 200 " +
      "against the window bar and the menu. What it does mean is that nothing " +
      "the companion draws can ever escape above it while it is tucked.",
  },
  {
    file: "src/shell/agent/agent.css",
    selector: '.shell-face[data-status="paused"] .shell-face-corner',
    property: "transform",
    traps: [],
    localRungs: [],
    why: MARK,
  },
  {
    file: "src/shell/agent/agent.css",
    selector: '.shell-face[data-status="paused"] .shell-face-corner',
    property: "opacity",
    traps: [],
    localRungs: [],
    why: MARK,
  },
  {
    file: "src/shell/agent/agent.css",
    selector: ".shell-face-limbs",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: MARK,
  },
  {
    file: "src/shell/agent/agent.css",
    selector: ".shell-face-gaze",
    property: "transform",
    traps: [],
    localRungs: [],
    why: MARK + " — the group the eyes track the cursor with",
  },
  {
    file: "src/shell/agent/agent.css",
    selector: '.shell-presence[data-expanded="false"][data-edge="left"] .shell-face',
    property: "transform",
    traps: [],
    localRungs: [],
    why: MARK,
  },
  {
    file: "src/shell/agent/agent.css",
    selector: '.shell-presence[data-expanded="false"][data-edge="right"] .shell-face',
    property: "transform",
    traps: [],
    localRungs: [],
    why: MARK,
  },
  {
    file: "src/shell/agent/agent.css",
    selector: '.shell-presence[data-expanded="false"][data-edge="top"] .shell-face',
    property: "transform",
    traps: [],
    localRungs: [],
    why: MARK,
  },
  {
    file: "src/shell/agent/agent.css",
    selector: '.shell-presence[data-expanded="false"][data-edge="bottom"] .shell-face',
    property: "transform",
    traps: [],
    localRungs: [],
    why: MARK,
  },
  {
    file: "src/shell/agent/agent.css",
    selector: ".shell-presence-face:hover .shell-face svg",
    property: "transform",
    traps: [],
    localRungs: [],
    why: MARK,
  },
  {
    file: "src/shell/agent/agent.css",
    selector: ".shell-presence-face",
    property: "filter",
    traps: [],
    localRungs: [],
    why:
      "drop-shadow on the collapsed mark's button. It wraps the mark and the " +
      "mark only — the expanded panel's children are siblings of this button, " +
      "not descendants — so the 200 above it is unaffected.",
  },
  {
    file: "src/shell/agent/agent.css",
    selector: ".shell-presence-face:hover",
    property: "filter",
    traps: [],
    localRungs: [],
    why: "the hover half of the same drop-shadow",
  },
  {
    file: "src/shell/agent/agent.css",
    selector: ".shell-task-button:disabled",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF,
  },
  {
    file: "src/shell/chrome/chrome.css",
    selector: ".shell-share:active",
    property: "filter",
    traps: [],
    localRungs: [],
    why: LEAF + " — a pressed <button> with a label inside it",
  },
  {
    file: "src/shell/chrome/chrome.css",
    selector: ".shell-window-glyph",
    property: "transform",
    traps: [],
    localRungs: [],
    why: "the ×/–/+ glyph centred inside a traffic light, a leaf <span>",
  },
  {
    file: "src/shell/chrome/chrome.css",
    selector: ".shell-window-glyph",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: "the same glyph, hidden until the controls are hovered",
  },
  {
    file: "src/shell/chrome/chrome.css",
    selector: ".shell-tabstrip-scroll:disabled",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF,
  },
  {
    file: "src/shell/chrome/chrome.css",
    selector: ".shell-tab-close",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF,
  },
  {
    file: "src/shell/chrome/chrome.css",
    selector: ".shell-tab-bookmark",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF,
  },
  {
    file: "src/shell/chrome/chrome.css",
    selector: ".shell-save-state:disabled",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF,
  },
  {
    file: "src/shell/image/imageViewer.css",
    selector:
      '.shell-image-viewer[data-loaded="false"] .shell-image-viewer-picture, ' +
      '.shell-image-viewer[data-phase="leaving"][data-flying="false"] .shell-image-viewer-picture',
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF + " — the viewer's <img>, hidden until its bytes decode",
  },
  {
    file: "src/shell/image/imageViewer.css",
    selector:
      '.shell-image-viewer[data-phase="entering"] .shell-image-viewer-bar, ' +
      '.shell-image-viewer[data-phase="entering"] .shell-image-viewer-zoom, ' +
      '.shell-image-viewer[data-phase="entering"] .shell-image-viewer-step, ' +
      '.shell-image-viewer[data-phase="leaving"] .shell-image-viewer-bar, ' +
      '.shell-image-viewer[data-phase="leaving"] .shell-image-viewer-zoom, ' +
      '.shell-image-viewer[data-phase="leaving"] .shell-image-viewer-step',
    property: "opacity",
    traps: [],
    localRungs: [],
    why:
      "the viewer's chrome fading with its backdrop. The bars hold buttons and " +
      "one absolutely placed title, none with a z-index, all inside the " +
      "viewer's own context already.",
  },
  {
    file: "src/shell/image/imageViewer.css",
    selector: '.shell-image-viewer-hint[data-shown="false"]',
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF + " — the viewer's one-line \"Esc to close\" hint, a bare <p>",
  },
  {
    file: "src/shell/chrome/menu.css",
    selector: ".shell-menu-item:disabled",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF + " — a row inside the panel, below the panel's own z-index",
  },
];

interface ZIndexSite {
  file: string;
  selector: string;
  /** The rung it must resolve to. */
  rung: string;
  /** `"root"`, or the selector of the context it sorts inside. */
  context: string;
  /**
   * Set when the stylesheet still writes the number instead of the token.
   * Every one of these is somebody's debt and says whose, and what deletes it.
   */
  debt?: { owedBy: string; until: string };
  note?: string;
}

const Z_INDEX_SITES: ZIndexSite[] = [
  {
    file: "src/shell/app.css",
    selector: '#shell[data-mode-switching="true"] .shell-agent',
    rung: "--shell-z-mode-switch",
    context: "root",
    note:
      "Only while a mode change is in flight. The same rule set pins " +
      "`.shell-workspace` out of flow so the embedded editor is laid out once " +
      "rather than on every frame, and a positioned element paints above its " +
      "in-flow siblings — this is the one rung that keeps the docked column " +
      "visible while it opens or closes. It sorts at the root because nothing " +
      "between it and `#shell` opens a stacking context; `.shell-row--body` " +
      "and `.shell` are both plain boxes.",
  },
  {
    file: "src/shell/chrome/chrome.css",
    selector: ".shell-windowbar",
    rung: "--shell-z-chrome",
    context: "root",
  },
  {
    file: "src/shell/chrome/newTaskMenu.css",
    selector: ".shell-new-task-menu",
    rung: "--shell-z-menu",
    context: "root",
    note:
      "Agent mode's New task grid. A menu in everything but shape, portalled to " +
      "`#shell` like `.shell-menu`, so it shares that rung.",
  },
  {
    file: "src/shell/image/composer/imagePopover.css",
    selector: ".shell-ig-popover",
    rung: "--shell-z-menu",
    context: "root",
    note:
      "The image tools' settings panels. Portalled to `#shell`; never open at the " +
      "same time as a menu, since opening either closes the other on pointerdown.",
  },
  {
    file: "src/shell/chrome/menu.css",
    selector: ".shell-menu",
    rung: "--shell-z-menu",
    context: "root",
    note:
      "Root only since W1-A portalled it to `#shell`. Before that it was a DOM " +
      "child of whatever opened it, which is why 60 survived under a panel of 200.",
  },
  {
    file: "src/shell/agent/agent.css",
    selector: ".shell-presence",
    rung: "--shell-z-presence",
    context: "root",
  },
  {
    file: "src/shell/home/home.css",
    selector: ".shell-home-drop",
    rung: "--shell-z-home-drop",
    context: "root",
    note:
      "Editor Home's \"drop to open\" overlay, shown only while files from the " +
      "desktop are dragged over the page. `position: fixed` and a sibling of " +
      "Home's content inside `#shell`, which opens no stacking context, so it " +
      "sorts at the root: above the window bar it never overlaps anyway, below " +
      "the floating agent, which is not a place a file can be dropped.",
  },
  {
    file: "src/shell/account/account.css",
    selector: ".shell-account",
    rung: "--shell-z-gate",
    context: "root",
    note:
      "The account page, covering the window while the user signs in. It is a " +
      "sibling of every shell region inside `#shell`, and `#shell` opens no " +
      "stacking context of its own, so it sorts at the root — and it has to " +
      "sort above `--shell-z-menu`, because the control that opens it lives " +
      "inside the sidebar's menu. Below `--shell-z-legacy-toast` on purpose: " +
      "the page copies the verification URL to the clipboard, and that " +
      "confirmation is worthless if the page hides it.",
  },
  {
    file: "src/shell/image/imageViewer.css",
    selector: ".shell-image-viewer",
    rung: "--shell-z-viewer",
    context: "root",
    note:
      "The full-window picture viewer, portalled to `#shell`. Above the menus: " +
      "it is opened by a click on the canvas, which closes any open menu on " +
      "pointerdown, and nothing inside it opens one. Below the account page, " +
      "and below the legacy toast host so Download's confirmation stays visible.",
  },
  {
    file: "src/shell/settings/settings.css",
    selector: ".shell-settings",
    rung: "--shell-z-gate",
    context: "root",
    note:
      "The settings page, covering the window while the user works through it. " +
      "A sibling of every region inside `#shell`, which opens no stacking " +
      "context of its own, so it sorts at the root. It takes the same rung as " +
      "the account page rather than a new one because the two are never on " +
      "screen together: the provider section's sign-in link closes this page " +
      "before it opens that one, and both are opened from the same sidebar " +
      "footer. Below `--shell-z-legacy-toast` for the same reason the account " +
      "page is — every change on this page confirms itself with a toast, and a " +
      "confirmation the page hides is worthless.",
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx-drop",
    rung: "--shell-z-cx-drop",
    context: ".shell-cx",
    debt: {
      owedBy: "whoever owns src/shell/composer — it was under concurrent edit all of Wave 4",
      until:
        "the line reads `z-index: var(--shell-z-cx-drop)`. The token was built " +
        "for it in W3-I (c9cdf6f) and holds this exact value; see W3-I.md §3.3. " +
        "Delete this `debt` field then — the site itself stays registered.",
    },
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-mention",
    rung: "--shell-z-cx-mention",
    context: ".shell-cx",
    debt: {
      owedBy: "whoever owns src/shell/composer — it was under concurrent edit all of Wave 4",
      until:
        "the line reads `z-index: var(--shell-z-cx-mention)`. Same token, same " +
        "commit, same paragraph of W3-I.md §3.3.",
    },
  },
];

/**
 * Style literals assigned from TypeScript, where no CSS gate can see them.
 *
 * Not an exemption so much as a note that the hole exists and how big it is
 * right now. `attentionOverlay.ts` builds its SVG imperatively and styles it
 * with `Object.assign(el.style, …)`, so its `zIndex: "3"` — numerically the
 * window bar's rung, written as a string — and its four gradient stops are
 * outside every stylesheet in the repository. Asserted in both directions, so
 * the count cannot grow quietly and a fix must delete the entry.
 */
const KNOWN_STYLE_LITERALS: Record<string, { zIndex: number; colours: number; why: string }> = {
  "src/shell/agent/attentionOverlay.ts": {
    zIndex: 1,
    colours: 4,
    why:
      "The attention frame is drawn, not styled: a four-stop rainbow gradient " +
      "that exists to be unmistakably not-the-document, and a zIndex of 3 " +
      "inside whichever host it is mounted in. The colours are the prototype's " +
      "and belong to the effect rather than the palette; the 3 is the thing " +
      "worth moving, because it is `--shell-z-chrome` spelled as a string.",
  },
};

const shellCss = parseShellCss("src/shell");
const zIndexes = shellCss.filter((declaration) => declaration.property === "z-index");
const rungPattern = /^var\(\s*(--shell-z-[a-z-]+)\s*\)$/;
const key = (file: string, selector: string) => `${file}  ${selector}`;

function shellSources(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      out.push(...shellSources(path));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) out.push(path);
  }
  return out;
}

describe("the z-index ladder", () => {
  it("is exactly the set tokens.css declares", () => {
    const declared = Object.fromEntries(
      parseCss("src/shell/tokens.css")
        .filter((declaration) => declaration.property.startsWith("--shell-z-"))
        .map((declaration) => [declaration.property, declaration.value]),
    );
    // Both directions. A new rung in tokens.css that nobody added here is a
    // value that entered the stack without anybody choosing where it sits; an
    // entry here that tokens.css dropped is a rung this gate would keep
    // accepting after it stopped existing.
    expect(declared).toEqual(LADDER);
  });

  it("supplies every z-index in the shell's stylesheets", () => {
    const offenders: string[] = [];
    for (const declaration of zIndexes) {
      const site = Z_INDEX_SITES.find(
        (candidate) =>
          candidate.file === declaration.file && candidate.selector === declaration.selector,
      );
      const rung = rungPattern.exec(declaration.value)?.[1];
      if (rung) {
        if (rung !== site?.rung) {
          offenders.push(`${declaration.file}:${declaration.line} ${declaration.selector} -> ${rung}`);
        }
        continue;
      }
      // A literal is allowed only where a registered debt says so, and only at
      // the value its rung holds — so the number cannot drift while the token
      // is owed.
      if (site?.debt && declaration.value === LADDER[site.rung]) continue;
      offenders.push(
        `${declaration.file}:${declaration.line} ${declaration.selector} -> ${declaration.value}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("names, for every z-index, the stacking context it sorts in", () => {
    // Registration in both directions: an unregistered z-index is a number
    // chosen without looking at the ladder, and a registered site whose rule is
    // gone is a row that will outlive the thing it describes.
    expect(zIndexes.map((declaration) => key(declaration.file, declaration.selector)).sort()).toEqual(
      Z_INDEX_SITES.map((site) => key(site.file, site.selector)).sort(),
    );
  });

  it("keeps root rungs and context-local rungs disjoint", () => {
    const trapped = new Map<string, StackingContext>();
    for (const context of STACKING_CONTEXTS) {
      for (const selector of context.traps) trapped.set(key(context.file, selector), context);
    }

    const problems: string[] = [];
    for (const site of Z_INDEX_SITES) {
      const inside = trapped.get(key(site.file, site.selector));
      if (site.context === "root") {
        // The intersection assertion, stated literally: nothing that claims the
        // root may also be listed inside a context.
        if (inside) {
          problems.push(`${site.selector} claims root but ${inside.selector} contains it`);
        }
        if (!ROOT_RUNGS.includes(site.rung)) {
          problems.push(`${site.selector} sorts at the root on the local rung ${site.rung}`);
        }
        continue;
      }
      if (!inside || inside.selector !== site.context) {
        problems.push(`${site.selector} names ${site.context}, which does not list it`);
        continue;
      }
      if (!inside.localRungs.includes(site.rung)) {
        problems.push(`${site.selector} is inside ${site.context} but uses ${site.rung}`);
      }
      if (ROOT_RUNGS.includes(site.rung)) {
        problems.push(`${site.selector} is inside ${site.context} but uses the root rung ${site.rung}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("accounts for every stacking context in a stylesheet that has a z-index", () => {
    const files = new Set(zIndexes.map((declaration) => declaration.file));
    const found = shellCss.filter(
      (declaration) =>
        files.has(declaration.file) &&
        // `@keyframes` steps style the animated element over time rather than a
        // box in the tree; see blind spot 2.
        !declaration.atRules.some((rule) => rule.startsWith("@keyframes")) &&
        opensStackingContext(declaration),
    );

    const unaccounted = found
      .filter(
        (declaration) =>
          // A local `/* stacking-context: … */` note counts, so a stylesheet's
          // owner can answer in their own file instead of editing this one.
          !declaration.notes.some((note) => note.includes("stacking-context:")) &&
          !STACKING_CONTEXTS.some(
            (context) =>
              context.file === declaration.file &&
              context.selector === declaration.selector &&
              context.property === declaration.property,
          ),
      )
      .map((declaration) => `${declaration.file}:${declaration.line} ${declaration.selector} { ${declaration.text} }`);
    expect(unaccounted).toEqual([]);

    // And the other way: a registered context whose declaration is gone is a
    // reason that outlived its cause.
    const stale = STACKING_CONTEXTS.filter(
      (context) =>
        !found.some(
          (declaration) =>
            declaration.file === context.file &&
            declaration.selector === context.selector &&
            declaration.property === context.property,
        ),
    ).map((context) => `${context.file}  ${context.selector} { ${context.property} }`);
    expect(stale).toEqual([]);
  });

  it("is not quietly bypassed by a stylesheet that declares no z-index of its own", () => {
    // The narrow scope above is only safe while no *other* shell stylesheet
    // wraps one of the registered z-indexes. `app.css` owns every ancestor of
    // the window bar, the panel and the composer, and is now inside the scan
    // itself because it declares one; if any remaining z-index-free sheet
    // grows an opener, that assumption needs re-checking by hand.
    const files = new Set(zIndexes.map((declaration) => declaration.file));
    const elsewhere = shellCss
      .filter(
        (declaration) =>
          !files.has(declaration.file) &&
          declaration.file !== "src/shell/tokens.css" &&
          !declaration.atRules.some((rule) => rule.startsWith("@keyframes")) &&
          opensStackingContext(declaration),
      )
      .map((declaration) => `${declaration.file}  ${declaration.selector} { ${declaration.property} }`)
      .sort();

    // nav.css and home/*.css fade and translate leaf controls. None of them is
    // an ancestor of anything positioned; the list is pinned so a new one has
    // to be looked at rather than absorbed. Keyed by selector, never by line —
    // `composer.css` moved sixty-seven lines while these gates were written.
    expect([...new Set(elsewhere)]).toEqual([
      "src/shell/agent/odMark.css  .od-mark { filter }",
      "src/shell/agent/odMark.css  .od-mark__eye i { transform }",
      "src/shell/agent/odMark.css  .od-mark__eye { transform }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-badge { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-badge { transform }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-chart .bar { transform }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-chart .line circle { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-cursor .arrow { filter }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-cursor .label { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-cursor .ripple { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-cursor { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-eyebrow { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-eyebrow { transform }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-figure { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-figure { transform }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-list li i { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-panel { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-panel { transform }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-pill { transform }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-rule { opacity }",
      "src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen-scan { opacity }",
      'src/shell/editor/slidesGenerating/slidesGenerating.css  .shell-gen[data-phase="drawing"] .shell-gen-chart .bar, .shell-gen[data-phase="polish"] .shell-gen-chart .bar { transform }',
      "src/shell/home/highlights.css  .shell-highlight-play { transform }",
      "src/shell/home/highlights.css  .shell-highlights-controls button:disabled { opacity }",
      // The image composer's leaf controls: a tilted "add" sheet, a close
      // button that fades in on hover, disabled tools, a switch knob, a chevron.
      // None of them is an ancestor of anything positioned.
      'src/shell/image/composer/imageComposer.css  .shell-ig-camera-grid[data-muted="true"] { opacity }',
      "src/shell/image/composer/imageComposer.css  .shell-ig-mode-close { opacity }",
      'src/shell/image/composer/imageComposer.css  .shell-ig-reference > span[aria-hidden="true"] { opacity }',
      "src/shell/image/composer/imageComposer.css  .shell-ig-reference-add:hover:not(:disabled) .shell-ig-reference-sheet { transform }",
      "src/shell/image/composer/imageComposer.css  .shell-ig-reference-sheet { transform }",
      'src/shell/image/composer/imageComposer.css  .shell-ig-switch[aria-checked="true"] > span { transform }',
      "src/shell/image/composer/imageComposer.css  .shell-ig-tool:disabled, .shell-ig-mode-close:disabled { opacity }",
      'src/shell/image/composer/imageComposer.css  .shell-ig-tool[aria-expanded="true"] > .shell-ig-chevron { transform }',
      "src/shell/image/imageWorkspace.css  .shell-image-action:disabled { opacity }",
      'src/shell/nav/nav.css  .shell-tree-file-row.is-dragging, .shell-list tbody tr.is-dragging { opacity }',
      'src/shell/nav/nav.css  .shell-tree-file-row[draggable="true"]:active { opacity }',
      "src/shell/nav/nav.css  .shell-tree-folder-add, .shell-tree-file-more { transform }",
      "src/shell/nav/nav.css  .shell-tree-folder-row:hover .shell-tree-folder-toggle > small { opacity }",
      'src/shell/nav/nav.css  .shell-tree-folder-toggle[aria-expanded="true"] .shell-tree-chevron { transform }',
    ]);
  });

  it("counts the style literals TypeScript writes past it", () => {
    const found: Record<string, { zIndex: number; colours: number }> = {};
    for (const path of shellSources("src/shell")) {
      const source = readFileSync(path, "utf8");
      const zIndex = source.match(/\bzIndex\s*:/g)?.length ?? 0;
      const colours = source.match(/#[0-9a-fA-F]{6}\b/g)?.length ?? 0;
      if (zIndex || colours) found[path] = { zIndex, colours };
    }
    expect(found).toEqual(
      Object.fromEntries(
        Object.entries(KNOWN_STYLE_LITERALS).map(([path, entry]) => [
          path,
          { zIndex: entry.zIndex, colours: entry.colours },
        ]),
      ),
    );
  });

  it("finds the declarations it is meant to be checking", () => {
    // A drift that parsed nothing would satisfy every assertion above.
    expect(zIndexes.length).toBeGreaterThanOrEqual(5);
    expect(shellCss.length).toBeGreaterThan(800);
  });
});
