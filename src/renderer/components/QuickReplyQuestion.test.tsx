import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickReplyQuestion } from "./QuickReplyQuestion";

afterEach(() => cleanup());

const options = [
  { id: "detailed", label: "Detailed comparison", description: "One row per region with revenue, growth, team and key accounts." },
  { id: "summary", label: "Summary table", description: "Core metrics only.", recommended: true },
  { id: "analysis", label: "Table + brief analysis" },
];

describe("QuickReplyQuestion", () => {
  it("renders the question as an assistant message with one chip per option", () => {
    render(<QuickReplyQuestion question="How detailed should the sheet be?" options={options} allowFreeform onSelect={vi.fn()} />);
    expect(screen.getByText("AI · Question")).toBeInTheDocument();
    expect(screen.getByText("How detailed should the sheet be?")).toBeInTheDocument();
    const chips = screen.getAllByRole("button");
    expect(chips.map((chip) => chip.getAttribute("aria-label"))).toEqual(["Detailed comparison", "Summary table · Recommended", "Table + brief analysis"]);
    expect(screen.getByText("Pick one, or type your own answer below.")).toBeInTheDocument();
  });

  it("answers on click and explains the hovered option in the shared note", () => {
    const onSelect = vi.fn();
    render(<QuickReplyQuestion question="Q" options={options} allowFreeform onSelect={onSelect} />);
    const detailed = screen.getByRole("button", { name: "Detailed comparison" });
    fireEvent.mouseEnter(detailed);
    expect(screen.getByText("One row per region with revenue, growth, team and key accounts.")).toBeInTheDocument();
    fireEvent.mouseLeave(detailed);
    expect(screen.getByText("Pick one, or type your own answer below.")).toBeInTheDocument();
    fireEvent.click(detailed);
    expect(onSelect).toHaveBeenCalledWith("detailed");
  });

  it("drops the chip highlight while a custom answer is being typed", () => {
    const { rerender } = render(<QuickReplyQuestion question="Q" options={options} selectedOptionId="summary" allowFreeform onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /summary table/i })).toHaveAttribute("aria-pressed", "true");
    rerender(<QuickReplyQuestion question="Q" options={options} selectedOptionId="summary" freeformDraft="Split by month" allowFreeform onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /summary table/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Your typed answer will be used instead.")).toBeInTheDocument();
  });

  it("selects with the number keys while the set is short", () => {
    const onSelect = vi.fn();
    render(<QuickReplyQuestion question="Q" options={options} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("group", { name: "Quick replies" }), { key: "2" });
    expect(onSelect).toHaveBeenCalledWith("summary");
    fireEvent.keyDown(screen.getByRole("group", { name: "Quick replies" }), { key: "9" });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("hides number keys once there are more than four options", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ id: `o${index}`, label: `Option ${index + 1}` }));
    render(<QuickReplyQuestion question="Q" options={many} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Option 1" }).textContent).toBe("Option 1");
  });

  it("locks the chips for an answered question but keeps the chosen one lit", () => {
    render(<QuickReplyQuestion question="Q" options={options} selectedOptionId="analysis" readOnly onSelect={vi.fn()} />);
    const chosen = screen.getByRole("button", { name: "Table + brief analysis" });
    expect(chosen).toBeDisabled();
    expect(chosen).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Already answered")).toBeInTheDocument();
  });
});
