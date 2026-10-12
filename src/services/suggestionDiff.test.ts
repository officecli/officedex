import { describe, it, expect, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readSuggestionChanges } from "./suggestionDiff";
import type { DesktopAPI } from "../shared/types";
const doc = (text: string) => zipSync({ "word/document.xml": strToU8(`<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:t>Delta</w:t></w:r></w:p></w:body></w:document>`) });
describe("actual proposal diff", () => {
  it("shows changed content and revokes both preview grants", async () => {
    const revoke = vi.fn();
    const registered = new Set<string>();
    const api = { importLocalFile: async (path: string) => { registered.add(path); },
      issuePreviewToken: async ({ filePath }: { filePath: string }) => {
        if (!registered.has(filePath)) throw new Error("preview: artifact is not registered for local preview");
        return { token: filePath };
      },
      readArtifactFile: async (token: string) => ({ data: doc(token === "/source.docx" ? "Beta &amp; old" : "Gamma &amp; new") }),
      revokePreviewToken: revoke } as unknown as DesktopAPI;
    expect(await readSuggestionChanges(api, "/source.docx", "/proposal.docx")).toEqual([
      { part: "word/document.xml", before: "Beta & old", after: "Gamma & new" },
    ]);
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});

it("N27-01 Review reads an authorized proposal without importing a second document", async () => {
  const imported = vi.fn(async () => ({})); const revoke = vi.fn();
  const source = "/external/OD27-attachment.docx";
  const proposal = "/external/.officedex-proposal-123/OD27-attachment.modified.docx";
  const api = { importLocalFile: imported,
    issuePreviewToken: async ({filePath}: {filePath: string}) => ({token:filePath}),
    readArtifactFile: async (token: string) => ({data:doc(token===source?"Gamma pending.":"Gamma approved.")}),
    revokePreviewToken: revoke,
  } as unknown as DesktopAPI;
  expect(await readSuggestionChanges(api,source,proposal)).toEqual([{part:"word/document.xml",before:"Gamma pending.",after:"Gamma approved."}]);
  expect(imported).toHaveBeenCalledExactlyOnceWith(source);
  expect(revoke).toHaveBeenCalledTimes(2);
});
