import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { fixturePath, queueFileDialog } from "./support/real-e2e";

/**
 * An instruction about an open deck edits the deck, and does not regenerate it.
 *
 * This is the routing decision, measured end to end rather than modelled. It
 * went wrong twice:
 *
 *   1. `useAgentTask.send` had an in-place branch for documents only
 *      (`target.type === "doc"`), so every instruction about a deck went to the
 *      generation runtime — "change slide 3's title" re-authored the whole deck
 *      from the prompt.
 *   2. With the deck's runner registered, `CanvasContent` withdrew it again for
 *      any file that was not a document (`open.type !== "doc"`), so
 *      `canEditDocument()` was false for an open deck and the instruction still
 *      took the generation path. The unit test for that modelled the effect
 *      order with a stub; this runs the real tree, which is where the two
 *      effects actually race.
 *
 * ## What it asserts
 *
 * That the open deck changed, that no generation ran, and that the change was
 * written back. The **planner is the one thing stubbed** — it needs a provider
 * and a key, and whether a model can rename a slide is not what is under test.
 * Everything after it is real: the returned Office.js runs in the actual
 * embedded editor, the deck is inspected again to find what moved, and the file
 * is saved. The stub's own source was written exactly as the real planner is
 * told to write it, and getting it wrong once is what proved the difference
 * between a broken stub and a broken product path.
 */

/** RPC methods the page asked for, in order. */
function recordRpc(page: Page): string[] {
  const methods: string[] = [];
  void page.route("**/rpc/*", async (route) => {
    const url = new URL(route.request().url());
    const method = decodeURIComponent(url.pathname.split("/rpc/")[1] ?? "");
    if (method) methods.push(method);
    await route.continue();
  });
  return methods;
}

/** The Office.js a real planner would return for "change the title". */
const TITLE_SOURCE = [
  "return await PowerPoint.run(async (context) => {",
  "  const slides = context.presentation.slides.load('items/id');",
  "  await context.sync();",
  "  const slide = slides.items[0];",
  "  const shapes = slide.shapes.load('items/name,type');",
  "  await context.sync();",
  "  const TEXT_TYPES = ['TextBox', 'Placeholder', 'GeometricShape'];",
  "  let shape = shapes.items.find((s) => TEXT_TYPES.indexOf(s.type) >= 0);",
  "  if (!shape) {",
  "    shape = slide.shapes.addTextBox('Hello World', { left: 40, top: 40, width: 400, height: 60 });",
  "    await context.sync();",
  "  } else {",
  "    shape.textFrame.textRange.text = 'Hello World';",
  "    await context.sync();",
  "  }",
  "  return { shapes: shapes.items.length };",
  "});",
].join("\n");

/** Serves one planner answer for every `PlanPptxJS` call. */
async function stubPlanner(page: Page, result: Record<string, unknown>): Promise<void> {
  await page.route("**/rpc/PlanPptxJS", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, result }),
    });
  });
}

/**
 * Opens a private copy of the blank deck and waits until its editor is up.
 *
 * A copy per test, not the fixture itself. Importing gives the app its own
 * document under a name derived from the file, so two tests sharing one source
 * name share one library entry — and the second test then asserts against the
 * deck the first one already edited. That is what made "nothing has changed
 * yet" fail while the code under test was correct.
 */
async function openDeck(page: Page, label: string): Promise<void> {
  const source = await fixturePath("blank.pptx");
  const dir = await mkdtemp(path.join(tmpdir(), "officedex-deck-"));
  const copy = path.join(dir, `${label}.pptx`);
  await copyFile(source, copy);

  await page.addInitScript(() => {
    try {
      localStorage.removeItem("officedex.shell.v1");
    } catch {
      /* a locked-down profile keeps its state */
    }
  });
  await page.goto("/");
  await expect(page.locator('#shell[data-loaded="true"]')).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Switch mode/ }).click();
  await page.getByRole("menuitemradio", { name: /^Editor\b/ }).click();
  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  await queueFileDialog(copy);
  await page.getByRole("button", { name: /Open from this computer/i }).click();
  await expect(page.getByRole("tab", { name: new RegExp(label) })).toBeVisible({ timeout: 30_000 });
  await deckEditorReady(page);
}

/** Reads every text a slide currently carries. */
async function deckTexts(page: Page): Promise<string[]> {
  const frame = page.frameLocator("iframe.pptx-embed-frame");
  return (await frame.locator("html").evaluate(async () => {
    const scope = globalThis as unknown as {
      PowerPoint?: { run(fn: (context: never) => Promise<unknown>): Promise<unknown> };
    };
    if (!scope.PowerPoint) return [];
    return (await scope.PowerPoint.run(async (context: never) => {
      const typed = context as unknown as {
        presentation: {
          slides: {
            load(properties: string): void;
            items: readonly {
              shapes: {
                load(properties: string): void;
                items: readonly {
                  textFrame?: { textRange?: { load(p: string): void; text?: string } };
                }[];
              };
            }[];
          };
        };
        sync(): Promise<void>;
      };
      const slides = typed.presentation.slides;
      slides.load("items/id");
      await typed.sync();
      const slide = slides.items[0];
      slide.shapes.load("items/name,type");
      await typed.sync();
      const textShapes = slide.shapes.items.filter((shape) => shape.textFrame?.textRange);
      for (const shape of textShapes) shape.textFrame!.textRange!.load("text");
      if (textShapes.length) await typed.sync();
      return textShapes.map((shape) => shape.textFrame?.textRange?.text ?? "");
    })) as string[];
  })) as string[];
}

/** The deck's editor is up: the embed reported Office.js in its own realm. */
async function deckEditorReady(page: Page): Promise<void> {
  const frame = page.frameLocator('[data-testid="shell-live-deck"] iframe, iframe.pptx-embed-frame');
  const deadline = Date.now() + 90_000;
  for (;;) {
    const ready = await frame
      .locator("html")
      .evaluate(
        () =>
          typeof (globalThis as unknown as Record<string, unknown>).PowerPoint ===
          "object",
      )
      .catch(() => false);
    if (ready) return;
    if (Date.now() > deadline) throw new Error("The deck editor never installed Office.js.");
    await page.waitForTimeout(500);
  }
}

test.describe("an instruction about an open deck", () => {
  test("edits the deck in place instead of regenerating it", async ({ page }) => {
    // The planner needs a model and a key. Whether it answers is not what this
    // test is about; the request it makes is.
    test.setTimeout(180_000);

    const rpc = recordRpc(page);

    await openDeck(page);

    // The deck is on screen as a file — the editor, not a generation stage.
    await expect(page.locator("iframe.pptx-embed-frame")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="shell-live-deck"]')).toHaveCount(0);

    /*
     * The planner is the one thing stubbed.
     *
     * It needs a provider and a key, and the point of this test is not whether a
     * model can rename a slide — it is whether the shell, given a plan, carries
     * it out inside the open deck. So this answers with a plan that names the
     * shape a person would have named, and everything after it is real: the
     * script runs in the actual embedded editor, the deck is inspected again to
     * find what moved, the editor is told which slide to show, and the file is
     * saved.
     */
    await stubPlanner(page, {
      summary: "Renamed the first slide's title to Hello World.",
      confidence: "high",
      source: TITLE_SOURCE,
    });

    rpc.length = 0;
    const composer = page.getByRole("textbox", { name: /Message Agent/ });
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill("Change slide 1's title to Hello World");
    /*
     * Enter, not the send button.
     *
     * The button is disabled until the composer decides there is something to
     * send, and a click on a disabled button is a silent no-op — the first
     * version of this test "passed" the generation check because nothing had
     * been sent at all. Enter is what a person uses and what the sibling specs
     * use, and it fails loudly if the composer refuses.
     */
    await composer.press("Enter");
    // Enter is what a person uses; if the composer did not take it, the RPC
    // checks below would pass vacuously against a message that never went out.
    await expect(composer, "the composer still holds the instruction — it was not sent").toHaveValue("", {
      timeout: 15_000,
    });

    /*
     * The planner is the deck's own, and generation is not asked at all.
     *
     * Polled rather than read once: the instruction goes out over RPC and the
     * first thing on the wire may be a token or a document read.
     */
    const deadline = Date.now() + 60_000;
    while (!rpc.includes("Generate") && Date.now() < deadline) {
      await page.waitForTimeout(250);
    }

    /*
     * Generation was never asked.
     *
     * Not "was `PlanPptxJS` called" — the planner is stubbed, and a route that
     * fulfils a request is not obliged to let the recorder see it run first,
     * which is how an earlier version of this test failed while the edit
     * worked. `Generate` is the runtime the instruction must not reach, and
     * nothing intercepts it.
     */
    expect(
      rpc,
      "the instruction went to the generation runtime, so an open deck is still being re-authored",
    ).not.toContain("Generate");

    /*
     * The change is in the deck, read back out of the editor.
     *
     * This is the assertion the report was actually about: the whole point of
     * the path is that the open deck changes, rather than a new one arriving.
     */
    const editDeadline = Date.now() + 60_000;
    let texts: string[] = [];
    while (Date.now() < editDeadline) {
      texts = await deckTexts(page);
      if (texts.some((text) => text.includes("Hello World"))) break;
      await page.waitForTimeout(500);
    }
    console.log(`[deck-edit] deck texts: ${JSON.stringify(texts)}`);
    expect(
      texts.join(" | "),
      "the deck was not changed in place",
    ).toContain("Hello World");

    /*
     * The canvas never became a generation stage.
     *
     * `shell-live-deck` is the surface a deck being authored appears on; an
     * in-place edit must not put one up. This is the "框架" the report named.
     */
    await expect(page.locator('[data-testid="shell-live-deck"]')).toHaveCount(0);
    await expect(page.locator("iframe.pptx-embed-frame")).toBeVisible();

    // And the file was written, not just the editor's copy.
    const saves = rpc.filter((method) => method === "ExportPptxEditor");
    expect(saves.length, "the edit was never saved back to the deck").toBeGreaterThan(0);
  });

  /*
   * A plan the planner wants confirmed becomes a button, not a sentence.
   *
   * The deck planner sets `requires_confirmation` when an instruction reads as
   * more than it looks — "change page 2 to Japanese" is one slide and a dozen
   * text runs — and the shell rendered that as an agent message with nothing to
   * press. Reported as "没有后续了": the user said what they wanted and the app
   * answered with something they could not act on.
   */
  test("asks before applying a plan the planner flagged, and applies on a yes", async ({ page }) => {
    test.setTimeout(180_000);
    await openDeck(page, "confirm");
    await stubPlanner(page, {
      summary: "Slide 2 has a dozen text runs to replace.",
      confidence: "low",
      requires_confirmation: true,
      confirmation: { message: "This changes a dozen text runs. Continue?" },
      source: TITLE_SOURCE,
    });

    const composer = page.getByRole("textbox", { name: /Message Agent/ });
    await composer.fill("Change slide 1's title to Hello World");
    await composer.press("Enter");

    // The question is a card with a way through it.
    const card = page.locator(".shell-task-question");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText("dozen text runs");
    const apply = card.getByRole("button", { name: /apply/i });
    await expect(apply).toBeVisible();
    await expect(card.getByRole("button", { name: /cancel/i })).toBeVisible();

    // Nothing has changed yet — asking means asking.
    await expect(page.locator("iframe.pptx-embed-frame")).toBeVisible();
    expect((await deckTexts(page)).join(" | ")).not.toContain("Hello World");

    await apply.click();

    const deadline = Date.now() + 60_000;
    let texts: string[] = [];
    while (Date.now() < deadline) {
      texts = await deckTexts(page);
      if (texts.some((text) => text.includes("Hello World"))) break;
      await page.waitForTimeout(500);
    }
    expect(texts.join(" | "), "the confirmation did not lead to the change").toContain(
      "Hello World",
    );
    await expect(page.locator('[data-testid="shell-live-deck"]')).toHaveCount(0);
  });
});
