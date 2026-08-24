import type { Plugin } from "vite";

/**
 * weboffice-design 0.18.0 ships a bundle compiled against React 18: its inlined
 * jsx-runtime and react-dom/client shims both read
 * `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` (`ReactCurrentDispatcher`
 * in the dev branch, `ReactCurrentOwner` in the production branch). React 19
 * removed that export, so importing any component throws
 * `Cannot read properties of undefined (reading 'ReactCurrentDispatcher')`
 * even though the package declares `react: ^18 || ^19` in peerDependencies.
 *
 * Both shim chunks are self-contained modules with a single export, so we can
 * replace them with the host React runtime. The filenames carry a content hash,
 * hence the glob-ish regexes rather than exact paths.
 *
 * Remove this plugin once weboffice-design publishes a React 19 compatible build.
 */
const JSX_RUNTIME_CHUNK = /weboffice-design[\\/]dist[\\/]assets[\\/]jsx-runtime-[\w-]+\.js$/;
const DOM_CLIENT_CHUNK = /weboffice-design[\\/]dist[\\/]assets[\\/]client-[\w-]+\.js$/;

const JSX_RUNTIME_SHIM = [
  'import { Fragment, jsx, jsxs } from "react/jsx-runtime";',
  "export const j = { Fragment, jsx, jsxs };",
].join("\n");

const DOM_CLIENT_SHIM = [
  'import { createRoot, hydrateRoot } from "react-dom/client";',
  "export const c = { createRoot, hydrateRoot };",
].join("\n");

export function webofficeDesignReact19(): Plugin {
  return {
    name: "weboffice-design-react19-runtime",
    enforce: "pre",
    config() {
      // The same rewrite has to happen during dependency pre-bundling. Excluding
      // weboffice-design instead would leave it importing an unversioned
      // `react.js`, which the browser loads as a second React instance — state
      // updates inside the design system's components then never reach the app.
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: "weboffice-design-react19-prebundle",
                setup(build: {
                  onLoad: (
                    options: { filter: RegExp },
                    callback: () => { contents: string; loader: "js" },
                  ) => void;
                }) {
                  build.onLoad({ filter: JSX_RUNTIME_CHUNK }, () => ({ contents: JSX_RUNTIME_SHIM, loader: "js" }));
                  build.onLoad({ filter: DOM_CLIENT_CHUNK }, () => ({ contents: DOM_CLIENT_SHIM, loader: "js" }));
                },
              },
            ],
          },
        },
      };
    },
    load(id) {
      const file = id.split("?")[0];
      if (JSX_RUNTIME_CHUNK.test(file)) return JSX_RUNTIME_SHIM;
      if (DOM_CLIENT_CHUNK.test(file)) return DOM_CLIENT_SHIM;
      return null;
    },
  };
}
