import { describe, expect, it } from "vitest";

import { classifyFileFailure, describeFailure, embeddedErrorCode, fileFailureMessageKey } from "./fileFailure";
import { isEditorRuntimeMissing } from "./editorRuntime";

/**
 * The words a failure gets are decided here, from what the host said.
 *
 * What the host says is written for whoever debugs a converter — an HTTP
 * status, a JSON body, a scratch path — and none of it may reach the status
 * line. These pin the mapping on the three texts actually observed: the Go
 * host's refused write, the converter's 400, and Writer's own export failure.
 */
describe("file failures", () => {
  const importFailure =
    'DOCX import failed with HTTP 400: {"error":"DOCX_CONVERSION_FAILED","message":"zip: not a valid zip file",'
    + '"detail":"/var/folders/8t/x/T/writer-docx-import-123/input.docx"}';

  it("reads the converter's error code out of the JSON body it quotes", () => {
    expect(embeddedErrorCode(importFailure)).toBe("DOCX_CONVERSION_FAILED");
    expect(embeddedErrorCode("INVALID_DOCX_FILE: The DOCX upload was empty.")).toBe("INVALID_DOCX_FILE");
    expect(embeddedErrorCode("permission denied")).toBeNull();
  });

  it("calls a converter rejection a damaged document, and keeps the host's text as detail", () => {
    const failure = describeFailure("open", importFailure, 7);
    expect(failure).toMatchObject({ kind: "open", reason: "invalid-docx", at: 7 });
    expect(failure.detail).toBe(importFailure);
    expect(fileFailureMessageKey(failure)).toBe("dx.failure.open.invalidDocx");
  });

  it("calls a refused write a permission problem", () => {
    const refused = new Error("save docx: write: open /Users/qa/readonly.docx: permission denied");
    expect(classifyFileFailure("save", refused)).toBe("permission-denied");
    expect(fileFailureMessageKey(describeFailure("save", refused))).toBe("dx.failure.save.permission");
  });

  it("tells a file changed outside the app apart from a refused write", () => {
    expect(classifyFileFailure("save", "save docx: source file changed outside OfficeDex; reopen it before saving"))
      .toBe("source-changed");
    expect(classifyFileFailure("save", "write: no space left on device")).toBe("disk-full");
    expect(classifyFileFailure("save", "The Writer editor could not export the document.")).toBe("unknown");
  });

  it("maps an upload the host would not take to its own sentence", () => {
    expect(classifyFileFailure("open", '{"error":"REQUEST_TOO_LARGE","message":"The DOCX upload exceeds the allowed size."}'))
      .toBe("too-large");
    expect(fileFailureMessageKey({ kind: "open", reason: "unknown" })).toBe("dx.failure.open.unknown");
  });
});

/**
 * Only an editor that is not there is a gap. The rest is the editor refusing
 * a document, which is a failure to show and keep.
 */
describe("editor runtime", () => {
  it("recognises the leaves' own words for a runtime that is not staged", () => {
    expect(isEditorRuntimeMissing("Writer component assets are not installed.")).toBe(true);
    expect(isEditorRuntimeMissing("Unsupported Writer protocol 3.")).toBe(true);
    expect(
      isEditorRuntimeMissing(
        "The Word editor did not start. Its window loaded but never reported ready — "
          + "usually a missing or broken Writer runtime in this build.",
      ),
    ).toBe(true);
    expect(isEditorRuntimeMissing("The Word editor could not start. Writer component assets are not installed.")).toBe(true);
  });

  it("does not mistake a rejected document for a missing editor", () => {
    expect(isEditorRuntimeMissing('DOCX import failed with HTTP 400: {"error":"DOCX_CONVERSION_FAILED"}')).toBe(false);
    expect(isEditorRuntimeMissing(new Error("preview token refused: file is outside the workspace"))).toBe(false);
    expect(isEditorRuntimeMissing("")).toBe(false);
  });
});
