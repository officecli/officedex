/**
 * Skills and the PPT template reference — 1.0.12 §五, UI-16.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PptxTemplateAssetSummary } from "../../shared/pptxTemplates";
import { resetComposerDrafts } from "../composer/Composer";
import { resetLayers } from "../kit/layers";
import { createFakePptxTemplates, type FakePptxTemplates } from "../port/fake/fakePptxTemplates";
import { renderShell } from "../test/renderShell";

afterEach(() => {
  resetLayers();
  resetComposerDrafts();
  cleanup();
});

const quarterly: PptxTemplateAssetSummary = {
  id: "tpl-quarterly",
  name: "Quarterly review",
  sourceFileName: "Quarterly review.pptx",
  localAssetDir: "/templates/quarterly",
  status: "ready",
  version: 3,
  pageCount: 12,
  supportedPageTypes: [],
  assetCounts: { logo: 1, icons: 2, images: 3, decorative: 1 },
  warnings: [],
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

async function shell(templates: FakePptxTemplates = createFakePptxTemplates()) {
  const harness = await renderShell({ fastAgent: true, pptxTemplates: templates });
  const find = <T extends HTMLElement>(selector: string) => harness.view.container.querySelector<T>(selector);
  return { ...harness, templates, find };
}

const press = async (element: Element | null) => {
  await act(async () => {
    fireEvent.click(element!);
  });
};

async function openTemplates(view: Awaited<ReturnType<typeof shell>>) {
  await press(view.find("#dx-sidebar [data-act=skills]"));
  await press(view.find("[data-act=skill-open-templates]"));
}

describe("Skills in the sidebar", () => {
  it("is a nav item with a Beta label that is not a control of its own", async () => {
    const view = await shell();
    const skills = view.find("#dx-sidebar [data-act=skills]")!;
    expect(skills.textContent).toContain("Skills");
    const beta = skills.querySelector(".dx-nav-beta")!;
    expect(beta.textContent).toBe("Beta");
    expect(beta.closest("button")).toBe(skills);
    expect(beta.getAttribute("aria-hidden")).toBe("true");
  });

  it("opens the skill cards, not the templates themselves", async () => {
    const view = await shell(createFakePptxTemplates([quarterly]));
    await press(view.find("#dx-sidebar [data-act=skills]"));
    expect(view.state().page).toBe("skills");
    expect(view.find("[data-act=skill-open-templates]")).not.toBeNull();
    await waitFor(() => expect(view.find("[data-act=skill-open-templates]")!.textContent).toContain("1 ready"));
    expect(view.find(".dx-skill-card")).toBeNull();
  });
});

describe("the PPT Templates page", () => {
  it("chooses a file, confirms its name, and learns only when asked", async () => {
    const view = await shell();
    await openTemplates(view);
    expect(view.state().skillsSection).toBe("ppt-templates");
    expect(view.find(".dx-skills-empty")).not.toBeNull();

    await press(view.find(".dx-skills-empty [data-act=skill-upload]"));
    const dialog = document.querySelector<HTMLElement>("dialog#dx-modal")!;
    const learn = dialog.querySelector<HTMLButtonElement>("[data-act=skill-learn]")!;
    expect(learn.disabled).toBe(true);

    await press(dialog.querySelector("[data-act=skill-pick]"));
    const name = dialog.querySelector<HTMLInputElement>("input[name=template-name]")!;
    expect(name.value).toBe("Quarterly review");
    fireEvent.change(name, { target: { value: "Board deck" } });
    await press(learn);

    await waitFor(() => expect(view.find(".dx-skill-card[data-skill^=tpl-fake]")).not.toBeNull());
    expect(view.find(".dx-skill-card h3")!.textContent).toBe("Board deck");
    expect(view.find(".dx-skills-template-heading")!.textContent).toContain("1 ready");
  });

  it("refuses a name another template has", async () => {
    const view = await shell(createFakePptxTemplates([quarterly]));
    await openTemplates(view);
    await waitFor(() => expect(view.find(".dx-skill-card")).not.toBeNull());
    await press(view.find(".dx-skills-manager-header [data-act=skill-upload]"));
    const dialog = document.querySelector<HTMLElement>("dialog#dx-modal")!;
    await press(dialog.querySelector("[data-act=skill-pick]"));
    await press(dialog.querySelector("[data-act=skill-learn]"));
    expect(dialog.querySelector("[role=alert]")!.textContent).toMatch(/already exists/);
  });

  it("shows a failure on its card and learns the same file again on Retry", async () => {
    const templates = createFakePptxTemplates();
    templates.failNext = true;
    const view = await shell(templates);
    await openTemplates(view);
    await press(view.find("[data-act=skill-upload]"));
    const dialog = document.querySelector<HTMLElement>("dialog#dx-modal")!;
    await press(dialog.querySelector("[data-act=skill-pick]"));
    await press(dialog.querySelector("[data-act=skill-learn]"));

    await waitFor(() => expect(view.find(".dx-skill-card[data-status=failed]")).not.toBeNull());
    expect(view.find(".dx-skill-card[data-status=failed] .dx-skill-error")!.textContent).toContain("could not be learned");
    await press(view.find("[data-act=skill-retry]"));
    await waitFor(() => expect(view.find(".dx-skill-card[data-status=failed]")).toBeNull());
    expect(view.find("[data-act=skill-use]")).not.toBeNull();
  });

  it("keeps learning while the user is elsewhere", async () => {
    const templates = createFakePptxTemplates();
    templates.stepMs = 15;
    const view = await shell(templates);
    await openTemplates(view);
    await press(view.find("[data-act=skill-upload]"));
    const dialog = document.querySelector<HTMLElement>("dialog#dx-modal")!;
    await press(dialog.querySelector("[data-act=skill-pick]"));
    await press(dialog.querySelector("[data-act=skill-learn]"));
    expect(view.find(".dx-skill-card[data-status=learning]")).not.toBeNull();

    await view.dispatch({ type: "go", page: "home" });
    await waitFor(async () => expect(await templates.port.list()).toHaveLength(1), { timeout: 2000 });
    await openTemplates(view);
    expect(view.find(".dx-skill-card[data-status=learning]")).toBeNull();
    expect(view.find("[data-act=skill-use]")).not.toBeNull();
  });

  it("goes back to the skill cards from its breadcrumb", async () => {
    const view = await shell();
    await openTemplates(view);
    await press(view.find("[data-act=skill-library]"));
    expect(view.state()).toMatchObject({ page: "skills", skillsSection: "library" });
  });
});

describe("a template referenced with /", () => {
  const homeInput = (view: Awaited<ReturnType<typeof shell>>) =>
    view.find<HTMLTextAreaElement>(".dx-home-composer textarea[data-draft]")!;

  async function typeAt(input: HTMLTextAreaElement, value: string) {
    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
    });
  }

  it("goes in at the caret, keeps the words around it, and is sent as the template's snapshot", async () => {
    const view = await shell(createFakePptxTemplates([quarterly]));
    const send = vi.fn().mockResolvedValue(undefined);
    view.port.agent.send = send;
    const input = homeInput(view);

    await typeAt(input, "Make a deck /quar");
    const menu = await screen.findByRole("listbox", { name: "Template Skills" });
    await press(within(menu).getByRole("option", { name: /Quarterly review/ }));
    expect(input.value).toBe("Make a deck /Quarterly review ");
    expect(view.find(".dx-skill-inline-mirror mark")!.textContent).toBe("/Quarterly review");

    await typeAt(input, "Make a deck /Quarterly review about Q3 results");
    await press(view.find(".dx-home-composer [data-act=send]"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Make a deck about Q3 results",
          documentType: "pptx",
          pptxTemplate: { id: "tpl-quarterly", version: 3, localAssetDir: "/templates/quarterly" },
        }),
      ),
    );
  });

  it("cannot be sent on its own", async () => {
    const view = await shell(createFakePptxTemplates([quarterly]));
    const input = homeInput(view);
    await typeAt(input, "/");
    await press(within(await screen.findByRole("listbox", { name: "Template Skills" })).getByRole("option"));
    expect(view.find<HTMLButtonElement>(".dx-home-composer [data-act=send]")!.disabled).toBe(true);
  });

  it("drops the reference when the token is edited, and keeps the words", async () => {
    const view = await shell(createFakePptxTemplates([quarterly]));
    const input = homeInput(view);
    await typeAt(input, "/");
    await press(within(await screen.findByRole("listbox", { name: "Template Skills" })).getByRole("option"));
    await typeAt(input, "/Quarterly revie and more");
    expect(view.find(".dx-skill-inline-mirror mark")).toBeNull();
    expect(input.value).toBe("/Quarterly revie and more");
  });

  it("offers only Ready templates, and a way to Skills", async () => {
    const view = await shell(createFakePptxTemplates([{ ...quarterly, id: "tpl-busy", name: "Half learned", status: "analyzing" }]));
    await typeAt(homeInput(view), "/");
    const menu = await screen.findByRole("listbox", { name: "Template Skills" });
    expect(within(menu).queryByRole("option")).toBeNull();
    await press(within(menu).getByRole("button", { name: /Add template/ }));
    expect(view.state()).toMatchObject({ page: "skills", skillsSection: "ppt-templates" });
  });

  it("comes back to Home's input from a card's Use", async () => {
    const view = await shell(createFakePptxTemplates([quarterly]));
    await openTemplates(view);
    await waitFor(() => expect(view.find("[data-act=skill-use]")).not.toBeNull());
    await press(view.find("[data-act=skill-use]"));
    expect(view.state().page).toBe("home");
    await waitFor(() => expect(homeInput(view).value).toBe("/Quarterly review "));
  });
});
