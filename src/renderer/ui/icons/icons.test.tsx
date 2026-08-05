import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AddIcon, FileIcon, LoadingOutlined, SettingsIcon } from "./index";

describe("project icon boundary", () => {
  it("exports accessible semantic icons and compatibility names", () => {
    render(
      <>
        <AddIcon aria-label="Add" />
        <FileIcon aria-label="File" />
        <SettingsIcon aria-label="Settings" />
        <LoadingOutlined aria-label="Loading" spin />
      </>,
    );
    expect(screen.getByLabelText("Add")).toBeTruthy();
    expect(screen.getByLabelText("Loading")).toHaveClass("ui-icon--spin");
  });
});
