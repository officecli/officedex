import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DialogHost, Popover, ToastHost, dialog, toast } from "./index";

describe("UI feedback services", () => {
  it("renders and resolves confirm dialogs", async () => {
    const onOk = vi.fn();
    render(<DialogHost />);

    act(() => {
      dialog.confirm({
        title: "Remove project?",
        content: "Files stay on disk.",
        okText: "Remove",
        onOk,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onOk).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText("Remove project?")).toBeNull());
  });

  it("renders project toasts without AntD", () => {
    render(<ToastHost />);

    act(() => {
      toast.error("File is missing");
    });

    expect(screen.getByRole("status")).toHaveTextContent("File is missing");
  });

  it("renders popover content in a portal and closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <Popover content={<div>Project actions</div>} open onOpenChange={onOpenChange}>
        <button type="button">More</button>
      </Popover>,
    );

    expect(screen.getByText("Project actions")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
