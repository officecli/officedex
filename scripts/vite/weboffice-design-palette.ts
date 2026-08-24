import type { Plugin } from "vite";

/**
 * Re-tints weboffice-design to the app's palette — pure-neutral greys with a
 * teal-green accent, taken from the interaction prototype.
 *
 * It has to happen at build time. The design system computes each component's
 * tokens in JavaScript and emits them as a scoped `ui-*-vars-<hash>` class, so
 * overriding `--ui-*` in the cascade only reaches the few places that read the
 * root variables — the components keep their own inlined copies. Rewriting the
 * literals in its bundle catches every consumer at once: `createThemeVars()`,
 * the shipped stylesheet, and those scoped classes.
 *
 * Drop this once the design system grows a seed/theme API.
 */
const PACKAGE = /weboffice-design[\\/]dist[\\/].+\.(js|css)$/;
const PACKAGE_JS = /weboffice-design[\\/]dist[\\/].+\.js$/;

/** Shimo value → app value. Roles, not lightness matches. */
const SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // ── light neutrals → pure grey
  [/#2C3033/gi, "#0A0A0A"],
  [/#41464B/gi, "#171717"],
  [/#515457/gi, "#404040"],
  [/#8D9093/gi, "#A1A1A1"],
  [/#C6C8C9/gi, "#D4D4D4"],
  [/#F1F1F1/gi, "#F2F2F2"],
  [/#F7F7F7/gi, "#F5F5F5"],
  [/#F9F9F9/gi, "#FAFAFA"],
  [/rgba\((\s*)65,(\s*)70,(\s*)75,/gi, "rgba(23,23,23,"],
  // ── dark neutrals
  [/#F8F8F8/gi, "#FFFFFF"],
  [/#F3F3F4/gi, "#FAFAFA"],
  [/#5C5D5F/gi, "#737373"],
  [/#47484A/gi, "#404040"],
  [/#3B3F44/gi, "#262626"],
  [/#2E2F31/gi, "#1C1C1C"],
  [/#16181A/gi, "#0A0A0A"],
  [/rgba\((\s*)243,(\s*)243,(\s*)244,/gi, "rgba(250,250,250,"],
  // ── guidance blue → accent green
  [/#5DA4E3/gi, "#007A55"],
  [/#3686D6/gi, "#006543"],
  [/#89C3F0/gi, "#4FC49A"],
  [/#F0FAFF/gi, "#E5F9EF"],
  [/#5696CF/gi, "#00D492"],
  [/#3176BA/gi, "#54E5AB"],
  [/#2B6094/gi, "#0C3022"],
];

export function retint(code: string): string {
  let next = code;
  for (const [pattern, replacement] of SUBSTITUTIONS) next = next.replace(pattern, replacement);
  return next;
}

export function webofficeDesignPalette(): Plugin {
  return {
    name: "weboffice-design-palette",
    enforce: "pre",
    config() {
      // Dependency pre-bundling runs through esbuild, which never sees the
      // transform hook below — the dev server would keep serving Shimo colours.
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: "weboffice-design-palette-prebundle",
                setup(build: {
                  onLoad: (
                    options: { filter: RegExp },
                    callback: (args: { path: string }) => Promise<{ contents: string; loader: "js" }>,
                  ) => void;
                }) {
                  build.onLoad({ filter: PACKAGE_JS }, async ({ path }) => {
                    const { readFile } = await import("node:fs/promises");
                    return { contents: retint(await readFile(path, "utf8")), loader: "js" };
                  });
                },
              },
            ],
          },
        },
      };
    },
    transform(code, id) {
      if (!PACKAGE.test(id.split("?")[0])) return null;
      const next = retint(code);
      return next === code ? null : { code: next, map: null };
    },
  };
}
