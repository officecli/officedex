import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const componentRoot = fileURLToPath(new URL(".", import.meta.url));
const gitCommonDirectory = execFileSync(
  "git",
  ["-C", componentRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"],
  { encoding: "utf8" },
).trim();
const defaultSourceRoot = path.resolve(path.dirname(gitCommonDirectory), "..", "presentation");
const sourceRoot = path.resolve(
  process.env.PRESENTATION_SOURCE_DIR || defaultSourceRoot,
);
const distDirectory = path.resolve(
  process.env.PRESENTATION_DIST_DIR || path.join(sourceRoot, "dist-officedex"),
);
const fromSource = (...segments: string[]) => path.join(sourceRoot, ...segments);
const sourceDependency = (name: string, ...fallbacks: string[]) => {
  const candidates = [
    fromSource("node_modules", name),
    ...fallbacks.map((entry) => fromSource(entry)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
};

const bundleWebFonts = process.env.PRESENTATION_BUNDLE_WEB_FONTS !== "0";
const desktopFontService = path.join(
  componentRoot,
  "src",
  "web-font-service.desktop.ts",
);
const desktopFontServicePlugin = {
  name: "officedex-desktop-font-service",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    if (bundleWebFonts || source !== "./fonts/web-font-service") return null;
    if (!importer?.replaceAll("\\", "/").endsWith(
      "/packages/presentation-host-browser/src/create-browser-host.ts",
    )) return null;
    return desktopFontService;
  },
};

export default defineConfig({
  root: componentRoot,
  appType: "spa",
  base: "./",
  publicDir: fromSource("packages", "presentation-app", "public"),
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  resolve: {
    alias: {
      "react/jsx-runtime": fromSource("node_modules", "react", "jsx-runtime.js"),
      "react/jsx-dev-runtime": fromSource(
        "packages",
        "presentation-vendor",
        "src",
        "react",
        "jsx-dev-runtime-shim.ts",
      ),
      "react-dom/client": fromSource("node_modules", "react-dom", "client.js"),
      // Subpath aliases must precede the bare "react-dom" entry, or Vite maps
      // "react-dom/server" onto "index.js/server".
      "react-dom/server": fromSource("node_modules", "react-dom", "server.browser.js"),
      "react-dom": fromSource("node_modules", "react-dom", "index.js"),
      react: fromSource("node_modules", "react", "index.js"),
      scheduler: path.join(
        sourceDependency(
          "scheduler",
          "packages/presentation-app/node_modules/scheduler",
        ),
        "index.js",
      ),
      "@learnof/chart": fromSource("packages", "deps", "chart", "src"),
      "@learnof/ink": fromSource("packages", "deps", "ink", "src"),
      "@learnof/scientific-formula": fromSource("packages", "deps", "scientific-formula", "src"),
      "@learnof/shape": fromSource("packages", "deps", "shape", "src"),
      "@learnof/smartart": fromSource("packages", "deps", "smartart", "src"),
      "@learnof/symbol": fromSource("packages", "deps", "symbol", "src"),
      "@mop/runtime": fromSource("mop", "runtime", "index.js"),
      "@presentation/source-main": fromSource(
        "packages",
        "presentation-app",
        "src",
        "main.ts",
      ),
      "@presentation/source-local-runtime-bootstrap": fromSource(
        "packages",
        "presentation-app",
        "src",
        "bootstrap",
        "local-runtime-bootstrap.js",
      ),
      "@presentation/app": fromSource("packages", "presentation-app", "src"),
      "@presentation/assets": fromSource("packages", "presentation-assets", "src"),
      "@presentation/collab": fromSource("packages", "presentation-collab", "src"),
      "@presentation/collaboration-runtime": fromSource(
        "packages",
        "presentation-collaboration-runtime",
        "src",
      ),
      "@presentation/engine": fromSource("packages", "presentation-engine", "src"),
      "@presentation/host-browser": fromSource(
        "packages",
        "presentation-host-browser",
        "src",
      ),
      "@presentation/product": fromSource("packages", "presentation-product", "src"),
      "@presentation/ui-react": fromSource(
        "packages",
        "presentation-ui-react",
        "src",
      ),
      "@presentation/vendor": fromSource("packages", "presentation-vendor", "src"),
    },
  },
  plugins: [desktopFontServicePlugin, react()],
  build: {
    outDir: distDirectory,
    emptyOutDir: true,
  },
});
