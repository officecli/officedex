import { describe, expect, it } from "vitest";
import { en } from "./en";
import { homeEn } from "./home";
import { shellAgentEn, shellAgentZh } from "./shellAgent";
import { shellComposerEn, shellComposerZh } from "./shellComposer";
import { shellImageHomeEn, shellImageHomeZh } from "./shellImageHome";
import { shellServicesEn, shellServicesZh } from "./shellServices";

const PARTS: Array<[string, Record<string, string>, Record<string, string>]> = [
  ["shellComposer", shellComposerEn, shellComposerZh],
  ["shellImageHome", shellImageHomeEn, shellImageHomeZh],
  ["shellAgent", shellAgentEn, shellAgentZh],
  ["shellServices", shellServicesEn, shellServicesZh],
];

/** Values that read the same in both languages: product/model names and bare placeholders. */
const SAME_IN_BOTH = /^(?:[\s{}\w.·:/+-]*\{[^}]+\}[\s{}\w.·:/+-]*|OfficeDex|Anthropic|Kimi|Jira|API key|Base URL|Model ID|Seedream 5\.0 Pro|GPT Image 2|Nano Banana 2)$/;

describe("shell dictionaries", () => {
  for (const [name, enPart, zhPart] of PARTS) {
    describe(name, () => {
      it("has the same keys in en and zh", () => {
        expect(Object.keys(zhPart).sort()).toEqual(Object.keys(enPart).sort());
      });

      it("keeps placeholders across languages", () => {
        for (const key of Object.keys(enPart)) {
          const vars = (value: string) => (value.match(/\{[^}]+\}/g) ?? []).sort();
          expect(vars(zhPart[key] ?? ""), key).toEqual(vars(enPart[key]));
        }
      });

      it("translates every zh value", () => {
        for (const key of Object.keys(enPart)) {
          const value = zhPart[key];
          if (value === enPart[key] && SAME_IN_BOTH.test(value)) continue;
          expect(/[一-鿿]/.test(value), `zh[${key}] is not Chinese: ${value}`).toBe(true);
        }
      });

      it("adds keys instead of silently overriding existing ones", () => {
        for (const key of Object.keys(enPart)) {
          expect(key in en || key in homeEn, `${key} already exists in en.ts/home.ts`).toBe(false);
        }
      });
    });
  }

  it("never defines one key in two shell parts", () => {
    const seen = new Map<string, string>();
    for (const [name, enPart] of PARTS) {
      for (const key of Object.keys(enPart)) {
        expect(seen.get(key), `${key} is in both ${seen.get(key)} and ${name}`).toBeUndefined();
        seen.set(key, name);
      }
    }
  });
});
