import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FlatArtifactViewer from "./FlatArtifactViewer";

vi.mock("../../bridge", () => ({
  officecli: {
    readArtifactFile: vi.fn(async () => ({ data: new Uint8Array([137, 80, 78, 71]) })),
  },
}));

afterEach(cleanup);

describe("FlatArtifactViewer", () => {
  it("loads preview bytes locally and emits an identity-only shared intent", async () => {
    const onArtifactStageEdit = vi.fn(async (_intent: unknown) => undefined);
    render(
      <FlatArtifactViewer
        previewToken="preview-token"
        fileName="hero.png"
        documentType="img"
        artifact={{ filePath: "/tmp/hero.png", fileName: "hero.png", documentType: "png", taskId: "task-image" }}
        onArtifactStageEdit={onArtifactStageEdit}
      />,
    );

    await screen.findByRole("group", { name: "Artifact region selection" });
    fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Remove the background" } });
    fireEvent.click(screen.getByRole("button", { name: "Request redraw" }));

    await waitFor(() => expect(onArtifactStageEdit).toHaveBeenCalledWith(expect.objectContaining({
      action: "redraw",
      costClass: "heavy",
      target: expect.objectContaining({ artifactPath: "/tmp/hero.png", documentType: "img" }),
      scope: { kind: "document" },
    })));
    expect(JSON.stringify(onArtifactStageEdit.mock.calls[0][0])).not.toContain("base64");
  });

  it("renders the runtime fail-closed error without retrying", async () => {
    const onArtifactStageEdit = vi.fn(async (_intent: unknown) => {
      throw new Error("IMG redraw requires a newer OfficeCLI runtime. No request was sent.");
    });
    render(
      <FlatArtifactViewer
        previewToken="preview-token"
        fileName="hero.png"
        documentType="img"
        artifact={{ filePath: "/tmp/hero.png", fileName: "hero.png", documentType: "png" }}
        onArtifactStageEdit={onArtifactStageEdit}
      />,
    );
    await screen.findByRole("group", { name: "Artifact region selection" });
    fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Remove it" } });
    fireEvent.click(screen.getByRole("button", { name: "Request redraw" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No request was sent/);
    expect(onArtifactStageEdit).toHaveBeenCalledTimes(1);
  });
});
