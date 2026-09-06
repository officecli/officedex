import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OfficeProductOutputsPanel } from "./OfficeProductOutputsPanel";

describe("OfficeProductOutputsPanel", () => {
  it("shows lineage and asks for approval for protected outputs", () => {
    const onApprove = vi.fn();
    render(<OfficeProductOutputsPanel outputs={[{ id: "doc", projectId: "p", type: "document", title: "Weekly report", version: 2, status: "succeeded", manuallyEdited: true, lineage: { workbookId: "book", viewIds: ["v"], sourceIds: [], workbookFingerprint: "v2", capturedAt: "" }, updatedAt: "" }]} queue={[{ id: "doc:content", plan: { outputId: "doc", changedViews: ["v"], strategy: "content", preserveManualEdits: true, requiresApproval: true }, status: "awaiting_confirmation", attempts: 0 }]} onApprove={onApprove} />);
    expect(screen.getByText("Weekly report")).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve refresh" }));
    expect(onApprove).toHaveBeenCalledOnce();
  });
});
