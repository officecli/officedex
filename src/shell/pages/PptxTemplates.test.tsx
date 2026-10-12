import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { resetLayers } from "../kit/layers";
import { renderShell } from "../test/renderShell";
import type { PptxTemplateAssetSummary } from "../../shared/pptxTemplates";

const template = { id: "company", name: "Company template", sourceFileName: "company.pptx",
  localAssetDir: "/templates/company", version: 3, pageCount: 8, warnings: [], status: "ready" } as unknown as PptxTemplateAssetSummary;
afterEach(() => { resetLayers(); cleanup(); });

it("opens the library, imports a template and sends its binding with the chosen mode", async () => {
  const shell = await renderShell();
  const send = vi.fn().mockResolvedValue(undefined);
  shell.port.agent.send = send;
  let imported = false;
  shell.port.pptxTemplates = {
    list: async () => imported ? [template] : [],
    import: async () => { imported = true; return template; },
    remove: vi.fn(),
  };
  fireEvent.click(screen.getByRole("button", { name: "My PPT templates" }));
  const importButton = screen.getByRole("button", { name: "Import PPT template" });
  await waitFor(() => expect(importButton).not.toBeDisabled());
  expect(screen.getByRole("button", { name: "Generate PPT from selected template" })).toBeDisabled();
  fireEvent.click(importButton);
  await screen.findByText("Company template");
  fireEvent.change(screen.getByLabelText("Presentation brief"), { target: { value: "季度经营方案" } });
  fireEvent.click(screen.getByLabelText("Advanced · Review the plan first"));
  fireEvent.click(screen.getByRole("button", { name: "Generate PPT from selected template" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({
    text: "季度经营方案", documentType: "pptx", generationMode: "plan", newConversation: true,
    pptxTemplate: { id: "company", version: 3, localAssetDir: "/templates/company" },
  })));
});

it("shows import errors without enabling generation", async () => {
  const shell = await renderShell();
  shell.port.pptxTemplates = { list: async () => [], import: async () => { throw new Error("Conversion failed"); }, remove: vi.fn() };
  fireEvent.click(screen.getByRole("button", { name: "My PPT templates" }));
  const button = screen.getByRole("button", { name: "Import PPT template" });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("Conversion failed");
  expect(screen.getByRole("button", { name: "Generate PPT from selected template" })).toBeDisabled();
  expect(button).not.toBeDisabled();
});
