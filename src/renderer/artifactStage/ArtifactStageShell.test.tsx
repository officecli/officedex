import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStageShell, type ArtifactStageActionContext, type ArtifactStageAdapter, type ArtifactStageSelection } from "./ArtifactStageShell";

interface FixtureSelection extends ArtifactStageSelection {
  readonly selectedId: string | null;
}

const action = vi.fn(async (_payload: unknown) => undefined);

afterEach(() => {
  cleanup();
  action.mockClear();
});

function fixtureAdapter(tier: ArtifactStageAdapter<FixtureSelection>["capabilityTier"] = "T3"): ArtifactStageAdapter<FixtureSelection> {
  return {
    capabilityTier: tier,
    getScopes: (selection) => selection.selectedId ? [
      { id: "item", label: "Selected item" },
      { id: "document", label: "Whole document" },
    ] : [{ id: "document", label: "Whole document" }],
    getCost: (scope) => scope.id === "item" ? "metered" : "heavy",
    getPlaceholder: (scope) => scope?.id === "item" ? "Describe the item change" : "Describe the document change",
    getAction: ({ instruction, scope, selection }) => ({
      id: "rewrite",
      label: "Apply",
      execute: () => action({ instruction, scopeId: scope.id, selection }),
    }),
  };
}

describe("ArtifactStageShell", () => {
  it("renders T3 in stage, timeline, then the single intent bar order", () => {
    const { container } = render(
      <ArtifactStageShell
        adapter={fixtureAdapter()}
        selection={{ selectedId: "one" }}
        stage={<div data-testid="stage">Stage</div>}
        timeline={<div data-testid="timeline">Timeline</div>}
      />,
    );

    const children = Array.from(container.querySelector(".artifact-stage-shell")!.children);
    expect(children.map((child) => child.getAttribute("data-slot"))).toEqual(["stage", "timeline", "intent"]);
  });

  it("does not render a stage slot for T0", () => {
    const { container } = render(
      <ArtifactStageShell adapter={fixtureAdapter("T0")} selection={{ selectedId: null }} stage={<div>Should be hidden</div>} />,
    );
    expect(container.querySelector('[data-slot="stage"]')).toBeNull();
    expect(screen.getByPlaceholderText("Describe the document change")).toBeTruthy();
  });

  it("can hide the intent slot while a blocking gate owns the Stage", () => {
    const { container } = render(<ArtifactStageShell adapter={fixtureAdapter()} selection={{ selectedId: null }} hideIntent stage={<div>Gate</div>} />);
    expect(container.querySelector('[data-slot="intent"]')).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Artifact intent" })).toBeNull();
  });

  it("shows the adapter-selected scope and cost", () => {
    render(<ArtifactStageShell adapter={fixtureAdapter()} selection={{ selectedId: "one" }} />);
    expect(screen.getByRole("button", { name: "Selected item" })).toHaveAttribute("data-cost", "metered");
    expect(screen.getByRole("button", { name: "Whole document" })).toHaveAttribute("data-cost", "heavy");
  });

  it("converges the selected scope when selection removes it", () => {
    const adapter = fixtureAdapter();
    const { rerender } = render(<ArtifactStageShell adapter={adapter} selection={{ selectedId: "one" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Selected item" }));
    expect(screen.getByRole("button", { name: "Selected item" })).toHaveAttribute("aria-pressed", "true");
    rerender(<ArtifactStageShell adapter={adapter} selection={{ selectedId: null }} />);
    expect(screen.getByRole("button", { name: "Whole document" })).toHaveAttribute("aria-pressed", "true");
  });

  it("routes Enter through the adapter action", async () => {
    render(<ArtifactStageShell adapter={fixtureAdapter()} selection={{ selectedId: "one" }} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Make it clearer" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(action).toHaveBeenCalledWith(expect.objectContaining({ instruction: "Make it clearer", scopeId: "document" })));
  });

  it("prevents duplicate mutations while an action is busy", async () => {
    let resolve: (() => void) | undefined;
    const pending = new Promise<void>((done) => { resolve = done; });
    const busyAction = vi.fn((_payload: unknown) => pending);
    const adapter: ArtifactStageAdapter<FixtureSelection> = {
      ...fixtureAdapter(),
      getAction: ({ instruction, scope, selection }: ArtifactStageActionContext<FixtureSelection>) => ({
        id: "rewrite",
        execute: () => busyAction({ instruction, scopeId: scope.id, selection }),
      }),
    };
    render(<ArtifactStageShell adapter={adapter} selection={{ selectedId: "one" }} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Run once" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(busyAction).toHaveBeenCalledTimes(1));
    resolve?.();
    await pending;
  });

  it("releases the internal busy state after an action resolves and allows another submit", async () => {
    let resolve: (() => void) | undefined;
    const pending = new Promise<void>((done) => { resolve = done; });
    const submitAction = vi.fn()
      .mockImplementationOnce(() => pending)
      .mockImplementationOnce(() => undefined);
    const adapter: ArtifactStageAdapter<FixtureSelection> = {
      ...fixtureAdapter(),
      getAction: ({ instruction, scope, selection }: ArtifactStageActionContext<FixtureSelection>) => ({
        id: "rewrite",
        execute: () => submitAction({ instruction, scopeId: scope.id, selection }),
      }),
    };
    render(<ArtifactStageShell adapter={adapter} selection={{ selectedId: "one" }} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "First" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input).toBeDisabled());

    resolve?.();
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "Second" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(submitAction).toHaveBeenCalledTimes(2));
  });

  it("shows a visible error and releases busy when an action rejects", async () => {
    const adapter: ArtifactStageAdapter<FixtureSelection> = {
      ...fixtureAdapter(),
      getAction: () => ({
        id: "rewrite",
        execute: async () => {
          throw new Error("Stage service unavailable");
        },
      }),
    };
    render(<ArtifactStageShell adapter={adapter} selection={{ selectedId: "one" }} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Run once" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Stage service unavailable");
    expect(input).toBeEnabled();
  });

  it("shows postpaid settlement semantics instead of a pre-execution cost estimate", () => {
    render(
      <ArtifactStageShell
        adapter={fixtureAdapter()}
        selection={{ selectedId: "one" }}
        billing={{ mode: "account", balance: -12 }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Outstanding 12 credits · billed after completion");
    expect(screen.queryByText(/^metered$/i)).toBeNull();
    expect(screen.queryByText(/^heavy$/i)).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Make it clearer" } });
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("reports settled actual usage and resulting balance", () => {
    render(
      <ArtifactStageShell
        adapter={fixtureAdapter()}
        selection={{ selectedId: "one" }}
        billing={{ mode: "account", balance: -12, settlement: "settled", settledCredits: 8 }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Used 8 credits · outstanding 12 credits");
  });

  it("keeps anonymous exhaustion as an explicit submission gate", () => {
    render(
      <ArtifactStageShell
        adapter={fixtureAdapter()}
        selection={{ selectedId: "one" }}
        billing={{ mode: "anonymous", anonymousExhausted: true }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sign in required");
    expect(screen.getByRole("alert")).toHaveTextContent("Anonymous credits are used up");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });


  it("uses the adapter dynamic default scope when selection changes", async () => {
    const adapter: ArtifactStageAdapter<FixtureSelection> = {
      ...fixtureAdapter(),
      getDefaultScopeId: (selection, scopes) => selection.selectedId ? scopes.find((scope) => scope.id === "item")?.id : "document",
    };
    const { rerender } = render(<ArtifactStageShell adapter={adapter} selection={{ selectedId: null }} />);
    expect(screen.getByRole("button", { name: "Whole document" })).toHaveAttribute("aria-pressed", "true");
    rerender(<ArtifactStageShell adapter={adapter} selection={{ selectedId: "one" }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Selected item" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("renders timeline only when supplied", () => {
    const { container } = render(<ArtifactStageShell adapter={fixtureAdapter()} selection={{ selectedId: "one" }} />);
    expect(container.querySelector('[data-slot="timeline"]')).toBeNull();
  });

  it("allows a type adapter to retain its existing intent UI during migration", () => {
    render(
      <ArtifactStageShell
        adapter={fixtureAdapter()}
        selection={{ selectedId: "one" }}
        intent={<div data-testid="custom-intent">Custom intent</div>}
      />,
    );
    expect(screen.getByTestId("custom-intent")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Artifact intent" })).toBeNull();
  });
});
