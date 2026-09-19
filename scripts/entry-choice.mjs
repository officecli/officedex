/**
 * Which interface a build puts at `/`.
 *
 * `OFFICEDEX_ENTRY=legacy` swaps the two emitted documents, so `/` is the old
 * renderer and `/legacy.html` is the new shell. `shell`, or leaving it unset, is
 * the default the other way round. Everything else about the build is identical
 * — same bundles, same assets, same Go binary.
 *
 * **An unrecognised value throws.** The obvious implementation tests for
 * `"legacy"` and treats everything else as the default, which means `Legacy`,
 * `legcy` and `LEGACY` all quietly produce a shell build: you ask for one
 * interface, get the other, and nothing about the artifact says so — you find
 * out by launching it. The whole point of this switch is knowing which one you
 * are holding, so a typo has to be loud.
 */

export const ENTRY_CHOICES = ["shell", "legacy"];

export function resolveEntryChoice(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "shell";
  if (ENTRY_CHOICES.includes(value)) return value;
  throw new Error(
    `OFFICEDEX_ENTRY=${JSON.stringify(value)} is not one of ${ENTRY_CHOICES.join(" | ")}. `
      + "Unset it for the new shell at /, or use legacy for the previous interface.",
  );
}
