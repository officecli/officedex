import { test, expect, type Page } from "@playwright/test";
import { emitBridgeEvent, getBridgeCalls, installBridgeMock } from "./fixtures/bridge-mock";

function generateButton(page: Page) {
  return page.locator("button").filter({ hasText: /^Generate$/ }).first();
}

function picker(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(label, "i") });
}

async function pickDocumentType(page: Page, label: string) {
  // FluidNewGeneration renders a Radio.Group with the 5 document type options.
  // Each renders as a label wrapping an input; we click the label text.
  await page.locator("label").filter({ hasText: new RegExp(`^${label}$`) }).first().click();
}

test.describe("Generation flow", () => {
  test("submits a pptx generate request with the typed prompt", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");

    const composer = page.getByPlaceholder(/enter what you want to generate/i);
    await expect(composer).toBeVisible();
    await composer.fill("Generate a Q3 launch deck");
    await generateButton(page).click();

    await expect.poll(async () => (await getBridgeCalls(page, "generate")).length).toBe(1);
    const calls = await getBridgeCalls(page, "generate");
    expect(calls[0][0]).toMatchObject({ documentType: "pptx", prompt: "Generate a Q3 launch deck" });
  });

  test("task.started -> task.progress -> task.completed renders Generation Complete", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");

    await page.getByPlaceholder(/enter what you want to generate/i).fill("Build a roadmap deck");
    await generateButton(page).click();
    await expect.poll(async () => (await getBridgeCalls(page, "generate")).length).toBe(1);

    await emitBridgeEvent(page, {
      event_id: "ev-start", task_id: "mock-task-1", type: "task.started",
      payload: { document_type: "pptx", topic: "Roadmap deck", message: "Task started" },
    });
    await expect(page.getByText(/Processing your request/i).first()).toBeVisible();

    await emitBridgeEvent(page, {
      event_id: "ev-progress", task_id: "mock-task-1", type: "task.progress",
      payload: { stage: "Generating outline" },
    });

    await emitBridgeEvent(page, {
      event_id: "ev-done", task_id: "mock-task-1", type: "task.completed",
      ts: "2026-05-22T11:00:00+08:00",
      payload: {
        message: "Deck ready",
        result: { file_path: "/tmp/roadmap.pptx", file_name: "roadmap.pptx", document_type: "pptx" },
      },
    });

    await expect(page.getByText(/Generation Complete/i).first()).toBeVisible();
    await expect(page.getByText("roadmap.pptx").first()).toBeVisible();
  });

  test("task.failed surfaces failed terminal state with the bridge error", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await expect(page.getByPlaceholder(/enter what you want to generate/i)).toBeVisible();
    await emitBridgeEvent(page, {
      event_id: "ev-fail", task_id: "mock-task-fail", type: "task.failed",
      payload: { message: "model quota exceeded" },
    });
    await expect(page.getByText(/Generation Failed/i).first()).toBeVisible();
    await expect(page.getByText("model quota exceeded").first()).toBeVisible();
  });

  test("task.cancelled surfaces cancelled terminal state", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await expect(page.getByPlaceholder(/enter what you want to generate/i)).toBeVisible();
    await emitBridgeEvent(page, {
      event_id: "ev-cancel", task_id: "mock-task-cancel", type: "task.cancelled",
      payload: { message: "User cancelled" },
    });
    await expect(page.getByText(/Task Cancelled/i).first()).toBeVisible();
    await expect(page.getByText("User cancelled").first()).toBeVisible();
  });

  test("task.question option click calls respond with the picked option id", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await expect(page.getByPlaceholder(/enter what you want to generate/i)).toBeVisible();

    await emitBridgeEvent(page, {
      event_id: "ev-q", task_id: "mock-task-q", type: "task.question",
      payload: {
        id: "q-1",
        question: "Include financials?",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
        allow_freeform: false,
      },
    });

    await expect(page.getByText(/Include financials/i)).toBeVisible();
    await page.getByRole("button", { name: "Yes" }).click();
    await expect.poll(async () => (await getBridgeCalls(page, "respond")).length).toBe(1);
    const calls = await getBridgeCalls(page, "respond");
    expect(calls[0][0]).toMatchObject({ taskId: "mock-task-q", questionId: "q-1", optionId: "yes" });
  });

  test("Image documentType accepts reference images via openMultiFileDialog and submits referenceImages", async ({ page }) => {
    await installBridgeMock(page, { pickedFiles: ["/tmp/ref-a.png", "/tmp/ref-b.jpg"] });
    await page.goto("/");

    await pickDocumentType(page, "Image");

    await picker(page, "add reference image").click();
    await expect(page.getByText("ref-a.png")).toBeVisible();
    await expect(page.getByText("ref-b.jpg")).toBeVisible();

    await page.getByPlaceholder(/enter what you want to generate/i).fill("Match the reference style");
    await generateButton(page).click();
    await expect.poll(async () => (await getBridgeCalls(page, "generate")).length).toBe(1);
    const calls = await getBridgeCalls(page, "generate");
    expect(calls[0][0]).toMatchObject({
      documentType: "img",
      referenceImages: ["/tmp/ref-a.png", "/tmp/ref-b.jpg"],
    });
  });

  test("Running state Cancel button calls officecli.cancel with the task id", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await expect(page.getByPlaceholder(/enter what you want to generate/i)).toBeVisible();

    await emitBridgeEvent(page, {
      event_id: "ev-running",
      task_id: "mock-task-cancel-click",
      type: "task.started",
      payload: { document_type: "pptx", topic: "Cancel me", message: "Task started" },
    });
    await expect(page.getByText(/Processing your request/i).first()).toBeVisible();

    await page.locator("button").filter({ hasText: /^Cancel$/ }).first().click();
    await expect.poll(async () => (await getBridgeCalls(page, "cancel")).length).toBe(1);
    const calls = await getBridgeCalls(page, "cancel");
    expect(calls[0][0]).toBe("mock-task-cancel-click");
  });

  test("Report documentType blocks generate when sourceFile is missing", async ({ page }) => {
    await installBridgeMock(page, { pickedFile: "/tmp/source.xlsx" });
    await page.goto("/");

    await pickDocumentType(page, "Report");

    await page.getByPlaceholder(/enter what you want to generate/i).fill("Quarterly analysis");
    await generateButton(page).click();

    // Without an attached source workbook, validateForSubmit() returns ok=false
    // and generate should not be called.
    await page.waitForTimeout(300);
    expect((await getBridgeCalls(page, "generate")).length).toBe(0);

    await picker(page, "attach source file").click();
    await expect(page.getByText("source.xlsx")).toBeVisible();

    await generateButton(page).click();
    await expect.poll(async () => (await getBridgeCalls(page, "generate")).length).toBe(1);
    const calls = await getBridgeCalls(page, "generate");
    expect(calls[0][0]).toMatchObject({ documentType: "report", sourceFile: "/tmp/source.xlsx" });
  });

  test("Bottom composer on completed image submits continuation with referenceImages", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await expect(page.getByPlaceholder(/enter what you want to generate/i)).toBeVisible();

    await emitBridgeEvent(page, {
      event_id: "ev-start-ce", task_id: "mock-task-ce", type: "task.started",
      payload: { document_type: "img", topic: "Hero banner", message: "Task started" },
    });
    await emitBridgeEvent(page, {
      event_id: "ev-done-ce", task_id: "mock-task-ce", type: "task.completed",
      ts: "2026-05-26T10:30:00+08:00",
      payload: {
        message: "Image ready",
        result: { file_path: "/tmp/hero-banner.png", file_name: "hero-banner.png", document_type: "img" },
      },
    });

    await expect(page.getByText(/Generation Complete/i).first()).toBeVisible();
    await expect(page.getByText("hero-banner.png").first()).toBeVisible();

    const composer = page.getByTestId("continuation-composer");
    await expect(composer).toBeVisible();

    await composer.getByRole("textbox").fill("Make the sky brighter");
    await composer.locator("button").click();

    await expect.poll(async () => (await getBridgeCalls(page, "generate")).length).toBe(1);
    const calls = await getBridgeCalls(page, "generate");
    expect(calls[0][0]).toMatchObject({
      documentType: "img",
      referenceImages: ["/tmp/hero-banner.png"],
    });
  });
});
