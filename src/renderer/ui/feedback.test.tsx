import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dropdown, Modal, Popover, ToastHost, Tooltip, dialog, toast, type MenuProps } from "./index";
import { useState } from "react";

describe("UI feedback services", () => {
  it("renders and resolves confirm dialogs", async () => {
    const onOk = vi.fn();
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

  it("renders project toasts through the local facade", () => {
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

  it("renders content when a trigger-less controlled popover opens", () => {
    function Fixture() {
      const [open, setOpen] = useState(false);
      return (
        <Popover content={<div>Confirm Idea</div>} open={open} trigger={[]}>
          <button type="button" onClick={() => setOpen(true)}>Open Idea</button>
        </Popover>
      );
    }
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Open Idea" }));
    expect(screen.getByText("Confirm Idea")).toBeTruthy();
  });

  it("mounts force-rendered content before a controlled popover opens", () => {
    render(
      <Popover content={<button type="button">Force rendered idea</button>} open={false} forceRender>
        <button type="button">Idea task</button>
      </Popover>,
    );
    expect(screen.getByText("Force rendered idea")).toBeTruthy();
  });

  it("opens menus and forwards the selected key", () => {
    const onClick = vi.fn();
    const menu: MenuProps = { items: [{ key: "open", label: "Open file" }], onClick };
    render(<Dropdown menu={menu}><button type="button">Actions</button></Dropdown>);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open file" }));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ key: "open" }));
  });

  it("renders declarative modals and tooltips", () => {
    const onOk = vi.fn();
    render(
      <>
        <Tooltip title="Open file"><button type="button">Open</button></Tooltip>
        <Modal open title="Publish" onOk={onOk} onCancel={() => {}}>Body</Modal>
      </>,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Open file");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onOk).toHaveBeenCalledOnce();
  });
});
