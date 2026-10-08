#!/usr/bin/env node
/**
 * Ports the approved prototype's outer-workspace stylesheets into the shell.
 *
 *   node scripts/port-prototype-styles.mjs <OfficeDex-Interactive-Prototype-1.2-rN.html>
 *
 * Why a port and not a rewrite. OD-UI-1.2 asks for the prototype to be
 * reproduced, and the prototype's look is not written down in one place: it is
 * a v1.1 base with a v1.2 layer and a workspace-structure layer on top, where
 * later rules override earlier ones by order and by specificity. Re-deriving
 * "the final value" by hand for a few thousand declarations is how a port
 * drifts. Carrying the layers across *in order*, with every selector's
 * specificity changed by the same amount, keeps the cascade — and therefore
 * every computed value — the prototype's own. It also means the next revision
 * is a diff of this script's output rather than a second archaeology.
 *
 * What it changes, and only this:
 *
 *  1. Names. Every class and id gets the `dx-` prefix so nothing here can meet
 *     an editor's or the component library's selectors. `:root` and `body`
 *     become `#shell`.
 *  2. Reach. The prototype isolates its editors in iframes, so it can style
 *     `button` and `table` globally. The shell mounts one editor in the same
 *     document, so a selector made only of element names is confined to
 *     `[data-ui-scope="officedex"]` regions through `:where()`, which adds no
 *     specificity (SHIMO-BOUNDARY §5).
 *  3. Literals. Colours, font sizes and z-indexes are replaced by the tokens in
 *     `src/shell/tokens.css`, value for value. An unmapped literal is an error,
 *     not a pass-through: that is what keeps `tokens.css` the whole palette.
 *
 * The output is generated. Product-specific rules live in the hand-written
 * stylesheets next to it, never in these files.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../src/shell/styles");

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/port-prototype-styles.mjs <prototype.html>");
  process.exit(2);
}

/** The stylesheet blocks to carry across, in cascade order. */
const LAYERS = [
  { source: "v11/workspace.css", file: "workspace-v11.css" },
  { source: "v12/workspace.css", file: "workspace-v12.css" },
  { source: "v12/attention-feedback.css", file: "attention.css" },
  { source: "v12/workspace-structure.css", file: "workspace-structure.css" },
];

/* ------------------------------------------------------------------ tokens */

/**
 * Colour literal → token. Keys are lower-case and fully expanded where the
 * source abbreviates. The values are declared in `tokens.css`; this table and
 * that file are checked against each other by `test/tokenDiscipline.test.ts`.
 */
const COLOURS = {
  // OD-UI-1.2 §05 semantic palette
  "#343a40": "--dx-text",
  "#626e79": "--dx-muted",
  "#f5f6f8": "--dx-canvas",
  "#d9dfe4": "--dx-line",
  "#7b8794": "--dx-control",
  "#eceff2": "--dx-hover",
  "#e4e9ee": "--dx-selected",
  "#d9e0e6": "--dx-pressed",
  "#526f89": "--dx-focus",
  "#2768c9": "--dx-blue",
  "#a43d37": "--dx-error",
  "#2e6b4f": "--dx-success",
  "#8a5a17": "--dx-warning",
  // absolute white: knobs, glyphs on a filled control, paper
  "#fff": "--dx-white",
  "#ffffff": "--dx-white",
  white: "--dx-white",
  // focus
  "#526f8929": "--dx-focus-halo",
  "#526f8920": "--dx-focus-wash",
  "#63778c": "--dx-home-tab-focus",
  // filled controls
  "#20262c": "--dx-primary-hover",
  "#14191e": "--dx-primary-pressed",
  "#41464b": "--dx-share",
  "#33383d": "--dx-share-hover",
  "#262b30": "--dx-share-pressed",
  // surfaces
  "#f7f7f6": "--dx-sidebar",
  "#eef0f3": "--dx-chrome",
  "#e3e6eb": "--dx-home-tab",
  "#edf0f3": "--dx-home-tab-hover",
  "#f5f5f5": "--dx-card-preview",
  "#aeb8c2": "--dx-card-hover-line",
  "#f5f6f8ed": "--dx-canvas-veil",
  "#252a30": "--dx-tooltip",
  "#343a40c0": "--dx-play-scrim",
  "#0000003d": "--dx-backdrop",
  // brand
  "#2b2b2b": "--dx-face-tile",
  "#252525": "--dx-dex-ink",
  // agent work cursor and draft (ATTENTION-STANDARD)
  "#292d34": "--dx-work-cursor",
  "#282c32": "--dx-work-tag",
  // shade ramp: one ink at the alphas the prototype's shadows use
  "#17212b08": "--dx-shade-03",
  "#17212b0d": "--dx-shade-05",
  "#17212b12": "--dx-shade-07",
  "#17212b15": "--dx-shade-08",
  "#17212b16": "--dx-shade-09",
  "#17212b24": "--dx-shade-14",
  "#17212b33": "--dx-shade-20",
  "#00000012": "--dx-black-07",
  "#00000014": "--dx-black-08",
  "#0002": "--dx-black-13",
  "#20242b13": "--dx-work-tag-shade",
  "#23303b20": "--dx-dex-shade-v11",
  "#24334225": "--dx-dex-panel-shade-v11",
  // dark theme (tokens.css swaps the semantic block; these are the one-offs)
  "#20252a": "--dx-dark-on-primary",
  "#24272c": "--dx-dark-chrome",
  "#343840": "--dx-dark-home-tab",
  "#4b515a": "--dx-dark-home-tab-selected",
  "#d1d8de": "--dx-dark-primary-hover",
  "#b9c3cd": "--dx-dark-primary-pressed",
};

/** macOS traffic lights stay literal by design — see `tokenDiscipline.test.ts`. */
const LITERAL_BY_DESIGN = new Set(["#ff5f57", "#ffbd2e", "#28c840", "#0001", "#222"]);

const FONT_SIZES = new Set([9, 12, 13, 14, 16, 20, 22, 24, 26, 28]);

/**
 * z-index → rung. The same number can be two rungs (30 is both the window
 * controls and the floating chat), so the choice is by selector.
 */
function zToken(value, selector) {
  const s = selector;
  const pick = {
    1: "--dx-z-raised",
    2: s.includes("modal-head") ? "--dx-z-modal-head" : "--dx-z-raised-2",
    15: "--dx-z-sidebar",
    20: "--dx-z-splitter",
    22: "--dx-z-dex",
    23: "--dx-z-dex-panel",
    24: "--dx-z-dex-open",
    25: "--dx-z-chat-overlay",
    30: s.includes("conversation") ? "--dx-z-chat-floating" : "--dx-z-window-controls",
    35: "--dx-z-workspace-toggle",
    40: s.includes("drop-active") ? "--dx-z-drop" : "--dx-z-sidebar-peek",
    45: s.includes("feature-flyout") ? "--dx-z-flyout" : "--dx-z-global-controls",
    60: "--dx-z-menu",
    70: "--dx-z-popover",
    90: "--dx-z-tooltip",
    110: "--dx-z-agent-effects",
    120: "--dx-z-flight",
    200: "--dx-z-notice",
    10000: "--dx-z-input-glow",
  }[value];
  if (!pick) throw new Error(`unmapped z-index ${value} on ${selector}`);
  return pick;
}

const CUSTOM_PROPERTIES = new Set([
  "text",
  "muted",
  "surface",
  "canvas",
  "line",
  "control",
  "hover",
  "selected",
  "pressed",
  "focus",
  "blue",
  "error",
  "success",
  "warning",
  "nav",
  "chat",
  "composer-radius",
  "composer-padding",
  "composer-icon",
  "dex-panel-x",
  "dex-panel-y",
]);

/* --------------------------------------------------------------- selectors */

/**
 * Rules for surfaces the shell does not carry: the download/install journey,
 * the v1.1 New dialog that the anchored popover replaced, and the prototype's
 * own stand-in editors (the shell mounts real ones).
 */
const DROPPED = [
  /\.onboarding\b/,
  /\.install-/,
  /\.desktop-files\b/,
  /\.new-groups?\b/,
  /\.new-option\b/,
  /#modal\.new-file\b/,
  /\.office-frame\b/,
  /\.text-editor\b/,
  /\.source-area\b/,
  /\.image-editor\b/,
  /\.editor-toolbar\b/,
  /\.brand\b/,
  /\.compact-only\b/,
  /#asset-groups\b/,
];

const SCOPE = ':where([data-ui-scope="officedex"])';
const SCOPE_OR_INSIDE = ':where([data-ui-scope="officedex"], [data-ui-scope="officedex"] *)';

function rewriteSelector(selector) {
  let out = selector.trim();
  // Attribute values may contain dots or hashes; take them out before renaming.
  const held = [];
  out = out.replace(/\[[^\]]*\]/g, (attr) => {
    held.push(attr);
    return `\u0000${held.length - 1}\u0000`;
  });
  out = out.replace(/#([A-Za-z_][\w-]*)/g, "#dx-$1").replace(/\.([A-Za-z_][\w-]*)/g, ".dx-$1");
  out = out.replace(/\u0000(\d+)\u0000/g, (_, index) => held[Number(index)]);

  // The document root and <body> are the shell's own root element.
  out = out.replace(/^:root\b/, "#shell").replace(/^body(?=[.\[:\s]|$)/, "#shell");
  // Classes the prototype toggles on <body>.
  out = out.replace(/^\.dx-(resizing|reduced)\b/, "#shell.dx-$1");

  const named = /(\.dx-|#dx-|#shell)/.test(out) || out.startsWith("[data-ui-scope");
  if (!named) {
    // An element selector applies to the scope element as well as to what is
    // inside it: a lone button placed straight into the workspace grid carries
    // the attribute itself and has no scoped ancestor.
    const tag = /^[a-z][\w-]*/i.exec(out);
    out = tag ? `${tag[0]}${SCOPE_OR_INSIDE}${out.slice(tag[0].length)}` : `${SCOPE} ${out}`;
  }
  // `#shell.dx-reduced *` would reach into a mounted editor.
  if (/^#shell\.dx-reduced \*$/.test(out)) out = '#shell.dx-reduced [data-ui-scope="officedex"] *';
  return out;
}

/* ------------------------------------------------------------ declarations */

const COLOUR_PATTERN = /#[0-9a-fA-F]{3,8}\b|\bwhite\b/g;

function rewriteValue(decl, selector) {
  let value = decl.value;

  value = value.replace(/var\(--([\w-]+)/g, (match, name) =>
    CUSTOM_PROPERTIES.has(name) ? `var(--dx-${name}` : match,
  );

  value = value.replace(COLOUR_PATTERN, (literal) => {
    const key = literal.toLowerCase();
    if (LITERAL_BY_DESIGN.has(key)) return literal;
    const token = COLOURS[key];
    if (!token) throw new Error(`unmapped colour ${literal} in "${selector} { ${decl.prop}: ${decl.value} }"`);
    return `var(${token})`;
  });

  if (decl.prop === "font-size") {
    value = value.replace(/^(\d+)px/, (match, size) => {
      if (!FONT_SIZES.has(Number(size))) throw new Error(`off-scale font-size ${match} on ${selector}`);
      return `var(--dx-fs-${size})`;
    });
  }
  if (decl.prop === "font") {
    // `400 12px/18px family` — the size is the first length before the slash.
    value = value.replace(/(^|\s)(\d+)px(?=\/)/, (match, lead, size) => {
      if (!FONT_SIZES.has(Number(size))) throw new Error(`off-scale font size ${size}px on ${selector}`);
      return `${lead}var(--dx-fs-${size})`;
    });
  }
  if (decl.prop === "z-index" && /^-?\d+$/.test(value.trim())) {
    value = `var(${zToken(Number(value.trim()), selector)})`;
  }
  return value;
}

/* -------------------------------------------------------------------- port */

function extractLayer(html, name) {
  const open = `<style data-source="${name}">`;
  const start = html.indexOf(open);
  if (start < 0) throw new Error(`stylesheet ${name} not found in the prototype`);
  const end = html.indexOf("</style>", start);
  return html.slice(start + open.length, end);
}

function port(css, name) {
  const root = postcss.parse(css, { from: name });

  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;

    const kept = rule.selectors.filter((selector) => !DROPPED.some((pattern) => pattern.test(selector)));
    if (kept.length === 0) {
      rule.remove();
      return;
    }

    // The palette and the theme swap are `tokens.css`'s, not a selector's.
    const isTokenBlock = kept.every(
      (selector) => selector === ":root" || selector === 'body[data-theme="dark"]' || selector === "body[data-theme=dark]",
    );
    if (isTokenBlock) {
      rule.walkDecls((decl) => {
        if (decl.prop.startsWith("--") || decl.prop === "color-scheme") decl.remove();
        else if (["font-family", "font-synthesis", "color", "font-size", "line-height"].includes(decl.prop)) decl.remove();
      });
      if (rule.nodes.length === 0) {
        rule.remove();
        return;
      }
    }
    // `body` and `*` resets are `app.css`'s.
    if (kept.every((selector) => selector === "body" || selector === "*")) {
      const inReducedMotion = rule.parent?.type === "atrule" && /prefers-reduced-motion/.test(rule.parent.params);
      if (!inReducedMotion) {
        rule.remove();
        return;
      }
    }

    const selectorText = kept.join(", ");
    rule.selectors = kept.map(rewriteSelector);
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith("--")) {
        const name = decl.prop.slice(2);
        if (CUSTOM_PROPERTIES.has(name)) decl.prop = `--dx-${name}`;
      }
      decl.value = rewriteValue(decl, selectorText);
    });
  });

  // The reduced-motion `*` reset must not reach a mounted editor either.
  root.walkAtRules("media", (atRule) => {
    if (!/prefers-reduced-motion/.test(atRule.params)) return;
    atRule.walkRules((rule) => {
      rule.selectors = rule.selectors.map((selector) =>
        selector === `${SCOPE} *` ? '[data-ui-scope="officedex"] *' : selector,
      );
    });
  });

  root.walkAtRules((atRule) => {
    if (atRule.nodes && atRule.nodes.length === 0) atRule.remove();
  });

  return format(root);
}

/**
 * One declaration per line, two-space indent. The source is minified in
 * places; the gates in `src/shell/test` read these files line by line.
 */
function format(root) {
  const indent = (depth) => "  ".repeat(depth);
  const walk = (container, depth) => {
    container.each((node, index) => {
      node.raws.before = (index === 0 && depth > 0 ? "\n" : depth === 0 && index > 0 ? "\n\n" : "\n") + indent(depth);
      if (depth === 0 && index === 0) node.raws.before = "";
      if (node.type === "decl") {
        node.raws.between = ": ";
        node.value = node.value.replace(/\s*\n\s*/g, " ").replace(/,(?=\S)/g, ", ");
      }
      if (node.type === "rule") {
        node.selector = node.selectors.join(",\n" + indent(depth));
        node.raws.between = " ";
      }
      if (node.type === "atrule") {
        node.raws.afterName = " ";
        node.raws.between = node.nodes ? " " : "";
        node.params = node.params.replace(/\s+/g, " ").replace(/\(\s*([\w-]+)\s*:\s*/g, "($1: ");
      }
      if (node.nodes) {
        node.raws.semicolon = true;
        node.raws.after = "\n" + indent(depth);
        walk(node, depth + 1);
      }
    });
  };
  walk(root, 0);
  root.raws.after = "\n";
  return root.toString();
}

const html = readFileSync(source, "utf8");
mkdirSync(outDir, { recursive: true });

for (const layer of LAYERS) {
  const css = port(extractLayer(html, layer.source), layer.source);
  const banner =
    `/*\n * GENERATED by scripts/port-prototype-styles.mjs — do not edit.\n *\n` +
    ` * Source: ${layer.source} in the approved OfficeDex prototype (OD-UI-1.2).\n` +
    ` * Re-run the script against a new prototype revision instead of changing\n` +
    ` * this file; product-specific rules belong in the hand-written stylesheets.\n */\n\n`;
  writeFileSync(join(outDir, layer.file), banner + css);
  console.log(`${layer.source} → src/shell/styles/${layer.file}`);
}
