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

  it("routes lifecycle controls", async () => {
    const onSteer = vi.fn(async () => undefined);
    const onPause = vi.fn(async () => undefined);
    render(<LiveSteeringBar onSteer={onSteer} onPause={onPause} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(onPause).toHaveBeenCalledOnce());
  });

  it("keeps the bar's promise neutral until the host says the run is live", () => {
    // The same bar serves a live run and a finished deck, and the two do
    // different things with the text, so the wording comes from the host.
    const { unmount } = render(<LiveSteeringBar onSteer={vi.fn()} />);
    expect(screen.getByPlaceholderText("Describe the next change")).toBeTruthy();
    unmount();
    render(<StageIntentBar onSubmit={vi.fn()} placeholder="Tell OfficeDex what to change from the next slide" />);
    expect(screen.getByPlaceholderText("Tell OfficeDex what to change from the next slide")).toBeTruthy();
  });
});
