import { describe, expect, it } from "vitest";
import { instructionText, reviewRequestedBy, requestsCopyOnly } from "./requestIntent";
import { inferHomeTaskRoute, requestsNewFile } from "../renderer/homeIntake";

describe("instructions and literal document content", () => {
  for (const [open, close] of [["“", "”"], ['"', '"'], ["'", "'"], ["「", "」"], ["『", "』"], ["`", "`"], ["```\n", "\n```"]]) {
    it(`does not route replacement text delimited by ${open} as a command`, () => {
      const prompt = `Edit current.docx: replace ${open}create a document${close} with ${open}create a spreadsheet${close}. Review it first.`;
      expect(requestsNewFile(prompt)).toBe(false);
      expect(reviewRequestedBy(prompt)).toBe(true);
      expect(inferHomeTaskRoute({ prompt })).toMatchObject({ documentType: "docx" });
    });
  }
  it("does not let quoted review wording override full access", () => {
    expect(reviewRequestedBy('Replace “do not apply” with “approved”. Apply now.')).toBe(false);
    expect(reviewRequestedBy("Don't apply yet")).toBe(true);
  });
  it("preserves explicit new deliverables and their quoted filenames", () => {
    expect(requestsNewFile('Create a new document named "hello.docx" with the sentence “create a spreadsheet”.')).toBe(true);
    expect(inferHomeTaskRoute({ prompt: 'Create a document named "hello.docx" with “create a spreadsheet”.' })).toMatchObject({ documentType: "docx" });
    expect(instructionText("Don't apply yet")).toBe("Don't apply yet");
  });
});

it.each(["Save a modified copy; keep the original unchanged", "请另存为副本", "Do not overwrite the source", "Save each as a separate modified copy"])("preserves originals for %s", prompt => expect(requestsCopyOnly(prompt)).toBe(true));
it("does not interpret quoted copy instructions as permission", () => expect(requestsCopyOnly('Replace “save a modified copy” with “done”.')).toBe(false));

it("treats command words in a quoted filename as data while retaining its type", () => {
  const prompt = 'Edit "create a document.docx": fix the typo.';
  expect(requestsNewFile(prompt)).toBe(false);
  expect(reviewRequestedBy('Edit "do not apply.docx" now.')).toBe(false);
  expect(requestsCopyOnly('Edit "save a copy.docx" now.')).toBe(false);
  expect(inferHomeTaskRoute({prompt})).toMatchObject({documentType:"docx"});
});

describe("UX28-02: a negated new file or copy is a review of the source", () => {
  const attachment = "仅处理附件 UX28-review.docx。把 Alpha is settled. 改为 Alpha is reviewed.，保留其他内容。先展示 Review 差异并等待我确认，不要直接写回，也不要生成说明文档或副本。";
  const current = "在当前文档把 Alpha is settled. 改为 Alpha is reviewed.，其他内容不变。先展示 Review 差异，等待我点击应用；不要新建文档。";
  it.each([attachment, current])("edits the source with review for %s", prompt => {
    expect(requestsNewFile(prompt)).toBe(false);
    expect(requestsCopyOnly(prompt)).toBe(false);
    expect(reviewRequestedBy(prompt)).toBe(true);
  });
  it("still reads a positive request for a new document", () => {
    expect(requestsNewFile("新建一个文档写周报")).toBe(true);
    expect(requestsNewFile("不要改原文，生成一份新文档")).toBe(true);
  });
});
