import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolveWord2MowConvert, resolveWriterFontsDir } from "./scripts/writer-source.mjs";
import { word2mowDevConverter, writerFontsDevAssets } from "./writer-component/dev-middleware";
import { isolateSheetSdkChunk } from "./scripts/sdk-sheet-chunks.mjs";

const realE2EEndpoint = process.env.VITE_OFFICEDEX_REAL_E2E_ENDPOINT?.trim();
// The bridge endpoint used to imply "this is a test run, so no HMR". That
// coupled two unrelated things: every real-bridge dev session (scripts/dev-real.mjs)
// also lost hot updates, which is exactly when you want them most. The official
// suite sets this explicitly instead, so long-lived sessions keep HMR.
const realE2ENoHMR = process.env.OFFICEDEX_E2E_NO_HMR === "1";
const alias = [{ find: "@vo-ui/backend", replacement: fileURLToPath(new URL("./src/renderer/ui/backend.ts", import.meta.url)) }];

const sdkSheetAssetRoutes = [
  {
    prefix: "/sdk-sheet/",
    root: fileURLToPath(new URL("./node_modules/@shimo/sdk-sheet/lib", import.meta.url)),
  },
  {
    prefix: "/sdk-sheet-locales/",
    root: fileURLToPath(new URL("./node_modules/@shimo/sdk-sheet/locales", import.meta.url)),
  },
];

function sdkSheetDevAssets(): Plugin {
  return {
    name: "officedex-sdk-sheet-dev-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const route = sdkSheetAssetRoutes.find(({ prefix }) => pathname.startsWith(prefix));
        if (!route) {
          next();
          return;
        }

        void (async () => {
          try {
            const relativePath = decodeURIComponent(pathname.slice(route.prefix.length));
            const resolvedRoot = path.resolve(route.root);
            const resolvedPath = path.resolve(resolvedRoot, relativePath);
            if (
              !relativePath.endsWith(".js") ||
              resolvedPath === resolvedRoot ||
              !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
            ) {
              response.statusCode = 404;
              response.end("Not found");
              return;
            }
            const info = await lstat(resolvedPath);
            if (!info.isFile() || info.isSymbolicLink()) {
              response.statusCode = 404;
              response.end("Not found");
              return;
            }
            const content = Buffer.from(isolateSheetSdkChunk(relativePath, await readFile(resolvedPath, "utf8")));
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/javascript; charset=utf-8");
            response.setHeader("Content-Length", String(content.byteLength));
            response.end(content);
          } catch {
            response.statusCode = 404;
            response.end("Not found");
          }
        })();
      });
    },
  };
}

function sdkSheetBuildAssets(): Plugin {
  let config: ResolvedConfig;

  return {
    name: "officedex-sdk-sheet-build-assets",
    apply: "build",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async writeBundle() {
      const outDir = path.resolve(config.root, config.build.outDir);
      await mkdir(outDir, { recursive: true });
      await Promise.all(
        sdkSheetAssetRoutes.map(({ prefix, root }) =>
          cp(root, path.join(outDir, prefix.replaceAll("/", "")), { recursive: true }),
        ),
      );
      const sdkDir = path.join(outDir, "sdk-sheet");
      await Promise.all((await readdir(sdkDir)).filter((name) => name.endsWith(".chunk.js")).map(async (name) => {
        const chunkPath = path.join(sdkDir, name);
        await writeFile(chunkPath, isolateSheetSdkChunk(name, await readFile(chunkPath, "utf8")));
      }));
    },
  };
}

export default defineConfig({
  plugins: [
    sdkSheetDevAssets(),
    sdkSheetBuildAssets(),
    // The Writer embed talks to /api/import, /api/export and
    // /writer-next-default-fonts/**, which internal/word2mowhttp and
    // internal/writerfonts answer in a packaged app. The dev server never
    // reaches Go, so it answers them here instead.
    word2mowDevConverter({ convertPath: resolveWord2MowConvert() }),
    writerFontsDevAssets({ root: resolveWriterFontsDir() }),
    react(),
  ],
  root: ".",
  base: "./",
  resolve: {
    alias,
    dedupe: ["react", "react-dom"],
  },
  server: realE2EEndpoint ? {
    ...(realE2ENoHMR ? { hmr: false } : {}),
    proxy: {
      "/__officedex_bridge": {
        target: realE2EEndpoint,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/__officedex_bridge/, ""),
      },
    },
  } : undefined,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      // Two entries while the new IA is built alongside the old one. Vite's dev
      // server serves any HTML it finds, so shell.html worked in `npm run dev`
      // without this — but a production build only packages what is listed
      // here, which is why it was missing from every packaged app until now.
      input: {
        main: path.resolve(__dirname, "index.html"),
        shell: path.resolve(__dirname, "shell.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["src/renderer/test/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "presentation-component/src/**/*.test.ts",
      "writer-component/**/*.test.ts",
      "scripts/verify-wails-app.test.mjs",
    ],
    exclude: ["e2e/**", "node_modules/**", "dist/**", "build/**"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
