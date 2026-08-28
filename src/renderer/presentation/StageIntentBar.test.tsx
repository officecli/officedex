import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSteeringBar } from "./LiveSteeringBar";
import { StageIntentBar } from "./StageIntentBar";

afterEach(() => cleanup());

describe("StageIntentBar", () => {
  it("submits a trimmed stage instruction and clears the input", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<StageIntentBar onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "Stage instruction" });
    fireEvent.change(input, { target: { value: "  tighten slide  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("tighten slide"));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("routes lifecycle controls and exposes the live steering label", async () => {
    const onSteer = vi.fn(async () => undefined);
    const onPause = vi.fn(async () => undefined);
    render(<LiveSteeringBar onSteer={onSteer} onPause={onPause} />);
    expect(screen.getByPlaceholderText("Tell OfficeDex what to change from the next slide")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(onPause).toHaveBeenCalledOnce());
  });
});
