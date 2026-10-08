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
 * **OD-UI-1.2.** There are two ladders in one document now: the design's
 * (`--dx-z-*`, 1–200, plus the input glow at 10000) and the one the surfaces the
 * design keeps as they were already used (`--shell-z-menu` 300, `-viewer` 350,
 * `-gate` 400). They share the root context — `#shell` and `#dx-workspace` open
 * none — so they are one table here, and the order between them is a decision:
 * the image tools' menus, the picture viewer and the account page cover the
 * workspace, its menus and its notice. The `context:` column below was filled
 * in from a browser, by walking up from each z-indexed element to the nearest
 * ancestor that opens a stacking context, rather than from reading selectors.
 * That is how `.dx-window-controls` (30) turned out to sort inside
 * `#dx-global-controls` (45) and not against the sidebar beside it.
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

const V11 = "src/shell/styles/workspace-v11.css";
const V12 = "src/shell/styles/workspace-v12.css";
const ATTENTION = "src/shell/styles/attention.css";

/**
 * The ladder, copied from `tokens.css` — and asserted equal to it below, so the
 * copy cannot drift. See the notes in `tokens.css` for the argument behind each
 * group.
 */
const LADDER: Record<string, string> = {
  // The design's rungs (OD-UI-1.2 §05): content → sticky tools → Dex and
  // floating panels → menus and tips.
  "--dx-z-raised": "1",
  "--dx-z-raised-2": "2",
  "--dx-z-modal-head": "2",
  "--dx-z-sidebar": "15",
  "--dx-z-splitter": "20",
  "--dx-z-dex": "22",
  "--dx-z-dex-panel": "23",
  "--dx-z-dex-open": "24",
  "--dx-z-chat-overlay": "25",
  "--dx-z-window-controls": "30",
  "--dx-z-chat-floating": "30",
  "--dx-z-workspace-toggle": "35",
  "--dx-z-sidebar-peek": "40",
  "--dx-z-drop": "40",
  "--dx-z-global-controls": "45",
  "--dx-z-flyout": "45",
  "--dx-z-menu": "60",
  "--dx-z-popover": "70",
  "--dx-z-tooltip": "90",
  "--dx-z-agent-effects": "110",
  "--dx-z-flight": "120",
  "--dx-z-notice": "200",
  "--dx-z-input-glow": "10000",
  // The surfaces the design keeps as they were. Root context, above the design's.
  "--shell-z-menu": "300",
  "--shell-z-viewer": "350",
  "--shell-z-gate": "400",
  // Composer-local: meaningful only inside `.shell-cx`.
  "--shell-z-cx-drop": "10",
  // Declared, not applied — `renderer/ui/styles/components.css` is shared with
  // the old renderer and is not this shell's to edit.
  "--shell-z-legacy-dialog": "1000",
  "--shell-z-legacy-popover": "1050",
  "--shell-z-legacy-toast": "1100",
  "--shell-z-legacy-tooltip": "1200",
};

/** Rungs that mean something only inside the context that holds them. */
const LOCAL_RUNGS = ["--dx-z-raised-2", "--dx-z-modal-head", "--dx-z-window-controls", "--shell-z-cx-drop"];

const ROOT_RUNGS = Object.keys(LADDER).filter(
  (rung) => !LOCAL_RUNGS.includes(rung) && !rung.startsWith("--shell-z-legacy-"),
);

interface Site {
  file: string;
  selector: string;
}

interface StackingContext extends Site {
  /**
   * What opens it. A CSS property that does so by itself, `z-index` for a
   * positioned element whose own rung makes it a context for what is inside
   * it, or `top-layer` for the dialog, which the browser lifts out of the page.
   */
  property: string;
  /** z-index-bearing rules that sort inside this context, not at the root. */
  traps: Site[];
  /** Rungs that mean nothing outside it. Empty unless `traps` is non-empty. */
  localRungs: string[];
  why: string;
}

const LEAF = "a leaf control's own fade; it has no positioned descendants";
const REVEAL = "a row's own button, hidden until the row is hovered or focused; " + LEAF;
const EFFECT =
  "inside the agent's work cursor, which is a drawing laid over the document: " +
  "the pointer and its tag flip to stay inside the frame, and neither holds anything";
const DEX_ITSELF =
  "This is the z-index element itself, turned to sit on an edge. An element's own " +
  "transform opens a context for what is inside it — the bubble's two pseudo-elements " +
  "— and does not move where the bubble's own rung sorts.";

/**
 * Every declaration that opens a stacking context, in every stylesheet that
 * also declares a z-index — plus the three contexts that are opened by a rung
 * or by the browser rather than by a property, because those are the ones that
 * actually trap something.
 *
 * Scoped to stylesheets with a z-index on purpose; the guard further down pins
 * the openers everywhere else so a new one has to be looked at.
 */
const STACKING_CONTEXTS: StackingContext[] = [
  // ---- contexts that trap a rung ------------------------------------------
  {
    file: V12,
    selector: "#dx-global-controls",
    property: "z-index",
    traps: [{ file: V11, selector: ".dx-window-controls" }],
    localRungs: ["--dx-z-window-controls"],
    why:
      "The 244 × 40 band that holds the traffic lights, the sidebar toggle and the " +
      "Home tab is positioned with a rung of its own (45), so the 30 on the group " +
      "inside it sorts against its siblings in the band and nothing else. Measured: " +
      "its nearest stacking ancestor is this element, not the root.",
  },
  {
    file: V11,
    selector: ".dx-dex",
    property: "z-index",
    traps: [{ file: V12, selector: "#dx-workspace .dx-dex::before, #dx-workspace .dx-dex::after" }],
    localRungs: ["--dx-z-raised-2"],
    why:
      "The bubble is positioned on the Dex rung, which makes it a context for its " +
      "two pseudo-elements — the halo it shows while a run is working. Their 2 " +
      "lifts them over the drawing inside the bubble and means nothing outside it.",
  },
  {
    file: ATTENTION,
    selector: ".dx-od-agent-effects",
    property: "z-index",
    traps: [{ file: ATTENTION, selector: ".dx-od-agent-effects .dx-agent-work-cursor" }],
    localRungs: ["--dx-z-raised-2"],
    why:
      "The layer the agent's target frame, draft and work cursor are drawn in: " +
      "fixed, view-only, on its own rung. The cursor's 2 puts it over the frame " +
      "and the draft inside that layer.",
  },
  {
    file: V11,
    selector: "#dx-modal",
    property: "top-layer",
    traps: [{ file: V11, selector: ".dx-modal-head" }],
    localRungs: ["--dx-z-modal-head"],
    why:
      "A `<dialog>` opened with `showModal()` is in the browser's top layer: above " +
      "every z-index in the page, this ladder's and the component library's alike. " +
      "Its sticky header's 2 keeps the title over the body scrolling under it.",
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx",
    property: "container-type",
    traps: [{ file: "src/shell/composer/composer.css", selector: ".shell-cx-drop" }],
    localRungs: ["--shell-z-cx-drop"],
    why:
      "S5-005. `inline-size` is here for the image composer's container queries, " +
      "and layout containment comes with it whether or not anyone wanted it. The " +
      "drop target inside is therefore composer-local; `.shell-cx` itself is " +
      "`z-index: auto`, so the composer as a whole sorts by document order.",
  },
  {
    file: V11,
    selector: ".dx-composer",
    property: "container-type",
    traps: [],
    localRungs: [],
    why:
      "The same containment, on the design's composer, for the same reason. It " +
      "traps nothing because nothing inside it has a rung: the @ list and the " +
      "model menu are drawn in `#dx-layers`, outside it, which is what lets them " +
      "open over the conversation instead of being clipped to the composer.",
  },

  // ---- the z-index element's own transform or opacity ---------------------
  {
    file: V11,
    selector: "#dx-notice",
    property: "transform",
    traps: [],
    localRungs: [],
    why: "the notice centring itself; it is the z-index element and holds one line of text",
  },
  {
    file: V11,
    selector: "#dx-notice",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: "the same notice, invisible until it has something to say",
  },
  { file: V12, selector: "#dx-workspace .dx-dex[data-edge=left]", property: "transform", traps: [], localRungs: [], why: DEX_ITSELF },
  { file: V12, selector: "#dx-workspace .dx-dex[data-edge=right]", property: "transform", traps: [], localRungs: [], why: DEX_ITSELF },
  { file: V12, selector: "#dx-workspace .dx-dex[data-edge=top]", property: "transform", traps: [], localRungs: [], why: DEX_ITSELF },
  {
    file: V12,
    selector: "#dx-workspace .dx-dex[aria-expanded=true]",
    property: "transform",
    traps: [],
    localRungs: [],
    why:
      "The bubble riding the corner of its open panel, scaled down. Still the " +
      "z-index element itself: `--dx-z-dex-open` sorts at the root, one above the panel.",
  },
  {
    file: V12,
    selector: "#dx-workspace .dx-dex::before, #dx-workspace .dx-dex::after",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: "the halo's two rings, invisible until a run is working; pseudo-elements hold nothing",
  },

  // ---- leaves -------------------------------------------------------------
  {
    file: V11,
    selector: 'button:where([data-ui-scope="officedex"], [data-ui-scope="officedex"] *):disabled',
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF + " — every disabled button in the workspace",
  },
  { file: V11, selector: ".dx-project-row .dx-more, .dx-chat-tree .dx-more", property: "opacity", traps: [], localRungs: [], why: REVEAL },
  { file: V11, selector: ".dx-project-row>.dx-ib, .dx-chat-tree>.dx-ib", property: "opacity", traps: [], localRungs: [], why: REVEAL },
  { file: V12, selector: ".dx-file-tab>.dx-ib", property: "opacity", traps: [], localRungs: [], why: REVEAL },
  { file: V12, selector: "#dx-workspace .dx-file-tab>.dx-ib", property: "opacity", traps: [], localRungs: [], why: REVEAL },
  { file: V12, selector: ".dx-asset-line>.dx-ib", property: "opacity", traps: [], localRungs: [], why: REVEAL },
  { file: V12, selector: "#dx-conversation .dx-asset-line>.dx-ib", property: "opacity", traps: [], localRungs: [], why: REVEAL },
  {
    file: V11,
    selector: ".dx-swap",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF + " — the swap button on the divider, shown while the divider is hovered or focused",
  },
  {
    file: V11,
    selector: ".dx-file-tab .dx-bookmark:not(.dx-bookmarked)",
    property: "opacity",
    traps: [],
    localRungs: [],
    why: LEAF + " — a tab's favourite mark",
  },
  {
    file: V12,
    selector: "#dx-workspace .dx-file-tab .dx-tab-dex-watermark",
    property: "opacity",
    traps: [],
    localRungs: [],
    why:
      "The Dex watermark behind a conversation tab's title, at 5.5%. It holds one " +
      "image; the title and the close button beside it carry `--dx-z-raised` " +
      "precisely so they paint over it, and they are its siblings, not inside it.",
  },
  {
    file: V12,
    selector: ".dx-agent-process[open]>summary>.dx-icon, .dx-agent-tool[open]>summary>.dx-icon",
    property: "transform",
    traps: [],
    localRungs: [],
    why: LEAF + " — a disclosure's chevron, turned when it is open",
  },
  {
    file: V12,
    selector: ".dx-agent-jump",
    property: "transform",
    traps: [],
    localRungs: [],
    why: LEAF + " — \"Latest update ↓\", centring itself over the composer",
  },
  { file: ATTENTION, selector: ".dx-od-agent-effects .dx-agent-work-pointer", property: "filter", traps: [], localRungs: [], why: EFFECT },
  { file: ATTENTION, selector: ".dx-od-agent-effects [data-corner=tr] .dx-agent-work-pointer", property: "transform", traps: [], localRungs: [], why: EFFECT },
  { file: ATTENTION, selector: ".dx-od-agent-effects [data-corner=bl] .dx-agent-work-pointer", property: "transform", traps: [], localRungs: [], why: EFFECT },
  { file: ATTENTION, selector: ".dx-od-agent-effects [data-corner=br] .dx-agent-work-pointer", property: "transform", traps: [], localRungs: [], why: EFFECT },
  { file: ATTENTION, selector: ".dx-od-agent-effects [data-corner=tr] .dx-agent-work-tag", property: "transform", traps: [], localRungs: [], why: EFFECT },
  { file: ATTENTION, selector: ".dx-od-agent-effects [data-corner=bl] .dx-agent-work-tag", property: "transform", traps: [], localRungs: [], why: EFFECT },
  { file: ATTENTION, selector: ".dx-od-agent-effects [data-corner=br] .dx-agent-work-tag", property: "transform", traps: [], localRungs: [], why: EFFECT },
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

interface ZIndexSite extends Site {
  /** The rung it must resolve to. */
  rung: string;
  /** `"root"`, or the selector of the context it sorts inside. */
  context: string;
  note?: string;
}

const Z_INDEX_SITES: ZIndexSite[] = [
  // ---- the design's workspace, bottom to top ------------------------------
  {
    file: V12,
    selector: "#dx-workspace .dx-file-tab .dx-tab-title, #dx-workspace .dx-file-tab>.dx-ib",
    rung: "--dx-z-raised",
    context: "root",
    note:
      "A tab's title and close button, lifted over the watermark behind them. " +
      "Measured at the root: nothing between a tab and `#shell` opens a context, " +
      "so this 1 does compare against the sidebar's 15 — and loses, which is " +
      "right, since the hover-shown sidebar is drawn over the tab strip.",
  },
  { file: V11, selector: "#dx-sidebar", rung: "--dx-z-sidebar", context: "root" },
  { file: V11, selector: "#dx-splitter", rung: "--dx-z-splitter", context: "root" },
  {
    file: V11,
    selector: ".dx-dex",
    rung: "--dx-z-dex",
    context: "root",
    note: "Inside `.dx-editor-wrapper`, which is a plain positioned box and opens nothing.",
  },
  { file: V11, selector: ".dx-dex-panel", rung: "--dx-z-dex-panel", context: "root" },
  {
    file: V12,
    selector: "#dx-workspace .dx-dex[aria-expanded=true]",
    rung: "--dx-z-dex-open",
    context: "root",
    note: "One above its own panel, whose corner it sits on while the panel is open.",
  },
  {
    file: V11,
    selector: "#dx-workspace.dx-with-chat #dx-conversation",
    rung: "--dx-z-chat-overlay",
    context: "root",
    note:
      "Windows under 900px: the conversation is laid over the content region " +
      "rather than beside it. Above Dex, which belongs to the document underneath.",
  },
  {
    file: V12,
    selector: "#dx-workspace.dx-chat-floating #dx-conversation",
    rung: "--dx-z-chat-floating",
    context: "root",
  },
  { file: V12, selector: "#dx-workspace-toggle", rung: "--dx-z-workspace-toggle", context: "root" },
  {
    file: V12,
    selector: "#dx-workspace.dx-compact #dx-sidebar",
    rung: "--dx-z-sidebar-peek",
    context: "root",
    note:
      "The hidden sidebar, shown while the pointer is at the window's edge. Over " +
      "the conversation and the workspace toggle; under the band of global controls, " +
      "which stays where it is while the sidebar comes and goes beneath it.",
  },
  {
    file: V11,
    selector: ".dx-drop-active:after",
    rung: "--dx-z-drop",
    context: "root",
    note: "\"Drop to open\", drawn over whichever region a file is being dragged across.",
  },
  { file: V12, selector: "#dx-global-controls", rung: "--dx-z-global-controls", context: "root" },
  {
    file: V12,
    selector: "#dx-feature-flyout",
    rung: "--dx-z-flyout",
    context: "root",
    note: "Hot and fresh features, opened from the gift button away from Home.",
  },
  {
    file: V11,
    selector: ".dx-menu",
    rung: "--dx-z-menu",
    context: "root",
    note: "Drawn in `#dx-layers`, a child of `#shell`, never inside what opened it.",
  },
  { file: V12, selector: ".dx-new-popover", rung: "--dx-z-popover", context: "root" },
  { file: V12, selector: ".dx-control-tooltip", rung: "--dx-z-tooltip", context: "root" },
  {
    file: ATTENTION,
    selector: ".dx-od-agent-effects",
    rung: "--dx-z-agent-effects",
    context: "root",
  },
  {
    file: V12,
    selector: ".dx-feature-flight",
    rung: "--dx-z-flight",
    context: "root",
    note: "The features panel folding into its gift button: a copy that exists for the length of the flight.",
  },
  { file: V11, selector: "#dx-notice", rung: "--dx-z-notice", context: "root" },
  {
    file: ATTENTION,
    selector: ".dx-od-input-glow",
    rung: "--dx-z-input-glow",
    context: "root",
    note:
      "The colour glow around the text field that has focus. 10000 because it has " +
      "to show over a field inside the component library's dialogs (1000+) as " +
      "well; harmless there because it is view-only and takes no pointer event. " +
      "It cannot show over a field inside `#dx-modal` — nothing in the page can — " +
      "which is why the glow for those is mounted inside the dialog.",
  },

  // ---- inside a context ---------------------------------------------------
  { file: V11, selector: ".dx-window-controls", rung: "--dx-z-window-controls", context: "#dx-global-controls" },
  {
    file: V12,
    selector: "#dx-workspace .dx-dex::before, #dx-workspace .dx-dex::after",
    rung: "--dx-z-raised-2",
    context: ".dx-dex",
  },
  {
    file: ATTENTION,
    selector: ".dx-od-agent-effects .dx-agent-work-cursor",
    rung: "--dx-z-raised-2",
    context: ".dx-od-agent-effects",
  },
  { file: V11, selector: ".dx-modal-head", rung: "--dx-z-modal-head", context: "#dx-modal" },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx-drop",
    rung: "--shell-z-cx-drop",
    context: ".shell-cx",
  },

  // ---- the surfaces the design keeps --------------------------------------
  {
    file: "src/shell/chrome/usageNotice.css",
    selector: ".shell-usage-notice",
    rung: "--dx-z-flyout",
    context: "root",
    note:
      "The one-time usage reporting notice, fixed to the window's corner and " +
      "rendered beside `ToastHost` at the root. A floating panel: over Dex and " +
      "the conversation, under the workspace's menus — at 300 it was drawn over " +
      "a menu opened from the composer beside it (S2-010's shape).",
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
    note: "The image creator's own menus. Portalled to `#shell` since W1-A.",
  },
  {
    file: "src/shell/account/account.css",
    selector: ".shell-account",
    rung: "--shell-z-gate",
    context: "root",
    note:
      "The account page, covering the window while the user signs in. It is a " +
      "sibling of `#dx-workspace` inside `#shell`, which opens no stacking context " +
      "of its own, so it sorts at the root, above everything the workspace draws. " +
      "Below `--shell-z-legacy-toast` on purpose: the page copies the verification " +
      "URL to the clipboard, and that confirmation is worthless if the page hides it.",
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
];

/**
 * Style literals assigned from TypeScript, where no CSS gate can see them.
 *
 * Not an exemption so much as a note that the hole exists and how big it is
 * right now. Asserted in both directions, so the count cannot grow quietly and
 * a fix must delete the entry.
 */
const KNOWN_STYLE_LITERALS: Record<string, { zIndex: number; colours: number; why: string }> = {
  "src/shell/agent/attentionOverlay.ts": {
    zIndex: 1,
    colours: 4,
    why:
      "The attention frame is drawn, not styled: a four-stop gradient that exists " +
      "to be unmistakably not-the-document, and a zIndex of 3 inside whichever " +
      "host it is mounted in. The colours are the design's and belong to the " +
      "effect rather than the palette.",
  },
  "src/shell/dex/faceRenderer.ts": {
    zIndex: 0,
    colours: 3,
    why:
      "Dex is a drawing. The renderer is a port of the approved prototype's, and " +
      "the three values are the ink, the plate and the corner mark of the rounded-" +
      "square face — a fixed relationship that makes it read as a face at 20px. " +
      "A theme moving them independently would be breaking the mark, not recolouring it.",
  },
  "src/shell/kit/fileIcons.ts": {
    zIndex: 0,
    colours: 30,
    why:
      "File Icon System 1.0: each file type's own colours, light and dark, as the " +
      "design system publishes them. They identify a format — Word blue, Excel " +
      "green — and are not the workspace's palette; the file is the table.",
  },
};

const shellCss = parseShellCss("src/shell");
const zIndexes = shellCss.filter((declaration) => declaration.property === "z-index");
const rungPattern = /^var\(\s*(--(?:shell|dx)-z-[a-z0-9-]+)\s*\)$/;
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
        // The light block only: a theme may recolour, it may not re-stack.
        .filter((declaration) => /^--(shell|dx)-z-/.test(declaration.property))
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
      for (const trap of context.traps) trapped.set(key(trap.file, trap.selector), context);
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
    // reason that outlived its cause. A context opened by a rung is checked
    // against the z-indexes; the dialog, which the browser lifts by itself,
    // against there still being a rule for it at all.
    const exists = (context: StackingContext) => {
      const at = (declaration: { file: string; selector: string }) =>
        declaration.file === context.file && declaration.selector === context.selector;
      if (context.property === "z-index") return zIndexes.some(at);
      if (context.property === "top-layer") return shellCss.some(at);
      return found.some((declaration) => at(declaration) && declaration.property === context.property);
    };
    const stale = STACKING_CONTEXTS.filter((context) => !exists(context)).map(
      (context) => `${context.file}  ${context.selector} { ${context.property} }`,
    );
    expect(stale).toEqual([]);

    // A context that traps something names the rungs it keeps, and only those.
    for (const context of STACKING_CONTEXTS) {
      expect(context.localRungs.length > 0, context.selector).toBe(context.traps.length > 0);
      for (const rung of context.localRungs) expect(LOCAL_RUNGS, context.selector).toContain(rung);
    }
  });

  it("is not quietly bypassed by a stylesheet that declares no z-index of its own", () => {
    // The narrow scope above is only safe while no *other* shell stylesheet
    // wraps one of the registered z-indexes. `app.css` and `product.css` style
    // ancestors of the workspace's regions and declare neither a z-index nor
    // an opener; if either grows one, that assumption needs re-checking by hand.
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

    // Leaf controls that fade, turn or slide. None of them is an ancestor of
    // anything positioned; the list is pinned so a new one has to be looked at
    // rather than absorbed. Keyed by selector, never by line.
    expect([...new Set(elsewhere)]).toEqual([
      "src/shell/agent/agent.css  .shell-task-button:disabled { opacity }",
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
      // The image composer's leaf controls: a tilted "add" sheet, a close
      // button that fades in on hover, disabled tools, a switch knob, a chevron.
      'src/shell/image/composer/imageComposer.css  .shell-ig-camera-grid[data-muted="true"] { opacity }',
      "src/shell/image/composer/imageComposer.css  .shell-ig-mode-close { opacity }",
      'src/shell/image/composer/imageComposer.css  .shell-ig-reference > span[aria-hidden="true"] { opacity }',
      "src/shell/image/composer/imageComposer.css  .shell-ig-reference-add:hover:not(:disabled) .shell-ig-reference-sheet { transform }",
      "src/shell/image/composer/imageComposer.css  .shell-ig-reference-sheet { transform }",
      'src/shell/image/composer/imageComposer.css  .shell-ig-switch[aria-checked="true"] > span { transform }',
      "src/shell/image/composer/imageComposer.css  .shell-ig-tool:disabled, .shell-ig-mode-close:disabled { opacity }",
      'src/shell/image/composer/imageComposer.css  .shell-ig-tool[aria-expanded="true"] > .shell-ig-chevron { transform }',
      "src/shell/image/imageWorkspace.css  .shell-image-action:disabled { opacity }",
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
    expect(zIndexes.length).toBeGreaterThanOrEqual(25);
    expect(shellCss.length).toBeGreaterThan(3000);
  });
});
