import type { FontService } from "@presentation/engine/host/font-service";
import lucideIconsWoff2FontUrl from "@presentation/assets/fonts/lucide-icons.woff2";
import remixIconsWoff2FontUrl from "@presentation/assets/fonts/remix-icons.woff2";
import { isFontUsable } from "@presentation/host-browser/fonts/font-usability";

function detectDesktopFontPlatform(): FontService["platform"] {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac")) return "mac";
  return "linux";
}

// The desktop WebView can use fonts installed by the operating system. Keep
// the small icon faces bundled, but do not package the ~67 MB CJK webfonts
// used by the browser-only presentation build.
export const browserFontService: FontService = {
  platform: detectDesktopFontPlatform(),
  bundledFonts: [
    {
      family: "RemixIcon",
      url: remixIconsWoff2FontUrl,
      weight: 400,
      italic: false,
    },
    {
      family: "Lucide",
      url: lucideIconsWoff2FontUrl,
      weight: 400,
      italic: false,
    },
  ],
  isAvailable(font) {
    return typeof document !== "undefined" && Boolean(document.fonts?.check(font));
  },
  isUsable(family, weight, italic) {
    return isFontUsable(family, weight, italic);
  },
  async load(font, text) {
    if (typeof document === "undefined" || !document.fonts) return;
    await document.fonts.load(font, text);
  },
  async loadFace(registration) {
    const fontFace = new FontFace(
      registration.family,
      `url(${registration.url})`,
      registration.descriptors,
    );
    document.fonts.add(fontFace);
    await fontFace.load();
  },
};
