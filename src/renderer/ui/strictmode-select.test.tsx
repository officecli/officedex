import { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Select } from "./index";

const options = [
  { value: "pptx", label: "PowerPoint" },
  { value: "docx", label: "Word" },
];

/**
 * weboffice-design@0.18.0's layered components do not survive StrictMode's
 * double mount: the dropdown layer is torn down by the first effect cleanup and
 * never re-registers, so the menu can no longer open. Nothing in the app can fix
 * this, so `main.tsx` renders without StrictMode and this pair of tests pins the
 * behaviour down — the second one starts failing when upstream fixes it, which
 * is the signal to put StrictMode back.
 */
describe("design-system Select and StrictMode", () => {
  it("opens its menu when rendered the way the app renders it", () => {
    render(<Select aria-label="格式" value="pptx" options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /格式/ }));
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(2);
  });

  it("still cannot open inside StrictMode (upstream limitation)", () => {
    render(
      <StrictMode>
        <Select aria-label="格式" value="pptx" options={options} onChange={() => {}} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: /格式/ }));
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });
});
