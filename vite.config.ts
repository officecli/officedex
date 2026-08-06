import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const realE2E = Boolean(process.env.VITE_OFFICEDEX_REAL_E2E_ENDPOINT);
const alias = [
  {
    find: "@vo-ui/backend",
    replacement: fileURLToPath(new URL("./src/renderer/ui/backends/antd/index.tsx", import.meta.url)),
  },
];

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  resolve: {
    alias,
    dedupe: ["react", "react-dom"],
  },
  server: realE2E ? { hmr: false } : undefined,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["src/renderer/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/verify-wails-app.test.mjs"],
    exclude: ["e2e/**", "node_modules/**", "dist/**", "build/**"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
