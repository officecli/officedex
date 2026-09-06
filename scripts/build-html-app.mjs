import { build } from "vite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
if (!existsSync(resolve(root, "index.html"))) {
  throw new Error(`HTML App root does not contain index.html: ${root}`);
}
process.chdir(root);
await build({ root: ".", logLevel: "info", configFile: false, build: { outDir: "dist", emptyOutDir: true } });
