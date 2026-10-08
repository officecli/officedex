import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../renderer/i18n";
import { CanvasPlaceholder } from "./CanvasPlaceholder";
import { fixtureGenerationTask } from "./slidesGenerating/generationTaskFixtures";

afterEach(() => cleanup());

describe("CanvasPlaceholder slides generating", () => {
  it("keeps the static skeleton when it is not a live generation", () => {
    const { container } = render(<CanvasPlaceholder type="slides" />);
    expect(container.querySelector(".shell-skeleton-slide")).not.toBeNull();
    expect(container.querySelector("[data-testid='shell-slides-generating']")).toBeNull();
  });

  it("mounts the generating canvas for a live research run", () => {
    const { container } = render(
      <LocaleProvider value="en">
        <CanvasPlaceholder type="slides" mode="generating" task={fixtureGenerationTask("research")} />
      </LocaleProvider>,
    );
    expect(container.querySelector("[data-testid='shell-slides-generating']")).not.toBeNull();
    expect(container.querySelector("[data-phase='research']")).not.toBeNull();
    expect(container.querySelector(".od-mark")).not.toBeNull();
  });

  it("does not paint the grey slide skeleton during research", () => {
    const { container } = render(
      <LocaleProvider value="en">
        <CanvasPlaceholder type="slides" mode="generating" task={fixtureGenerationTask("research")} />
      </LocaleProvider>,
    );
    expect(container.querySelector(".shell-skeleton-slide")).toBeNull();
    expect(container.querySelector(".shell-skeleton-filmstrip")).toBeNull();
    expect(container.querySelector("[data-testid='shell-slides-generating']")).not.toBeNull();
  });

  it("draws a looping PPT skeleton on the outline paper and filmstrip", () => {
    const { container } = render(
      <LocaleProvider value="en">
        <CanvasPlaceholder type="slides" mode="generating" task={fixtureGenerationTask("outline")} />
      </LocaleProvider>,
    );
    expect(container.querySelector("[data-testid='shell-slides-generating']")).not.toBeNull();
    expect(container.querySelector("[data-phase='outline']")).not.toBeNull();
    expect(container.querySelector(".shell-gen-slide.is-sketch")).not.toBeNull();
    expect(container.querySelectorAll(".shell-gen-thumb")).toHaveLength(5);
    expect(container.querySelectorAll(".shell-gen-thumb-title")).toHaveLength(5);
    expect(container.querySelector(".shell-skeleton-filmstrip")).toBeNull();
  });

  it("keeps the looping PPT skeleton once slide writing starts", () => {
    const { container } = render(
      <LocaleProvider value="en">
        <CanvasPlaceholder type="slides" mode="generating" task={fixtureGenerationTask("writing")} />
      </LocaleProvider>,
    );
    expect(container.querySelector("[data-testid='shell-slides-generating']")).not.toBeNull();
    expect(container.querySelector("[data-phase='writing']")).not.toBeNull();
    expect(container.querySelector(".shell-gen-slide.is-sketch")).not.toBeNull();
    expect(container.querySelector(".shell-gen-thumb.is-current")).not.toBeNull();
    expect(container.querySelector(".shell-skeleton-slide")).toBeNull();
    expect(container.querySelector(".shell-skeleton-filmstrip")).toBeNull();
  });

  it("keeps the looping PPT skeleton while slides are being drawn", () => {
    const { container } = render(
      <LocaleProvider value="en">
        <CanvasPlaceholder type="slides" mode="generating" task={fixtureGenerationTask("drawing")} />
      </LocaleProvider>,
    );
    expect(container.querySelector("[data-testid='shell-slides-generating']")).not.toBeNull();
    expect(container.querySelector("[data-phase='drawing']")).not.toBeNull();
    expect(container.querySelector(".shell-skeleton-slide")).toBeNull();
  });
});
