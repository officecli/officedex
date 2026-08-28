import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStageShell } from "./ArtifactStageShell";
import { ArtifactStageStatusBanner } from "./StageStatus";

afterEach(() => cleanup());

describe("ArtifactStageStatusBanner", () => {
  it.each([
    ["pending", "Pending"],
    ["running", "In progress"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
  ] as const)("renders %s status", (status, label) => {
    render(<ArtifactStageStatusBanner status={status} message="Editing the artifact" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-status", status);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("Editing the artifact")).toBeTruthy();
  });

  it("shows cancel only while pending or running and invokes it", async () => {
    const onCancel = vi.fn(async () => undefined);
    const { rerender } = render(<ArtifactStageStatusBanner status="running" onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    rerender(<ArtifactStageStatusBanner status="completed" onCancel={onCancel} />);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("shows retry for failed/cancelled and exposes action errors", async () => {
    const onRetry = vi.fn(async () => { throw new Error("retry unavailable"); });
    render(<ArtifactStageStatusBanner status="failed" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("retry unavailable");
  });
});

describe("ArtifactStageShell status integration", () => {
  it("renders the lifecycle status before the stage surface", () => {
    const adapter = { capabilityTier: "T1" as const, getScopes: () => [{ id: "document", label: "Whole document" }] };
    const { container } = render(<ArtifactStageShell adapter={adapter} selection={{}} status="pending" stage={<div>Preview</div>} />);
    const shell = container.querySelector(".artifact-stage-shell")!;
    expect(shell.firstElementChild).toHaveAttribute("data-status", "pending");
    expect(screen.getByText("Preview")).toBeTruthy();
  });
});
