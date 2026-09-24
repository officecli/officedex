/**
 * The language the shell speaks, told to whatever is mounted in the canvas.
 *
 * The audit found one window running three languages at once: a `lang="en"`
 * shell holding a `lang="zh-CN"` Writer, beside two English editors that could
 * not agree whether the first ribbon tab is "Home" or "Start" (S4-009). Three
 * separate causes, one missing channel — `canvasContract.ts` had no way to say
 * which language anything should be in, so each runtime answered for itself.
 *
 * ── Why a module channel and not React context ──────────────────────────────
 *
 * The obvious wiring is `useLocale()` from `renderer/i18n`, and for `src/shell`
 * that is exactly what happens: W3-J wrapped the whole shell tree in
 * `LocaleProvider` (see `main.tsx`). But the canvas is **a different React
 * tree**. `createDesktopCanvas` calls `createRoot(host)` and renders into it,
 * so nothing mounted in the canvas is a descendant of the shell's providers and
 * no context reaches it. That is not an accident to be fixed: the canvas root
 * has to be able to re-render without the shell, which is most of decision 4.
 *
 * So the shell publishes here and the canvas subscribes here, and both halves
 * read one value.
 *
 * ── Three consumers, one source ─────────────────────────────────────────────
 *
 * 1. **A mounted old-renderer component's own `LocaleProvider`.**
 *    `canvas/PresentationStage.tsx` is the one piece of the old renderer the
 *    shell mounts whole, and it brought that renderer's i18n with it. It was
 *    pinned to `value="en"` because the shell had no locale to give it; now it
 *    reads this. The canvas root itself is also wrapped, so a sheet editor
 *    that calls `useLocale()` sees the same value.
 * 2. **An embed's render language.** `withEmbedLocaleQuery` puts `lang=` on the
 *    iframe URL; Writer's host runtime and the presentation ribbon both read it.
 * 3. **`ui_locale` on a request.** Not a rendering language — a parameter.
 *    `planDocxEdit` writes its summary in it, and that summary is the one
 *    sentence of the whole run the user reads. `canvasLocaleTag()` is what
 *    goes in the request.
 *
 * ── The default is silence ──────────────────────────────────────────────────
 *
 * `readCanvasLocale()` is null until the shell says otherwise, and every
 * consumer must treat null as "keep doing what you did". A canvas root can be
 * mounted by something that is not this shell (a test, the old entry point),
 * and guessing a language for it is how the defect above happened in the first
 * place.
 */

import { useSyncExternalStore } from "react";

export type CanvasLocale = "en" | "zh";

let locale: CanvasLocale | null = null;
const listeners = new Set<() => void>();

/** The shell's current language. Null resets the channel to "nothing said". */
export function publishCanvasLocale(next: CanvasLocale | null): void {
  if (locale === next) return;
  locale = next;
  for (const listener of listeners) listener();
}

export function readCanvasLocale(): CanvasLocale | null {
  return locale;
}

export function subscribeCanvasLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCanvasLocale(): CanvasLocale | null {
  return useSyncExternalStore(subscribeCanvasLocale, readCanvasLocale, readCanvasLocale);
}

/**
 * The BCP-47 tag for a request parameter, or null when the shell has not said.
 *
 * Spelled out rather than sent as `"zh"`: `ui_locale` travels to a backend that
 * matches on a full tag, and the language subtag alone has been read as
 * unrecognised and silently answered in English. Null rather than a default so
 * a caller omits the parameter entirely instead of asserting a language nobody
 * chose.
 */
export function canvasLocaleTag(value: CanvasLocale | null = locale): string | null {
  if (value === "zh") return "zh-CN";
  if (value === "en") return "en-US";
  return null;
}

/**
 * Puts the shell's language on an embed URL, or leaves the URL alone when the
 * shell has not said.
 *
 * `lang` is the name Writer and the presentation runtime already look for. The
 * tag is the BCP-47 form: a bare `"zh"` has been read as unrecognised. An
 * existing `lang` is replaced so a configured `VITE_*_EDITOR_URL` that already
 * carries one still follows the shell.
 */
export function withEmbedLocaleQuery(url: string, value: CanvasLocale | null = locale): string {
  const tag = canvasLocaleTag(value);
  if (!tag) return url;
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const withoutHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  if (/[?&]lang=/i.test(withoutHash)) {
    return `${withoutHash.replace(/([?&]lang=)[^&]*/i, `$1${tag}`)}${hash}`;
  }
  const joiner = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${joiner}lang=${tag}${hash}`;
}
