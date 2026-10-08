#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const host = process.env.OFFICEDEX_DEV_WEB_HOST || "127.0.0.1";
const port = process.env.OFFICEDEX_DEV_WEB_PORT || "3100";
const vite = path.join(process.cwd(), "node_modules", ".bin", "vite");
const child = spawn(vite, ["--host", host, "--port", port, "--strictPort"], {
  cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"],
});
const log = process.env.OFFICEDEX_DEV_WEB_LOG ? createWriteStream(process.env.OFFICEDEX_DEV_WEB_LOG, { flags: "a", mode: 0o600 }) : null;
for (const [source, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  source.on("data", (chunk) => {
    target.write(chunk);
    log?.write(chunk);
  });
}
child.on("exit", (code, signal) => {
  log?.end();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  if (!child.killed) child.kill(signal);
});
