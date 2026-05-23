import { test, expect } from "@playwright/test";
import { emitBridgeEvent, getBridgeCalls, installBridgeMock } from "./fixtures/bridge-mock";

test.describe("Artifacts screen", () => {
  test("empty state renders Generate Now CTA when no artifacts exist", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Artifacts" }).first().click();

    await expect(page.getByText(/no files generated yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /generate now/i })).toBeVisible();
  });

  test("artifact from task.completed shows up in Artifacts list", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await expect(page.getByPlaceholder(/enter what you want to generate/i)).toBeVisible();

    await emitBridgeEvent(page, {
      event_id: "ev-complete-1",
      task_id: "task-art-1",
      type: "task.completed",
      ts: "2026-05-22T12:00:00+08:00",
      payload: {
        message: "Done",
        result: {
          file_path: "/tmp/board-deck.pptx",
          file_name: "board-deck.pptx",
          document_type: "pptx",
        },
      },
    });

    await page.getByRole("button", { name: "Artifacts" }).first().click();
    await expect(page.getByText("board-deck.pptx").first()).toBeVisible();
  });

  test("Show in folder from a completed task triggers showItemInFolder bridge call", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await expect(page.getByPlaceholder(/enter what you want to generate/i)).toBeVisible();

    await emitBridgeEvent(page, {
      event_id: "ev-complete-2",
      task_id: "task-art-2",
      type: "task.completed",
      ts: "2026-05-22T12:30:00+08:00",
      payload: {
        message: "Done",
        result: {
          file_path: "/tmp/notes.docx",
          file_name: "notes.docx",
          document_type: "docx",
        },
      },
    });

    // The completed dialogue exposes a Show in folder action for office docs.
    await expect(page.getByRole("button", { name: /show in folder/i })).toBeVisible();
    await page.getByRole("button", { name: /show in folder/i }).click();
    await expect.poll(async () => (await getBridgeCalls(page, "showItemInFolder")).length).toBeGreaterThan(0);
    const calls = await getBridgeCalls(page, "showItemInFolder");
    expect(calls[0][0]).toBe("/tmp/notes.docx");
  });
});
