import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Select } from "./index";

const options = [
  { value: "pptx", label: "PowerPoint" },
  { value: "docx", label: "Word" },
];

describe("Beautiful UI Select and StrictMode", () => {
  afterEach(() => cleanup());
  it("opens its menu when rendered the way the app renders it", () => {
    render(<Select aria-label="格式" value="pptx" options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /格式/ }));
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(2);
  });

  it("also opens inside StrictMode", () => {
    render(
      <StrictMode>
        <Select aria-label="格式" value="pptx" options={options} onChange={() => {}} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: /格式/ }));
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(2);
  });
});
