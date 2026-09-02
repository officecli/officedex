import { execFileSync } from "node:child_process";
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
const defaultSourceRoot = path.resolve(path.dirname(gitCommonDirectory), "..", "pptx");
const sourceRoot = path.resolve(
  process.env.PRESENTATION_SOURCE_DIR || defaultSourceRoot,
);
const distDirectory = path.resolve(
  process.env.PRESENTATION_DIST_DIR || path.join(sourceRoot, "dist-officedex"),
);
const fromSource = (...segments: string[]) => path.join(sourceRoot, ...segments);

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
      scheduler: fromSource("node_modules", "scheduler", "index.js"),
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
  plugins: [react()],
  build: {
    outDir: distDirectory,
    emptyOutDir: true,
  },
});
