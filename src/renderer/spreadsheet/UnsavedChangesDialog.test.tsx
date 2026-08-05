import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

afterEach(() => cleanup());

describe("UnsavedChangesDialog", () => {
  it("offers save, discard, and cancel actions", () => {
    const onSave = vi.fn(async () => true);
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    render(<UnsavedChangesDialog open saving={false} onSave={onSave} onDiscard={onDiscard} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Save and Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
