import { describe, expect, it } from "vitest";

import { insertTemplateToken, promptWithoutTemplate, slashQueryAt, templateTokenIndex, type TemplateReference } from "./templateReference";

const quarterly: TemplateReference = { id: "q", name: "Quarterly review", version: 2, localAssetDir: "/t/q" };
const board: TemplateReference = { id: "b", name: "Board", version: 1, localAssetDir: "/t/b" };

describe("the inline template reference", () => {
  it("finds the / being typed at the caret, and only there", () => {
    expect(slashQueryAt("Make a deck /quar", 17)).toEqual({ start: 12, query: "quar" });
    expect(slashQueryAt("/", 1)).toEqual({ start: 0, query: "" });
    expect(slashQueryAt("a/b", 3)).toBeNull();
    // Template names have spaces, so the query runs to the caret — but not across a line.
    expect(slashQueryAt("Make /quar later", 16)).toEqual({ start: 5, query: "quar later" });
    expect(slashQueryAt("Make /quar\nlater", 16)).toBeNull();
  });

  it("goes in at the caret, keeping the words around it", () => {
    const text = "Make a deck /quar about Q3";
    const { text: next, caret } = insertTemplateToken(text, 12, 17, quarterly, null);
    expect(next).toBe("Make a deck /Quarterly review about Q3");
    // The text already had a space after the query; the caret sits before it.
    expect(caret).toBe("Make a deck /Quarterly review".length);
    expect(promptWithoutTemplate(next, quarterly)).toBe("Make a deck about Q3");
  });

  it("replaces an earlier template rather than adding a second", () => {
    const first = insertTemplateToken("/q", 0, 2, quarterly, null).text;
    const withMore = `${first}for the board /bo`;
    const { text } = insertTemplateToken(withMore, withMore.length - 3, withMore.length, board, quarterly);
    expect(text).toBe("for the board /Board ");
    expect(templateTokenIndex(text, quarterly)).toBe(-1);
  });

  it("is gone once the user edits into it", () => {
    expect(templateTokenIndex("/Quarterly revie about", quarterly)).toBe(-1);
    expect(templateTokenIndex("x/Quarterly review", quarterly)).toBe(-1);
    expect(templateTokenIndex("Use /Quarterly review", quarterly)).toBe(4);
  });

  it("leaves nothing to send when the template is all there is", () => {
    expect(promptWithoutTemplate("/Quarterly review ", quarterly)).toBe("");
  });
});
