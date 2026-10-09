import { describe, expect, it } from "vitest";
import { requestsReadOnlyAnswer } from "./documentReadOnly";

describe("explicit read-only document requests", () => {
  it.each([
    'Reply exactly "LOCAL-A-19". Do not create or edit any file.',
    "Read this file and tell me its title. Do not modify the file.",
    "Read-only: does the document contain Alpha?",
    "只读回答文件的标题，不要修改任何文件。",
  ])("prevents writes for %s", prompt => expect(requestsReadOnlyAnswer(prompt)).toBe(true));
  it.each([
    "Replace Beta with Delta. Do not modify the file until I approve.",
    "Propose a replacement. Do not save the file yet.",
    "Translate this document into French.",
  ])("keeps actual edits reviewable: %s", prompt => expect(requestsReadOnlyAnswer(prompt)).toBe(false));
});
