import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { webofficeDesignReact19 } from "./scripts/vite/weboffice-design-react19";

const realE2E = Boolean(process.env.VITE_OFFICEDEX_REAL_E2E_ENDPOINT);
const realE2EHMR = process.env.VITE_OFFICEDEX_REAL_E2E_HMR === "1";
const alias = [
  {
    find: "@vo-ui/backend",
    replacement: fileURLToPath(new URL("./src/renderer/ui/backend.ts", import.meta.url)),
  },
];

export default defineConfig({
  plugins: [webofficeDesignReact19(), react()],
  root: ".",
  base: "./",
  resolve: {
    alias,
    dedupe: ["react", "react-dom"],
  },
  server: realE2E && !realE2EHMR ? { hmr: false } : undefined,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    // weboffice-design must go through the vite plugin pipeline so the React 19
    // runtime shim applies; vitest externalises node_modules deps by default.
    server: { deps: { inline: ["weboffice-design"] } },
    environment: "jsdom",
    globals: false,
    setupFiles: ["src/renderer/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/verify-wails-app.test.mjs"],
    exclude: ["e2e/**", "node_modules/**", "dist/**", "build/**"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
