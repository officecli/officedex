import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stageCss = readFileSync(`${process.cwd()}/src/renderer/presentation/progressivePptxStage.css`, "utf8");

describe("PPTX stage reading order", () => {
  /**
   * The audit's finding was that the step rail, the live op stream, the editor
   * and the command bar shared one viewport, pushing the main action below the
   * fold. The rail is pinned while its pages scroll, and the CTA travels with
   * the reader.
   */
  it("pins the active step header while its pages scroll", () => {
    expect(stageCss).toContain(".is-active > .pptx-flow-step__header { position: sticky; top: 0;");
  });

  /**
   * Sticky makes the header the containing block for the node it carries, so the
   * node has to cancel the step's own inset or it slides right by that amount.
   */
  it("keeps the step node on the rail after the header starts sticking", () => {
    expect(stageCss).toContain("--pptx-step-pad: 33px");
    expect(stageCss).toContain("padding: 0 0 32px var(--pptx-step-pad)");
    expect(stageCss).toContain(".is-active > .pptx-flow-step__header .pptx-flow-node { left: calc(-13px - var(--pptx-step-pad)); }");
    expect(stageCss).toContain(".pptx-flow-step { --pptx-step-pad: 23px; }");
  });

  it("gives every step header the same box so switching steps cannot shift the page", () => {
    expect(stageCss).toContain(".pptx-flow-step__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0;");
    // The extra padding must not be re-declared for the active step only.
    expect(stageCss).not.toContain(".is-active > .pptx-flow-step__header { position: sticky; top: 0; z-index: 2; padding:");
  });

  it("reserves the outline status line so a status word cannot reflow the list", () => {
    expect(stageCss).toContain(".pptx-flow-outline__state { min-height: 1.6em; }");
  });

  /**
   * The bar is pinned across the whole scroller because the component renders it
   * as a sibling of the disclosure. Pinning the stage itself, as it used to be,
   * bounded it to the generation step and hid the main actions whenever the
   * reader was looking at an earlier step.
   */
  it("pins the main actions to the bottom only while pages are being produced", () => {
    expect(stageCss).toContain('.progressive-pptx-stage[data-generation="true"] .pptx-flow-actions { position: sticky; bottom: 0;');
    expect(stageCss).not.toContain('.progressive-pptx-stage[data-generation="true"] .pptx-production-stage--compact { position: sticky;');
  });

  it("clears the pinned bar using its measured height rather than a guessed number", () => {
    expect(stageCss).toContain('.progressive-pptx-stage[data-generation="true"] .pptx-flow-follow { bottom: calc(16px + var(--pptx-actions-h, 0px)); }');
  });
});
