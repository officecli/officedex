import { describe, expect, it } from "vitest";
import { en } from "./en";
import { zh } from "./zh";

const PROPER_NOUNS = ["OfficeDex", "OfficeCLI", "Bridge", "JWT", "API", "Credits", "PROMO2026", "Anthropic", "OpenAI", "GitHub"];
const ASCII_TECHNICAL = /^[\x20-\x7E]+$/;
const ZH_ONLY_PREFIXES = ["dialogue.imageTemplates.slotLabel."];

function isZhOnlyKey(key: string): boolean {
  return ZH_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

describe("i18n dictionaries", () => {
  it("zh has every key in en", () => {
    for (const key of Object.keys(en)) {
      expect(zh[key], `missing key in zh: ${key}`).toBeDefined();
    }
  });

  it("en has every key in zh", () => {
    for (const key of Object.keys(zh)) {
      if (isZhOnlyKey(key)) continue;
      expect(en[key], `missing key in en: ${key}`).toBeDefined();
    }
  });

  it("zh values are translated (not identical to en) unless they are proper nouns or technical strings", () => {
    for (const key of Object.keys(en)) {
      const enValue = en[key];
      const zhValue = zh[key];
      if (enValue === zhValue) {
        const isProperNounOnly = PROPER_NOUNS.some((noun) => enValue === noun);
        const isTechnical = ASCII_TECHNICAL.test(enValue) && PROPER_NOUNS.some((noun) => enValue.includes(noun));
        const isUrl = enValue.startsWith("http");
        const isPlaceholderOnly = /^\{[^}]+\}$/.test(enValue);
        const isPlaceholderTemplate = /^[\s\{\}\w·\-\/.]*$/.test(enValue) && /\{[^}]+\}/.test(enValue);
        const isCopyright = enValue.startsWith("©");
        const isPromoCode = enValue === "PROMO2026";
        const isApiKeyPlaceholder = enValue === "API key";
        const isLicenseIdentifier = /^[A-Z][A-Z0-9.-]+$/.test(enValue);
        const isPunctuationOnly = /^[\s\-·.,:;]+$/.test(enValue);
        expect(
          isProperNounOnly || isTechnical || isUrl || isPlaceholderOnly || isPlaceholderTemplate || isCopyright || isPromoCode || isApiKeyPlaceholder || isLicenseIdentifier || isPunctuationOnly,
          `zh[${key}] is identical to en value but not whitelisted: ${enValue}`,
        ).toBe(true);
      }
    }
  });

  it("preserves placeholders across languages", () => {
    for (const key of Object.keys(en)) {
      const enVars = (en[key].match(/\{[^}]+\}/g) ?? []).sort();
      const zhVars = (zh[key].match(/\{[^}]+\}/g) ?? []).sort();
      expect(zhVars, `placeholder drift on ${key}: en=${enVars.join(",")} zh=${zhVars.join(",")}`).toEqual(enVars);
    }
  });
});
