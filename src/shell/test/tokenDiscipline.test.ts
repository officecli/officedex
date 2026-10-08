/**
 * Wave 4b gate 7: colour and size come from the token table, or say whose debt
 * they are.
 *
 * S5 counted ninety-three bare colours across `src/shell`, and wrote that this
 * gate could not be built yet because it would ship with nine standing
 * exemptions — "a ban that arrives with nine exemptions is not a ban". W3-I
 * (c9cdf6f) took the shell's own stylesheets from sixty-eight bare colours to
 * twelve and its five off-scale font-sizes to none, which is what makes the
 * rule writable: the exemptions below are twelve lines in two groups that were
 * each argued for in the stylesheet that keeps them, plus one file's worth of
 * debt that has an owner and a condition for its deletion.
 *
 * The rule is not "use a token" for its own sake. The failure it prevents is
 * specific: `tokens.css` claims that swapping one block of values gives the
 * shell a dark theme, and that claim is true exactly as long as no colour is
 * written inside a selector. Every literal below that line is a surface that
 * would stay light.
 *
 * **Why the whitelist is keyed by selector and property, not `file:line`.**
 * Line-keyed is the obvious design and it does not survive contact with this
 * repository. `composer.css` — the one file here with real debt — moved its
 * z-index from line 382 to line 449 during the single session that wrote this
 * gate, because the session that owns it was adding rules above. A gate that
 * turns red when somebody edits the top of a file it does not otherwise care
 * about is a gate that gets deleted in a week. `(file, selector, property)` is
 * unique across all forty-three entries here, is immune to insertions
 * elsewhere, and is *stricter* than a line in the one way that matters: it
 * pins the value too, so recolouring an exempted literal is caught, whereas
 * `chrome.css:137` would happily go on pointing at a different red.
 *
 * **Known blind spots.**
 *
 * 1. **It reads stylesheets, so anything styled from TypeScript is invisible.**
 *    `agent/attentionOverlay.ts` writes four gradient stops into an SVG with
 *    `Object.assign(el.style, …)`. That hole is watched, in both directions, by
 *    `layers.test.ts` — which is the only reason it is a footnote here and not
 *    an unknown.
 * 2. **It finds hex, `rgb()`/`hsl()` and a list of named colours.** A colour
 *    arriving by some other spelling — `lab()`, `color(display-p3 …)`, a
 *    system colour keyword — is not detected. The named list is deliberately
 *    short; `currentColor` and `transparent` are colours and are fine, since
 *    neither pins a value.
 * 3. **"Comes from the scale" is not "is the right size".** `var(--shell-text-xs)`
 *    on a heading passes. This gate makes the set of sizes closed; whether a
 *    given surface picked the right member of it is a design review.
 * 4. **`font-weight` is not gated at all.** There are seventeen bare weights in
 *    `src/shell` (400/450/500/600) and `tokens.css` has no weight section to
 *    check them against, so a gate would be asserting against nothing. Building
 *    that section is the prerequisite, and it is somebody's work, not this
 *    file's exemption. Recorded here so it is a known gap rather than a silent
 *    one.
 * 5. The right long-term fix is upstream of any scanner: a colour reaches the
 *    screen through a custom property or it does not reach the screen. That is
 *    a stylelint rule (`declaration-property-value-disallowed-list`) with the
 *    same exemptions, run by the editor as you type. This gate is the version
 *    that exists today.
 *
 * **OD-UI-1.2.** The workspace's stylesheets under `styles/` are generated
 * from the approved prototype by `scripts/port-prototype-styles.mjs`, which
 * refuses to write a colour or a font-size it has no token for — so for those
 * files this gate is the second check rather than the first. There are two
 * scales now and both are closed: `--dx-fs-*` is the design's, named by its
 * pixel size because the design's own table is; `--shell-text-*` is what the
 * surfaces the design keeps as they were (the image creator, the account page,
 * the generating canvas) were already written in. One surface uses one scale.
 */
import { describe, expect, it } from "vitest";
import { parseCss, parseShellCss, type CssDeclaration } from "./cssModel";

/**
 * The type scale, copied from `tokens.css` and asserted equal to it below.
 *
 * Nine steps, which W3-I made a closed set precisely so this gate could be
 * written without per-line exemptions in the files it owns. It is an inventory
 * made addressable rather than a designed ramp — 17 and 18 one pixel apart is
 * the tell — but closed is what a gate needs.
 */
const TYPE_SCALE: Record<string, string> = {
  "--shell-text-xs": "10px",
  "--shell-text-sm": "11px",
  "--shell-text": "12px",
  "--shell-text-md": "13px",
  "--shell-text-lg": "14px",
  "--shell-text-xl": "17px",
  "--shell-text-2xl": "18px",
  "--shell-text-3xl": "26px",
  "--shell-text-4xl": "32px",
  "--shell-text-display": "31px",
};

/**
 * The design's scale (OD-UI-1.2 §04), copied from `tokens.css` and asserted
 * equal to it below. Ten sizes; 9px is the glyph inside a traffic light and
 * nothing else.
 */
const DESIGN_SCALE: Record<string, string> = {
  "--dx-fs-9": "9px",
  "--dx-fs-12": "12px",
  "--dx-fs-13": "13px",
  "--dx-fs-14": "14px",
  "--dx-fs-16": "16px",
  "--dx-fs-20": "20px",
  "--dx-fs-22": "22px",
  "--dx-fs-24": "24px",
  "--dx-fs-26": "26px",
  "--dx-fs-28": "28px",
};

const SCALE_TOKEN = /--(?:shell-text(?:-[a-z0-9]+)?|dx-fs-\d+)/;

interface Exemption {
  file: string;
  selector: string;
  property: string;
  /** The literal, exactly. Changing it is a recolour and fails. */
  value: string;
  /** Why it is still a literal, and what deletes this row. */
  why: string;
}

/** Debt: somebody owes the token. Shared `why` prefix, per-row target. */
const COMPOSER = (target: string) =>
  `Owed by whoever owns src/shell/composer — the file was under concurrent ` +
  `edit throughout Wave 4, which is why W3-I left it untouched and wrote the ` +
  `substitutions down instead (W3-I.md §3). ${target} Delete this row in the ` +
  `same commit that lands the change.`;

/**
 * By design: the macOS traffic lights.
 *
 * These are not this product's palette, they are the platform's. Filing them in
 * `tokens.css` would put them in the column marked "exists in order to be
 * themed", and the first person to build a dark theme would reasonably adjust
 * them — at which point the control stops looking like the platform and starts
 * looking like a bug.
 */
const MACOS = (surface: string) =>
  `${surface} — macOS system appearance, deliberately not a token: a themable ` +
  `traffic light is a traffic light somebody will retint, and then it is no ` +
  `longer the platform's. Revoked the day the window controls become ` +
  `platform-drawn, or the day a non-macOS chrome ships — they are already ` +
  `wrong on Windows and Linux (other side, square, drawn by the system).`;

/**
 * Two kinds of thing live in this list and they are not the same kind.
 *
 * The traffic lights are *by-design* literals: the row records the event that
 * would revoke the argument rather than a date, because there isn't one. (The
 * companion's palette used to be the second such group; the mark is drawn from
 * its own SVG now and no stylesheet colours it.) Everything in `composer.css`
 * is *debt* — what is left of it after OD-UI-1.2 removed the chips, the mention
 * list and the dictation state that owed the rest: a token
 * already exists or should, somebody owns the file, and the row says what has
 * to happen. An exemption with neither an expiry nor a revoking condition is
 * how a rule quietly stops being one, so every row carries one or the other.
 */
const BARE_COLOURS: Exemption[] = [
  // ---- by design: the macOS traffic lights -------------------------------
  {
    file: "src/shell/styles/workspace-v11.css",
    selector: ".dx-traffic",
    property: "border",
    value: "1px solid #0001",
    why: MACOS("the traffic lights' shared hairline"),
  },
  {
    file: "src/shell/styles/workspace-v11.css",
    selector: ".dx-traffic.dx-close",
    property: "background",
    value: "#ff5f57",
    why: MACOS("close"),
  },
  {
    file: "src/shell/styles/workspace-v11.css",
    selector: ".dx-traffic.dx-min",
    property: "background",
    value: "#ffbd2e",
    why: MACOS("minimise"),
  },
  {
    file: "src/shell/styles/workspace-v11.css",
    selector: ".dx-traffic.dx-max",
    property: "background",
    value: "#28c840",
    why: MACOS("zoom"),
  },
  {
    file: "src/shell/styles/workspace-v11.css",
    selector: ".dx-traffic:hover",
    property: "color",
    value: "#222",
    why: MACOS("the ×/–/+ the system draws inside them on hover"),
  },

  // ---- debt: composer.css ------------------------------------------------
  // Three of these are free: #2b3035 and #ffffff already have tokens holding
  // the identical value, so replacing them is a no-op on screen.
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx-send:hover:not(:disabled)",
    property: "background",
    value: "#2b3035",
    why: COMPOSER("This is `--shell-button-primary-hover` exactly — Δ0, a free swap."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx-send:disabled",
    property: "color",
    value: "#ffffff",
    why: COMPOSER("This is `--shell-ink-inverse` exactly — Δ0, a free swap."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx-send:disabled",
    property: "background",
    value: "#e6e8ea",
    why: COMPOSER("Needs a new token; no existing one is within Δ4."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx:focus-within",
    property: "border-color",
    value: "#c7ced5",
    why: COMPOSER("The composer's focused border; needs a token."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx:focus-within",
    property: "box-shadow",
    value: "0 2px 6px #00000008",
    why: COMPOSER("Belongs in the Elevation section beside --shell-shadow-*."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx--home",
    property: "box-shadow",
    value: "0 2px 5px #00000005",
    why: COMPOSER("Belongs in the Elevation section beside --shell-shadow-*."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: '.shell-cx-button:hover, .shell-cx-button[aria-expanded="true"]',
    property: "background",
    value: "#f0f1f2",
    why: COMPOSER("Another hover grey; W3-I.md §4.1 lists four already competing for one token."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx-drop",
    property: "border",
    value: "1px dashed #7c8791",
    why: COMPOSER("Drop-target dashes; nav.css solved the same gesture with --shell-drop-line."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx-drop",
    property: "background",
    value: "#f4f5f6ed",
    why: COMPOSER("Drop-target scrim; nav.css uses --shell-drop-fill."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-dialog-warning",
    property: "border",
    value: "1px solid #e6dcc4",
    why: COMPOSER("Warning amber, 1 of 3. Zero hits in the prototype (S5-011); tokens.css has no warning."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-dialog-warning",
    property: "background",
    value: "#fbf5e6",
    why: COMPOSER("Warning amber, 2 of 3."),
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-dialog-warning",
    property: "color",
    value: "#7a6533",
    why: COMPOSER("Warning amber, 3 of 3."),
  },
];

const BARE_FONT_SIZES: Exemption[] = [
  {
    file: "src/shell/styles/workspace-v12.css",
    selector: ".dx-source-share",
    property: "font-size",
    value: "0",
    why:
      "Not a size: the design sets the Share button's own text to nothing so that a " +
      "narrow strip keeps the icon, and restores the label on the element inside it. " +
      "Generated from the approved prototype, which writes it this way. Revoked when " +
      "the design hides the label some other way.",
  },
  {
    file: "src/shell/composer/composer.css",
    selector: ".shell-cx--home .shell-cx-input",
    property: "font-size",
    value: "16px",
    why: COMPOSER(
      "16px has no step. It is almost certainly the iOS rule — Safari zooms a " +
        "focused input below 16px — so the fix may be a named `--shell-text-input` " +
        "rather than a tenth rung on a scale it does not belong to.",
    ),
  },
];

/**
 * Colours as they can be written here. Hex covers everything in the tree today;
 * the function forms and the keyword list are there so the next one is caught
 * rather than discovered. `transparent` and `currentColor` are absent on
 * purpose — they pin no value and survive a theme swap intact.
 */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lch|lab|oklch|oklab)\s*\(|\b(?:white|black|red|green|blue|gray|grey|silver|navy|teal|olive|maroon|orange|yellow|purple|fuchsia|aqua|lime)\b/;

/**
 * What a declaration writes itself, with what it takes from a token removed.
 *
 * `var(--dx-white)` is a reference; "white" there is part of a name. Reading
 * the name as a colour would make the gate fail every stylesheet that does the
 * right thing, and the only way to satisfy it would be to stop naming tokens
 * after what they hold.
 */
const written = (value: string) => value.replace(/var\(\s*--[\w-]+\s*(?:,[^()]*)?\)/g, "").replace(/\s*!important\s*$/, "");

const writesColour = (declaration: CssDeclaration) => COLOUR.test(written(declaration.value));

const shellCss = parseShellCss("src/shell").filter(
  (declaration) => declaration.file !== "src/shell/tokens.css",
);

const matches = (exemption: Exemption, declaration: CssDeclaration) =>
  exemption.file === declaration.file &&
  exemption.selector === declaration.selector &&
  exemption.property === declaration.property;

/** Rows whose declaration is gone, or whose value moved under them. */
function stale(exemptions: Exemption[], declarations: CssDeclaration[]): string[] {
  return exemptions
    .filter(
      (exemption) =>
        !declarations.some(
          (declaration) => matches(exemption, declaration) && declaration.value === exemption.value,
        ),
    )
    .map((exemption) => `${exemption.file}  ${exemption.selector} { ${exemption.property}: ${exemption.value} }`);
}

describe("colour and size come from the token table", () => {
  it("the type scale is exactly the set tokens.css declares", () => {
    const declaredAs = (pattern: RegExp) =>
      Object.fromEntries(
        parseCss("src/shell/tokens.css")
          .filter((declaration) => pattern.test(declaration.property))
          .map((declaration) => [declaration.property, declaration.value]),
      );
    expect(declaredAs(/^--dx-fs-\d+$/)).toEqual(DESIGN_SCALE);
    const declared = declaredAs(/^--shell-text(-[a-z0-9]+)?$/);
    // Both directions: a tenth size in tokens.css that nobody added here is a
    // step that entered the scale without a decision, and a row here that
    // tokens.css dropped is a size this gate would keep blessing.
    expect(declared).toEqual(TYPE_SCALE);
  });

  it("no stylesheet outside tokens.css writes a colour", () => {
    const offenders = shellCss
      .filter(
        (declaration) =>
          writesColour(declaration) &&
          !BARE_COLOURS.some(
            (exemption) => matches(exemption, declaration) && exemption.value === declaration.value,
          ),
      )
      .map((declaration) => `${declaration.file}:${declaration.line} ${declaration.selector} { ${declaration.text} }`);
    expect(offenders).toEqual([]);
  });

  it("no stylesheet writes a font-size the scale does not name", () => {
    const offenders = shellCss
      .filter(
        (declaration) =>
          declaration.property === "font-size" &&
          !new RegExp(`^var\\(\\s*${SCALE_TOKEN.source}\\s*\\)$`).test(
            declaration.value.replace(/\s*!important\s*$/, ""),
          ) &&
          !BARE_FONT_SIZES.some(
            (exemption) => matches(exemption, declaration) && exemption.value === declaration.value,
          ),
      )
      .map((declaration) => `${declaration.file}:${declaration.line} ${declaration.selector} { ${declaration.text} }`);
    expect(offenders).toEqual([]);
  });

  it("every step a stylesheet names is one the scale declares", () => {
    // A typo'd `var(--shell-text-xxl)` resolves to nothing and the element
    // inherits, which looks like a layout bug rather than a missing token.
    const unknown = shellCss
      .flatMap((declaration) =>
        [...declaration.value.matchAll(/var\(\s*(--shell-text[a-z0-9-]*|--dx-fs-[a-z0-9-]*)\s*\)/g)].map((match) => ({
          declaration,
          token: match[1],
        })),
      )
      .filter(({ token }) => !(token in TYPE_SCALE) && !(token in DESIGN_SCALE))
      .map(({ declaration, token }) => `${declaration.file}:${declaration.line} ${token}`);
    expect(unknown).toEqual([]);
  });

  it("every exemption is still a violation", () => {
    // The list is an assertion in both directions. W4's KNOWN_BODY_PORTALS does
    // the same thing, and for the same reason: a pardon nobody is forced to
    // revisit is where a rule goes to be forgotten. Pinning the value as well
    // as the location means a *recoloured* exemption also fails — silently
    // changing #ff5f57 is exactly the move the traffic-light argument forbids.
    expect(stale(BARE_COLOURS, shellCss)).toEqual([]);
    expect(stale(BARE_FONT_SIZES, shellCss)).toEqual([]);
  });

  it("holds no exemption that is not one file's debt or one stylesheet's argument", () => {
    // A guard against the shape of failure this gate is most likely to suffer:
    // somebody adds a row to make a build go green and leaves the `why` empty,
    // or exempts a whole new file rather than a declaration.
    for (const exemption of [...BARE_COLOURS, ...BARE_FONT_SIZES]) {
      expect(exemption.why.length, `${exemption.selector} has no reason`).toBeGreaterThan(30);
    }
    expect([...new Set([...BARE_COLOURS, ...BARE_FONT_SIZES].map((entry) => entry.file))].sort()).toEqual([
      "src/shell/composer/composer.css",
      "src/shell/styles/workspace-v11.css",
      "src/shell/styles/workspace-v12.css",
    ]);
  });

  it("finds the declarations it is meant to be checking", () => {
    // A scanner that stopped parsing would satisfy every assertion above. The
    // floors are well under the real counts so an ordinary edit cannot trip
    // them, and far above zero so a total failure cannot hide.
    expect(shellCss.filter((declaration) => declaration.property === "font-size").length).toBeGreaterThan(50);
    // Bare colours are nearly gone, which is the point; what is counted here is
    // that the scanner still sees the ones that are exempt.
    expect(shellCss.filter(writesColour).length).toBeGreaterThanOrEqual(BARE_COLOURS.length);
    expect(BARE_COLOURS.length).toBeGreaterThan(4);
    expect(shellCss.filter((declaration) => /var\(\s*--dx-/.test(declaration.value)).length).toBeGreaterThan(300);
  });
});
