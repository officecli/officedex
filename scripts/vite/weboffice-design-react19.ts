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

export function webofficeDesignReact19(): Plugin {
  return {
    name: "weboffice-design-react19-runtime",
    enforce: "pre",
    load(id) {
      const file = id.split("?")[0];
      if (JSX_RUNTIME_CHUNK.test(file)) {
        return [
          'import { Fragment, jsx, jsxs } from "react/jsx-runtime";',
          "export const j = { Fragment, jsx, jsxs };",
        ].join("\n");
      }
      if (DOM_CLIENT_CHUNK.test(file)) {
        return [
          'import { createRoot, hydrateRoot } from "react-dom/client";',
          "export const c = { createRoot, hydrateRoot };",
        ].join("\n");
      }
      return null;
    },
  };
}
