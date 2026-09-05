import { existsSync } from "node:fs";
import path from "node:path";

export interface MopRuntimeSourceOptions {
  fallbackEntry: string;
  preferredRoot: string;
  requirePreferred?: boolean;
  exists?: (candidate: string) => boolean;
}

/**
 * Keeps the browser MOP validator on the same checkout as the Rust converter.
 * The fallback is the runtime materialized in the Presentation source archive,
 * which remains necessary for release builds that do not carry a ppt2mop repo.
 */
export function resolveMopRuntimeEntry({
  fallbackEntry,
  preferredRoot,
  requirePreferred = false,
  exists = existsSync,
}: MopRuntimeSourceOptions): string {
  const entry = path.join(preferredRoot, "runtime", "index.js");
  const layout = path.join(preferredRoot, "spec", "mop", "layout.json");
  if (exists(entry) && exists(layout)) return entry;
  if (requirePreferred) {
    throw new Error(
      `PPT2MOP_SOURCE_DIR is incomplete at ${preferredRoot}; expected runtime/index.js and spec/mop/layout.json.`,
    );
  }
  return fallbackEntry;
}
