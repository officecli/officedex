import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import {
  attachHostReport,
  fixturePath,
  hostControl,
  queueFileDialog,
  recordScenario,
} from "./support/real-e2e";

/**
 * The shell's core document matrix, measured end to end against the real runtime.
 *
 * The product's six core promises are one sentence each: make me a Word file, a
 * workbook, a deck and an image; then let me change the ones I already have. In
 * the new shell only two of those had automated coverage — a workbook and a deck
 * *generated* (`shell-generation-real`, `shell-pptx-generation-real`) and a deck
 * *edited* (`deck-edit-routing-real`). `docs/test-cases.md` §19 says the rest
 * **must be done by hand**, which is what this file exists to retire:
 *
 *   TC-DOC-01  generate .docx            → "generates a Word document"
 *   TC-XLS-01  generate .xlsx            → "generates a workbook"
 *   TC-PPT-01  generate .pptx            → "generates a presentation"
 *   TC-IMG-01  generate an image         → "generates an image"
 *   docx in-place edit (canvas + docs)   → "edits the Word document in place"
 *   TC-XLS-02  edit an open workbook     → "edits the workbook in the grid"
 *   TC-EDT-01  edit an open deck         → "edits the presentation in place"
 *
 * ── Why the entry point is the Home quick prompts ───────────────────────────
 *
 * Home's composer is `showModeControls={false}`: the "What this message makes"
 * menu and the image toggle are deliberately not drawn there, so a test that
 * opened that menu would be asserting a control the shell does not have. What
 * Home does offer is the four starting points — "Write a document", "Analyze a
 * spreadsheet", "Create a presentation", "Create an image" — and picking one
 * fills the composer *and* states the output type (`Composer.onRegisterFill`),
 * which is why the button labelled "Write a document" stops producing decks.
 * That is the user's own route to each type, so it is the one driven here.
 *
 * ── Why every artifact is verified on disk ──────────────────────────────────
 *
 * "The tab appeared" is satisfied by a preview of scratch, and "Generation
 * Complete" was already observed over a file that would not open. So each
 * generation is checked twice: the shell mounted the real editor for it, and
 * the bytes named by the host's artifact ledger really contain the content the
 * run was asked for. The edit cases go further and read the changed text back
 * out of the file, which is the only assertion that distinguishes "the editor
 * showed my typing" from "the document was written".
 *
 * ── What is stubbed, and why that is still a real test ──────────────────────
 *
 * ── Two cases are expected to be red, and why ───────────────────────────────
 *
 * Measured on 2026-09-22 (see `docs/e2e-develop-1.0-core-matrix-2026-09-22.md`),
 * both for reasons outside this file:
 *
 *   - `generates a presentation…` — the authoring worker embedded in the local
 *     `officecli` build asks `presentation/dist-ssr` for
 *     `capabilities/smartart/diagram-controller.ts` and the built manifest
 *     carries `browser/adapters/diagram-adapter.ts`. The repository's own
 *     `shell-pptx-generation-real.spec.ts` fails the same way, so this is a
 *     toolchain drift between two checkouts, not a prompt or a selector.
 *   - `edits the Word document…` — the edit is applied in the editor and then
 *     the DOCX export refuses: `word2mow convert failed … unknown tbl attr key:
 *     nodeId`. The writer component is newer than the converter the repository
 *     pins, so any document containing a table cannot be saved.
 *
 * Do not green these by weakening the assertions: they are the evidence. Each
 * one fails with the runtime's own sentence in the message so the reason travels
 * with the report.
 *
 * Both in-place edits stub the *planner* and nothing else. A planner needs a
 * provider and a key; whether a model can rewrite a sentence is not what these
 * cases are about — whether the shell, given a plan, changes the document that
 * is open and writes it back is. Everything after the stub is real: the Office.js
 * runs in the embedded Word/presentation editors, the files are exported by the
 * real runtimes, and the result is read off disk. The workbook case needs no
 * stub at all, because a grid edit is a grid edit.
 */

type Artifact = { taskId: string; path: string; size: number; documentType: string };

const RUN_DEADLINE_MS = 25 * 60_000;
/** Editor mounts are slower than the run that produced the file. */
const EDITOR_DEADLINE_MS = 3 * 60_000;

/** What the generation cases produced, for the edit cases that follow them. */
const generated = new Map<string, Artifact>();

function questionCard(page: Page): Locator {
  return page.locator(".shell-task-question");
}

/**
 * Fails the moment the shell says the run failed, with the runtime's own words.
 *
 * Polling past a visible failure until a twenty-five minute deadline and then
 * reporting "timed out" is true and useless — see the same note in
 * `support/real-e2e.ts`, written after a run spent eighteen minutes waiting on
 * a task that had died in the first five seconds.
 */
async function assertRunDidNotFail(page: Page): Promise<void> {
  const banner = page
    .getByText(/The run stopped|Generation failed|could not be completed|Image generation failed|Something went wrong/i)
    .first();
  if (!(await banner.isVisible().catch(() => false))) return;
  const detail = await page
    .locator(".shell-task-reply p")
    .last()
    .innerText()
    .catch(() => "");
  throw new Error(
    `The shell reported the run as failed: ${detail.trim().replace(/\s+/g, " ") || "no reason shown"}`,
  );
}

/**
 * Answers whatever the run asks, so it can reach its end without a person.
 *
 * The recommended option when the run marked one, otherwise the first; a
 * freeform-only question is answered through the composer, which routes a typed
 * message to the pending question rather than starting a second run.
 */
async function answerQuestions(page: Page): Promise<void> {
  const card = questionCard(page);
  if (!(await card.isVisible().catch(() => false))) return;
  const options = card.locator(".shell-task-question-options button");
  if ((await options.count()) > 0) {
    const recommended = options.locator("css=.is-primary");
    const pick = (await recommended.count()) > 0 ? recommended.first() : options.first();
    await pick.click();
    return;
  }
  const composer = page.getByRole("textbox", { name: /Message Agent|New task instructions/ });
  await composer.fill("Use the recommended concise default.");
  await composer.press("Enter");
}

/**
 * The host's completion ledger, polled until it names this artifact type.
 *
 * A 404 means nothing has completed yet, which is the normal state for most of
 * a run — hence the `catch` rather than a failing request.
 */
async function waitForArtifact(page: Page, documentType: string): Promise<Artifact> {
  const deadline = Date.now() + RUN_DEADLINE_MS;
  while (Date.now() < deadline) {
    await answerQuestions(page);
    await assertRunDidNotFail(page);
    const artifact = await hostControl<Artifact>("/control/artifacts/latest").catch(() => null);
    if (artifact && artifact.documentType === documentType && Number(artifact.size) > 0) {
      return artifact;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`the run never produced a real ${documentType} artifact`);
}

/** Boots the shell on the real bridge and refuses the in-memory fake. */
async function openShell(page: Page): Promise<void> {
  page.on("pageerror", (error) => {
    // The bridge's SSE stream aborts as the page navigates; everything else is
    // a genuine failure and should surface here rather than as a later timeout.
    if (/Failed to fetch/i.test(error.message)) return;
    throw error;
  });
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("officedex.shell.v1");
    } catch {
      /* a locked-down profile keeps its state */
    }
  });
  await page.goto("/");
  await expect(page.locator('#shell[data-loaded="true"]')).toBeVisible({ timeout: 60_000 });
  // The seed rows belong to `src/shell/port/fake`. Seeing them means the page
  // fell back to the in-memory port and the whole file would prove nothing.
  await expect(page.getByText("MO product launch", { exact: true })).toHaveCount(0);
}

/** Asks for a new document of the named type, the way Home offers it. */
async function generateFromHome(page: Page, quickPrompt: string, prompt: string): Promise<void> {
  await expect(page.getByRole("button", { name: quickPrompt, exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: quickPrompt, exact: true }).first().click();
  const composer = page.getByRole("textbox", { name: "New task instructions" });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  // Asking for something leaves Home — the canvas the run fills is behind it.
  await expect(page.locator("#shell")).toHaveAttribute("data-home", "false", { timeout: 30_000 });
}

/**
 * Opens a private copy of a file in the shell's canvas.
 *
 * A copy per case, not the artifact itself: importing gives the app its own
 * library entry under a name derived from the file, so two cases sharing one
 * name share one document — and the second then edits the first one's work.
 */
async function openCopyInShell(
  page: Page,
  source: string,
  label: string,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "officedex-matrix-"));
  const copy = path.join(dir, `${label}${path.extname(source) || ".bin"}`);
  await copyFile(source, copy);

  // Navigation belongs here, not to the callers: a case that reused an artifact
  // generated earlier in the same run has no page of its own yet.
  await openShell(page);
  /*
   * The file is opened from Agent Home, and the mode is left alone.
   *
   * Docking is Agent-mode only (`effectivePlacement`/`canDock` in
   * `shellReducer`): in Editor mode the agent is a collapsed face, so the
   * composer these cases send through is not mounted at all. Agent Home carries
   * the same "Open from this computer" action, so nothing is lost by staying.
   */
  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  await queueFileDialog(copy);
  await page.getByRole("button", { name: /Open from this computer/i }).click();
  await expect(page.getByRole("tab", { name: new RegExp(label) })).toBeVisible({ timeout: 30_000 });
  return copy;
}

/** Every text node of the named parts of an OOXML package, tags stripped. */
async function packageText(filePath: string, entryPattern: RegExp): Promise<string> {
  const bytes = new Uint8Array(await readFile(filePath));
  const entries = unzipSync(bytes);
  let text = "";
  for (const [name, data] of Object.entries(entries)) {
    if (!entryPattern.test(name)) continue;
    text += strFromU8(data).replace(/<[^>]*>/g, "");
  }
  return text;
}

/**
 * The artifact a case edits, generating it first when this run has not already.
 *
 * The editing cases are written to stand alone: run the whole file and they
 * reuse what the generation cases produced, run only them and they make their
 * own. A case that quietly depended on an earlier one having succeeded would
 * report its own result as unknown, and the file exists to say what works.
 */
async function ensureGenerated(
  page: Page,
  documentType: "docx" | "xlsx",
  quickPrompt: string,
  prompt: string,
): Promise<Artifact> {
  const known = generated.get(documentType);
  if (known) return known;
  await openShell(page);
  await generateFromHome(page, quickPrompt, prompt);
  const artifact = await waitForArtifact(page, documentType);
  generated.set(documentType, artifact);
  return artifact;
}

test.describe("new shell · core generation matrix", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("generates a Word document and opens it in the real Writer", async ({ page }) => {
    const startedAt = Date.now();
    await openShell(page);
    await generateFromHome(
      page,
      "Write a document",
      "Write a short OfficeDex core-matrix memo about release readiness, with a heading and two paragraphs.",
    );

    const artifact = await waitForArtifact(page, "docx");
    generated.set("docx", artifact);
    expect(artifact.path.toLowerCase()).toContain(".docx");

    // The file is a real package with real prose in it — not an empty shell that
    // the editor would happily render as a blank page.
    const body = await packageText(artifact.path, /^word\/document\.xml$/);
    expect(body.replace(/\s+/g, " ").trim().length).toBeGreaterThan(80);

    // And the shell mounted the Word editor for it rather than the skeleton it
    // draws when no adapter is registered.
    await expect(page.locator("iframe.writer-embed-frame")).toBeVisible({
      timeout: EDITOR_DEADLINE_MS,
    });
    await expect(page.getByText(/The Word editor could not start/i)).toHaveCount(0);
    await expect(page.getByRole("tab").first()).toBeVisible();

    await recordScenario({
      uiScenario: "shell-generate-docx",
      documentType: "docx",
      taskId: artifact.taskId,
      artifactPath: artifact.path,
      fileSize: artifact.size,
      durationMs: Date.now() - startedAt,
    });
  });

  test("generates a workbook and opens it in the real grid", async ({ page }) => {
    const startedAt = Date.now();
    await openShell(page);
    await generateFromHome(
      page,
      "Analyze a spreadsheet",
      "Build a compact OfficeDex core-matrix budget with a header row, three months and a totals row.",
    );

    const artifact = await waitForArtifact(page, "xlsx");
    generated.set("xlsx", artifact);
    expect(artifact.path.toLowerCase()).toContain(".xlsx");
    expect((await packageText(artifact.path, /^xl\/.*\.xml$/)).trim().length).toBeGreaterThan(40);

    await expect(page.locator(".spreadsheet-canvas--error")).toHaveCount(0);
    await expect(page.locator(".spreadsheet-canvas__editor canvas")).toBeVisible({
      timeout: EDITOR_DEADLINE_MS,
    });

    await recordScenario({
      uiScenario: "shell-generate-xlsx",
      documentType: "xlsx",
      taskId: artifact.taskId,
      artifactPath: artifact.path,
      fileSize: artifact.size,
      durationMs: Date.now() - startedAt,
    });
  });

  test("generates a presentation and opens it in the real deck editor", async ({ page }) => {
    const startedAt = Date.now();
    await openShell(page);
    await generateFromHome(
      page,
      "Create a presentation",
      "Prepare a three-slide OfficeDex core-matrix brief covering readiness, risks and next steps.",
    );

    const artifact = await waitForArtifact(page, "pptx");
    generated.set("pptx", artifact);
    expect(artifact.path.toLowerCase()).toContain(".pptx");
    expect((await packageText(artifact.path, /^ppt\/slides\/slide\d+\.xml$/)).trim().length).toBeGreaterThan(40);

    /*
     * A mounted iframe is not an opened deck: a run that fails to render still
     * mounts the frame, and an earlier revision of the sibling spec went green
     * over "Unable to open this presentation". Both halves are asserted.
     */
    await expect(page.locator("iframe.pptx-embed-frame")).toBeVisible({
      timeout: EDITOR_DEADLINE_MS,
    });
    await expect(page.getByText(/Unable to open this presentation/i)).toHaveCount(0);
    await expect(page.getByText(/did not produce native shapes/i)).toHaveCount(0);
    await expect(page.locator(".shell-live-deck-lock")).toHaveCount(0);

    await recordScenario({
      uiScenario: "shell-generate-pptx",
      documentType: "pptx",
      taskId: artifact.taskId,
      artifactPath: artifact.path,
      fileSize: artifact.size,
      durationMs: Date.now() - startedAt,
    });
  });

  test("generates an image from the shell composer", async ({ page }) => {
    const startedAt = Date.now();
    await openShell(page);

    // Picking the image starting point also flips the composer into image mode;
    // that is the only way the image controls appear on Home, where the mode
    // toggle is otherwise not drawn.
    await generateFromHome(page, "Create an image", "A calm product-launch still life, soft daylight.");

    const artifact = await waitForArtifact(page, "img");
    expect(artifact.size).toBeGreaterThan(1_000);

    // A real picture, not a placeholder or an HTML error page: the bytes have to
    // start the way an image starts.
    const head = new Uint8Array(await readFile(artifact.path)).subarray(0, 12);
    const signature = Array.from(head)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const isPng = signature.startsWith("89504e47");
    const isJpeg = signature.startsWith("ffd8ff");
    const isGif = signature.startsWith("47494638");
    const isWebp = signature.startsWith("52494646") && signature.slice(16, 24) === "57454250";
    expect(
      isPng || isJpeg || isGif || isWebp,
      `the image artifact is not a recognised picture format (first bytes: ${signature})`,
    ).toBe(true);

    await recordScenario({
      uiScenario: "shell-generate-img",
      documentType: "img",
      artifactPath: artifact.path,
      fileSize: artifact.size,
      durationMs: Date.now() - startedAt,
    });
  });
});

/**
 * The planner for a Word edit, and the only stubbed thing in this file.
 *
 * Shaped exactly as `office.docx.edit.v1` is told to answer: a summary and a list
 * of exact replacements, each query occurring once in the text it was given. The
 * query is chosen by the test from the document's own text, so the replacement
 * cannot fail to match — what is under test is the shell carrying a plan into the
 * open document and writing it back, not a model's ability to paraphrase.
 */
async function stubDocxPlanner(page: Page, query: string, replacement: string): Promise<void> {
  await page.route("**/rpc/StartAgentRun", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, result: { id: "docx-edit-stub", workflow: "office.docx.edit.v1" } }),
    });
  });
  await page.route("**/rpc/GetAgentRun", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          id: "docx-edit-stub",
          workflow: "office.docx.edit.v1",
          status: "completed",
          events: [],
          result: { summary: "Replaced one sentence.", edits: [{ query, replacement }] },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
    });
  });
}

/** The Office.js a real planner returns for "rename the first slide's title". */
const PPTX_TITLE_SOURCE = [
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

async function stubPptxPlanner(page: Page): Promise<void> {
  await page.route("**/rpc/PlanPptxJS", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          summary: "Renamed the first slide's title to Hello World.",
          confidence: "high",
          source: PPTX_TITLE_SOURCE,
        },
      }),
    });
  });
}

/** Every RPC method the page asked for, in order. */
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

/** The deck's editor is up: the embed reported Office.js in its own realm. */
async function deckEditorReady(page: Page): Promise<void> {
  const frame = page.frameLocator('[data-testid="shell-live-deck"] iframe, iframe.pptx-embed-frame');
  const deadline = Date.now() + 90_000;
  for (;;) {
    const ready = await frame
      .locator("html")
      .evaluate(
        () => typeof (globalThis as unknown as Record<string, unknown>).PowerPoint === "object",
      )
      .catch(() => false);
    if (ready) return;
    if (Date.now() > deadline) throw new Error("The deck editor never installed Office.js.");
    await page.waitForTimeout(500);
  }
}

test.describe("new shell · core editing matrix", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("edits the Word document in place and writes it back", async ({ page }) => {
    test.setTimeout(240_000);
    const startedAt = Date.now();
    const source = await ensureGenerated(
      page,
      "docx",
      "Write a document",
      "Write a short OfficeDex core-matrix memo about release readiness, with a heading and two paragraphs.",
    );
    const copy = await openCopyInShell(page, source.path, "matrix-runner-docx");

    /*
     * Wait for the editor to own the document, not merely to be mounted.
     *
     * `inPlaceEditorFor` answers "docx" only when `canvas.canEditDocument()` is
     * true, which happens when the embed reports its first edit capture — send
     * before that and the instruction takes the generation path instead, which
     * still succeeds and still produces a file, so the mistake is invisible
     * unless it is asserted. Writer paints the page into an SVG and keeps a
     * 1x1px input textarea; the painted surface appearing is what says the
     * document is on screen.
     */
    const painted = page
      .frameLocator("iframe.writer-embed-frame")
      .locator(".writer-document-preview, [data-role='writer-document-render-surface']")
      .first();
    await expect(painted).toBeVisible({ timeout: EDITOR_DEADLINE_MS });

    // The query comes from the document itself, so the replacement has something
    // to match. Runs are the unit Writer replaces, and a whole run is unique here.
    const runs = (await packageText(copy, /^word\/document\.xml$/)).length > 0
      ? await readRunTexts(copy)
      : [];
    const query = runs
      .filter((run) => run.trim().length >= 8)
      .sort((a, b) => b.length - a.length)
      .find((run, _index, all) => all.filter((other) => other === run).length === 1);
    expect(query, "the generated document has no unique run to replace").toBeTruthy();

    const replacement = "OFFICEDEX E2E EDIT";
    /*
     * The recorder goes on first so the planner stubs, registered after it, win
     * for their own two methods: an instruction about an open document must not
     * reach `Generate`, and that is only checkable if the call would be seen.
     */
    const rpc = recordRpc(page);
    await stubDocxPlanner(page, query as string, replacement);

    const composer = page.getByRole("textbox", { name: /Message Agent/ });
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill("Rewrite that sentence for the core matrix.");
    await composer.press("Enter");
    await expect(composer, "the composer still holds the instruction").toHaveValue("", {
      timeout: 15_000,
    });

    /*
     * Two stages, asserted separately.
     *
     * "The document changed" and "the document was written" fail for different
     * reasons and one of them is reachable while the other is not — the runtime's
     * own notice says which ("Changes applied" versus "Changed, but not saved").
     * Collapsing them into one disk assertion reports the second as if the first
     * had never happened.
     */
    const panel = page.locator(".shell-task");
    await expect(
      panel,
      "the runtime never reported an outcome for the edit",
    ).toContainText(/Changes applied|Changed, but not saved/, { timeout: 180_000 });

    const deadline = Date.now() + 120_000;
    let body = "";
    let said = "";
    while (Date.now() < deadline) {
      body = await packageText(copy, /^word\/document\.xml$/);
      if (body.includes(replacement)) break;
      said = await panel.innerText().catch(() => "");
      await page.waitForTimeout(1_000);
    }
    expect(
      body,
      `the Word document on disk still does not contain the edit. The runtime said: ${
        said.trim().replace(/\s+/g, " ") || "nothing"
      }`,
    ).toContain(replacement);
    expect(body).not.toContain(query as string);
    expect(
      rpc,
      "the instruction went to the generation runtime, so an open document is still being re-authored",
    ).not.toContain("Generate");
    expect(
      rpc.filter((method) => method === "SaveDocx").length,
      "the edit was never exported back to the Word file",
    ).toBeGreaterThan(0);

    await recordScenario({
      uiScenario: "shell-edit-docx",
      documentType: "docx",
      taskId: "in-place-edit",
      artifactPath: copy,
      fileSize: (await readFile(copy)).byteLength,
      durationMs: Date.now() - startedAt,
    });
  });

  test("edits the workbook in the grid and saves it", async ({ page }) => {
    test.setTimeout(240_000);
    const startedAt = Date.now();
    const source = await ensureGenerated(
      page,
      "xlsx",
      "Analyze a spreadsheet",
      "Build a compact OfficeDex core-matrix budget with a header row, three months and a totals row.",
    );
    const copy = await openCopyInShell(page, source.path, "matrix-runner-xlsx");

    const grid = page.locator(".spreadsheet-canvas__editor");
    await expect(grid.locator("canvas")).toBeVisible({ timeout: EDITOR_DEADLINE_MS });
    await expect(page.locator(".spreadsheet-canvas__loading")).toHaveCount(0);

    // A cell near the top-left of the used range, addressed by position because
    // the grid is a canvas: there is no DOM element per cell to name.
    const box = await grid.boundingBox();
    expect(box, "the grid has no box to click in").toBeTruthy();
    const marker = "E2EMATRIX42";
    await page.mouse.click((box as { x: number }).x + 150, (box as { y: number }).y + 90);
    await page.keyboard.type(marker);
    await page.keyboard.press("Enter");

    /*
     * The save control in the tab bar, not `.shell-statusbar`: the workbook's own
     * editor publishes a status bar of its own and the shell withdraws its copy
     * rather than drawing a second one (`canvas/editorChrome.ts`).
     *
     * The response is what is waited on rather than the "Unsaved" label, because
     * the workbook autosaves 1500 ms after the last change — a label assertion
     * would be a race with the very feature it is checking.
     */
    const written = page.waitForResponse(
      (response) => response.url().includes("/rpc/SaveXlsxEditor"),
      { timeout: 90_000 },
    );
    await page.locator("button.shell-save-state").click();
    await written;

    const deadline = Date.now() + 60_000;
    let text = "";
    while (Date.now() < deadline) {
      text = await packageText(copy, /^xl\/.*\.xml$/);
      if (text.includes(marker)) break;
      await page.waitForTimeout(1_000);
    }
    expect(text, "the workbook on disk still does not contain the typed cell").toContain(marker);

    await recordScenario({
      uiScenario: "shell-edit-xlsx",
      documentType: "xlsx",
      taskId: "grid-edit",
      artifactPath: copy,
      fileSize: (await readFile(copy)).byteLength,
      durationMs: Date.now() - startedAt,
    });
  });

  test("edits the presentation in place and writes it back", async ({ page }) => {
    test.setTimeout(240_000);
    const startedAt = Date.now();
    /*
     * The deck comes from the fixture, not from a run.
     *
     * Deck *generation* is a different case in this file and it is currently
     * blocked by a toolchain drift outside this repo (the authoring worker asks
     * `dist-ssr` for `capabilities/smartart/diagram-controller.ts` and the built
     * manifest carries `browser/adapters/diagram-adapter.ts` instead). Editing a
     * deck does not go through that path at all, so this case is about whether an
     * instruction about an open deck is carried out and written back — and
     * `blank.pptx` is the one-slide deck the sibling routing spec already uses.
     */
    const copy = await openCopyInShell(page, await fixturePath("blank.pptx"), "matrix-runner-pptx");

    await expect(page.locator("iframe.pptx-embed-frame")).toBeVisible({ timeout: 60_000 });
    // An open deck, not a run's stage: the stage would be a generation surface.
    await expect(page.locator('[data-testid="shell-live-deck"]')).toHaveCount(0);
    await deckEditorReady(page);

    /*
     * Order matters. Playwright runs the most recently registered handler first,
     * so the recorder goes on before the stub: every other RPC is observed and
     * passed through, and `PlanPptxJS` is answered by the stub without the real
     * planner ever being called. Registering them the other way round makes the
     * recorder `continue()` past the stub and spends a real planning call.
     */
    const rpc = recordRpc(page);
    await stubPptxPlanner(page);

    const composer = page.getByRole("textbox", { name: /Message Agent/ });
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill("Change slide 1's title to Hello World");
    await composer.press("Enter");
    await expect(composer, "the composer still holds the instruction").toHaveValue("", {
      timeout: 15_000,
    });

    /*
     * The deck's scope audit can stop the run for a yes.
     *
     * A plan that reads past what the editor was given — the stub names slides,
     * the editor was handed one — is put to the user as a card rather than
     * applied, and nothing happens until it is answered. Answering it is part of
     * the flow, not a workaround: the same gate is asserted in
     * `deck-edit-routing-real.spec.ts`.
     */
    const card = page.locator(".shell-task-question");
    const gate = Date.now() + 30_000;
    while (Date.now() < gate && !(await card.isVisible().catch(() => false))) {
      await page.waitForTimeout(500);
    }
    if (await card.isVisible().catch(() => false)) {
      await card.getByRole("button", { name: /apply/i }).click();
    }

    // The exported package is the assertion. Reading the editor back would prove
    // the change happened on screen; only the file proves it was kept.
    const deadline = Date.now() + 120_000;
    let slides = "";
    while (Date.now() < deadline) {
      slides = await packageText(copy, /^ppt\/slides\/slide\d+\.xml$/);
      if (slides.includes("Hello World")) break;
      await page.waitForTimeout(1_000);
    }
    expect(
      slides,
      "the instruction about an open deck never reached the file — it was re-authored instead of edited",
    ).toContain("Hello World");
    expect(
      rpc,
      "the instruction went to the generation runtime, so the deck was regenerated",
    ).not.toContain("Generate");
    expect(
      rpc.filter((method) => method === "ExportPptxEditor").length,
      "the edit was never exported back to the deck",
    ).toBeGreaterThan(0);

    await recordScenario({
      uiScenario: "shell-edit-pptx",
      documentType: "pptx",
      taskId: "in-place-edit",
      artifactPath: copy,
      fileSize: (await readFile(copy)).byteLength,
      durationMs: Date.now() - startedAt,
    });
  });
});

/** The text of each `<w:t>` run in a .docx, in document order. */
async function readRunTexts(filePath: string): Promise<string[]> {
  const bytes = new Uint8Array(await readFile(filePath));
  const xml = strFromU8(unzipSync(bytes)["word/document.xml"] ?? new Uint8Array());
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) =>
    match[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&"),
  );
}
