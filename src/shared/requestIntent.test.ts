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
