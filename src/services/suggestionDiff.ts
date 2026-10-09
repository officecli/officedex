import { strFromU8, unzipSync } from "fflate";
import type { DesktopAPI } from "../shared/types";

export interface SuggestionChange { part: string; before: string; after: string }

/** Read actual OOXML text; never use the model's description as a diff. */
export function officeTextParts(data: Uint8Array): Map<string, string> {
  const files = unzipSync(data, { filter: (entry) => /^(word\/(document|header\d+|footer\d+)|ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)|xl\/(sharedStrings|worksheets\/sheet\d+))\.xml$/.test(entry.name) });
  const parts = new Map<string, string>();
  for (const name of Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const doc = new DOMParser().parseFromString(strFromU8(files[name]), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid document XML");
    const paragraphs = [...doc.getElementsByTagNameNS("*", "p")];
    const text = paragraphs.length
      ? paragraphs.map(p => [...p.getElementsByTagNameNS("*", "t")].map(t => t.textContent ?? "").join("")).join("\n")
      : [...doc.getElementsByTagNameNS("*", "t"), ...doc.getElementsByTagNameNS("*", "v"), ...doc.getElementsByTagNameNS("*", "f")].map(t => t.textContent ?? "").join("\n");
    parts.set(name, text);
  }
  return parts;
}

export async function readSuggestionChanges(api: DesktopAPI, source: string, artifact: string): Promise<SuggestionChange[]> {
  const read = async (filePath: string) => {
    // A modification of a selected external file lives beside that file.
    // Its sibling proposal is outside preview roots and has not been opened
    // yet. Review explicitly opens these two files; register each exact path
    // through the same import boundary as Open, never trust its whole folder.
    await api.importLocalFile(filePath);
    const grant = await api.issuePreviewToken({ filePath, fileName: filePath.split(/[\\/]/).pop()!, documentType: filePath.split(".").pop()! });
    try {
      const { data } = await api.readArtifactFile(grant.token);
      return officeTextParts(data instanceof Uint8Array ? data : new Uint8Array(data));
    } finally { await api.revokePreviewToken(grant.token); }
  };
  const [before, after] = await Promise.all([read(source), read(artifact)]);
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(part => {
    const old = before.get(part) ?? "", next = after.get(part) ?? "";
    if (old === next) return [];
    // Keep unchanged paragraph context out of the review for long documents.
    const a = old.split("\n"), b = next.split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length, endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    return [{ part, before: a.slice(start, endA).join("\n"), after: b.slice(start, endB).join("\n") }];
  });
}
