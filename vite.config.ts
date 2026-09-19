import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolveWord2MowConvert, resolveWriterFontsDir } from "./scripts/writer-source.mjs";
import { word2mowDevConverter, writerFontsDevAssets } from "./writer-component/dev-middleware";
import { isolateSheetSdkChunk } from "./scripts/sdk-sheet-chunks.mjs";
import { resolveEntryChoice } from "./scripts/entry-choice.mjs";

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

/**
 * Chooses which interface the build puts at `/`.
 *
 * `OFFICEDEX_ENTRY=legacy` swaps the two emitted documents, so `/` is the old
 * renderer and `/legacy.html` is the new shell. `shell`, or leaving it unset, is
 * the default the other way round. Everything else about the build is identical
 * — same bundles, same assets, same Go binary.
 *
 * **An unrecognised value fails the build.** The obvious implementation tests
 * for `"legacy"` and treats everything else as the default, which means
 * `Legacy`, `legcy` and `LEGACY` all quietly produce a shell build — you ask for
 * one interface, get the other, and nothing says so. The whole point of this
 * switch is to know which one you are holding, so a typo has to be loud.
 *
 * A rename rather than a source-file swap, and it happens only after a
 * successful build. Swapping index.html and legacy.html on disk around a build
 * works too, right up until the build fails and leaves the repository holding
 * two files that claim to be something they are not.
 *
 * Safe because Vite is configured with `base: "./"`: both documents reference
 * `./assets/...` and both sit in the output root, so which name a document has
 * does not change what it resolves.
 */
function legacyEntrySwap(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "officedex-legacy-entry",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
      // Thrown here rather than in closeBundle: a misspelled flag should stop
      // the build before it spends two minutes producing the wrong artifact.
      resolveEntryChoice(process.env.OFFICEDEX_ENTRY);
    },
    async closeBundle() {
      if (resolveEntryChoice(process.env.OFFICEDEX_ENTRY) !== "legacy") return;
      const outDir = path.resolve(config.root, config.build.outDir);
      const shell = path.join(outDir, "index.html");
      const legacy = path.join(outDir, "legacy.html");
      const [shellHtml, legacyHtml] = await Promise.all([
        readFile(shell, "utf8"),
        readFile(legacy, "utf8"),
      ]);
      await Promise.all([
        writeFile(shell, legacyHtml),
        writeFile(legacy, shellHtml),
      ]);
      config.logger.warn("[officedex] entry: the previous interface is at /, the new shell at /legacy.html");
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
    legacyEntrySwap(),
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
      // `index.html` is the new IA; the old renderer is still built, at
      // `legacy.html`, because it remains the only home of several capabilities
      // (accounts, the vertical connectors, the image surfaces) and is a way
      // back for anyone the new shell cannot yet serve.
      //
      // Both have to be listed: Vite's dev server serves any HTML it finds, so
      // a second entry works in `npm run dev` without appearing here — and then
      // is missing from every packaged build, which is exactly what happened to
      // shell.html before this list existed.
      input: {
        main: path.resolve(__dirname, "index.html"),
        legacy: path.resolve(__dirname, "legacy.html"),
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
