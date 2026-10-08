import { expect, test } from "@playwright/test";

import { fixturePath, openFromDisk, openShell, queueFileDialog } from "./support/real-e2e";

/**
 * Why the frame's editor refuses writes — measured, not inferred.
 *
 * The live-draw path reported `drawing slide 1 of 3` and then failed with
 * `Editing is not permitted`. Two different gates produce that exact string:
 * the editor's own `AccessPolicy.canEdit()`
 * (`presentation-engine/src/core/model/ui-state.ts`) and the Office.js
 * capability grant
 * (`presentation-office-js/src/addin-runtime.ts`). The message cannot say
 * which, and reading the source did not settle it: `?mode=embed` does not set
 * `isEmbeddedPreview` (that flag needs `mode=preview`), so the editor is not
 * forced to readonly and the privilege factory grants `edit`. Two earlier
 * attributions of this failure were wrong, so this measures instead.
 *
 * The probe is `window.__officedexEditorDiagnose` in
 * `presentation-component/src/officedex-editor-diagnose.ts`. It has to live in
 * the editor's own realm: a script sent through `presentation:execute-script`
 * runs in the Office.js RPC realm and never sees the model, while the iframe
 * itself does. It only reads — no writes, no mode changes.
 *
 * Costs nothing but the editor boot: it opens the blank deck fixture rather
 * than generating one, because the permission state being measured is a
 * property of the boot, not of any particular run.
 */

interface StepOutcome {
  readonly attempted: boolean;
  readonly ok: boolean;
  readonly error: string | null;
  readonly code: string | null;
}

interface DiagnoseReport {
  readonly where: string;
  readonly read: StepOutcome & {
    readonly slideCount: number | null;
    readonly shapesOnFirstSlide: number | null;
  };
  readonly slideWrite: StepOutcome & { readonly rolledBack: boolean };
  readonly shapeWrite: StepOutcome & {
    readonly rolledBack: boolean;
    readonly shapesBefore: number | null;
    readonly shapesAfterAdd: number | null;
    readonly shapesAdded: number | null;
    readonly shapesAfter: number | null;
  };
  readonly officeJs: {
    readonly powerpointGlobal: boolean;
    readonly officeGlobal: boolean;
    readonly officeExtensionGlobal: boolean;
  };
  readonly url: {
    readonly search: string;
    readonly hasOfficedexEmbed: boolean;
    readonly hasChannel: boolean;
  };
  readonly exposedGlobals: readonly string[];
}

test.describe("frame editor write permission", () => {
  test("reports which gate refuses a draw into the embedded editor", async ({ page }, testInfo) => {
    await openShell(page);

    /*
     * The blank deck is the fixture to write against.
     *
     * This spec deliberately mutates the document: the question is "does this
     * editor refuse a write, and who refuses it", and neither the message nor
     * the source settled it — two attributions were already wrong. A read can
     * never answer it. `blank.pptx` is a one-empty-slide fixture, and the probe
     * rolls its own mutation back when it succeeds.
     *
     * Opened from Local, which is where r10 puts Open: there is no Agent/Editor
     * mode any more and no Home action for the picker (§07).
     */
    await queueFileDialog(await fixturePath("blank.pptx"));
    await openFromDisk(page);
    await expect(page.getByRole("tab", { name: /blank/i })).toBeVisible({ timeout: 30_000 });

    // `.pptx-embed-frame` being present only means the iframe mounted, and the
    // probe installs early (before the deck loads). What the questions are
    // *about* is the editor runtime, so wait for that: Office.js is installed
    // when the workbench mounts. Reading too early produced a full page of
    // nulls on a healthy boot the first time this ran.
    const frame = page.frameLocator("iframe.pptx-embed-frame");
    await expect(page.locator("iframe.pptx-embed-frame")).toBeVisible({ timeout: 60_000 });

    const editorReady = async (): Promise<boolean> =>
      await frame.locator("html").evaluate(
        () =>
          typeof (globalThis as unknown as Record<string, unknown>).PowerPoint ===
          "object",
      );

    const readyDeadline = Date.now() + 90_000;
    while (!(await editorReady())) {
      if (Date.now() > readyDeadline) {
        throw new Error(
          "The embed never installed Office.js. presentation-component's public/presentation copy is built separately from this repo's src — check that it was rebuilt after the probe was added.",
        );
      }
      await page.waitForTimeout(500);
    }

    const report: DiagnoseReport | { error: string } = await frame
      .locator("html")
      .evaluate(async () => {
        const scope = globalThis as unknown as {
          __officedexEditorDiagnose?: (options?: {
            attemptWrite?: boolean;
          }) => Promise<unknown>;
        };
        const diagnose = scope.__officedexEditorDiagnose;
        if (!diagnose) {
          return {
            error:
              "The diagnose probe is not installed. presentation-component was not rebuilt, or the embed took the compatibility protocol branch.",
          };
        }
        return (await diagnose({ attemptWrite: true })) as DiagnoseReport;
      })
      .catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
      }));

    await testInfo.attach("editor-write-permission.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    // Printed as well as attached: `attach` only reaches disk on a passing run,
    // and the whole point of this probe is to read a report from a run whose
    // outcome is not known in advance.
    console.log(`[editor-write-permission]\n${JSON.stringify(report, null, 2)}`);

    if ("error" in report) throw new Error(report.error);
    const typed: DiagnoseReport = report;

    /*
     * The report is the deliverable; these assertions only guard the probe
     * itself, because a probe that silently read nothing looks exactly like a
     * clean answer.
     *
     * The frame's boot URL is pinned because it distinguishes the two things
     * that could be on the other side: `installOfficeDexPresentationBridge`
     * installs only when there is no `channel`, while the projection app owns
     * the `?officedexEmbed=1&channel=…` boot. Seeing this URL is how we know
     * which bridge handled the probe.
     */
    expect(typed.where).toContain("editor realm");
    expect(typed.url.hasChannel).toBe(false);
    expect(typed.officeJs.powerpointGlobal).toBe(true);
    // A read is never permission-gated. If this fails, the write questions
    // cannot be put to this editor and the rest of the report means nothing.
    expect(typed.read.error).toBeNull();
    /*
     * Deliberately NOT asserted: whether either write succeeded. That is the
     * answer being measured, and asserting either outcome would make the test
     * agree with whichever one it saw — the exact failure mode this spec exists
     * to avoid.
     */
    expect(typed.slideWrite.attempted).toBe(true);
    expect(typed.shapeWrite.attempted).toBe(true);
  });

  /**
   * The bundled NexaEdge recording, drawn into the live editor.
   *
   * This is the shell's half of legacy's **Watch PPT generation**: a real
   * 141-op recording (8 slides, 123 shapes) replayed into a real draft, so the
   * path that `findings-pptx-track.md` §4 recorded as broken gets exercised
   * without a run, credits or a three-minute wait.
   *
   * It is the acceptance test for that §4 finding, so it asserts the thing §4
   * said never happened: shapes landing in the editor over time.
   *
   * The entry is the URL now. r10's Home is a composer, Quick start and Recent
   * (§09) and carries no "watch a deck being drawn" button, so `?deckDemo=1` —
   * documented in `src/shell/dev/deckDemo.ts` as the same state from the address
   * bar, and honoured outside the dev fixture in `src/shell/main.tsx` — is the
   * only way in. What is under test is the recording reaching the editor, and
   * that is the same either way.
   */
  test("draws the bundled recording into the live editor", async ({ page }) => {
    // 180s: the recording is paced deliberately (a demo, not a benchmark), and
    // this is the ceiling rather than the expectation.
    test.setTimeout(180_000);

    await openShell(page, "/?deckDemo=1");

    /*
     * One frame, and it is the live stage's — not `PresentationCanvas`'s.
     *
     * The stage and the file editor both render `PresentationEditorFrame`, so
     * asserting on the frame alone would pass for either. `shell-live-deck` is
     * what says this is a deck being *drawn*, and it is the surface that did not
     * exist before.
     */
    await expect(page.locator('[data-testid="shell-live-deck"]')).toBeVisible({ timeout: 90_000 });
    const frame = page.frameLocator('[data-testid="shell-live-deck"] iframe');

    /*
     * The deck fills the canvas, not just its top strip.
     *
     * Not a style preference — this was a real defect. The frame is nested one
     * level deeper than the file editor's, so the direct-child rule that sizes
     * `.pptx-embed-frame` never matched it: the canvas was 648px, the deck
     * collapsed to 154px (the editor's own ribbon height), and the slides were
     * below the fold with nothing to scroll. Everything else passed while that
     * was true, so it gets an assertion.
     */
    const sizes = await page.evaluate(() => {
      const heightOf = (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      };
      return {
        canvas: heightOf("[data-canvas-host]"),
        deck: heightOf('[data-testid="shell-live-deck"]'),
        frame: heightOf('[data-testid="shell-live-deck"] iframe'),
      };
    });
    expect(sizes.canvas).toBeGreaterThan(200);
    expect(
      sizes.deck,
      `the live deck is ${sizes.deck}px inside a ${sizes.canvas}px canvas — it collapsed to the editor's ribbon height`,
    ).toBeGreaterThan(sizes.canvas * 0.9);
    expect(sizes.frame).toBeGreaterThan(sizes.canvas * 0.9);

    /*
     * A reading, or `null` while the embed is still booting.
     *
     * The probe installs during the embed's own start-up, which is after the
     * iframe exists — so the first read can legitimately find nothing there. An
     * earlier version threw "probe missing" on that, which made this test fail
     * depending on how fast the machine was: the same assertion passed alone and
     * failed in a longer run. Waiting for the reader to exist is the fix, not a
     * fixed sleep.
     */
    const readShapes = async (): Promise<{
      slideCount: number | null;
      shapesOnFirstSlide: number | null;
    } | null> => {
      const report = (await frame.locator("html").evaluate(async () => {
        const scope = globalThis as unknown as {
          __officedexEditorDiagnose?: (options?: {
            attemptWrite?: boolean;
          }) => Promise<unknown>;
        };
        if (!scope.__officedexEditorDiagnose) return null;
        return await scope.__officedexEditorDiagnose({ attemptWrite: false });
      })) as
        | { read: { slideCount: number | null; shapesOnFirstSlide: number | null } }
        | null;
      return report ? report.read : null;
    };

    // Office.js arrives when the workbench mounts; before that a read is a
    // page of nulls rather than a failure.
    const readyDeadline = Date.now() + 90_000;
    let first: { slideCount: number | null; shapesOnFirstSlide: number | null } = {
      slideCount: null,
      shapesOnFirstSlide: null,
    };
    for (;;) {
      const reading = await readShapes();
      if (reading && reading.slideCount !== null) {
        first = reading;
        break;
      }
      if (Date.now() > readyDeadline) {
        throw new Error("The live editor never reported a slide count.");
      }
      await page.waitForTimeout(500);
    }

    // Sample while it draws. The recording is paced, so the count has to move.
    let peakSlides = first.slideCount ?? 0;
    let peakShapes = first.shapesOnFirstSlide ?? 0;
    let sawSecondSlide = false;
    const drawDeadline = Date.now() + 60_000;
    while (Date.now() < drawDeadline) {
      const now = (await readShapes()) ?? { slideCount: null, shapesOnFirstSlide: null };
      if ((now.slideCount ?? 0) > peakSlides) {
        peakSlides = now.slideCount ?? peakSlides;
        sawSecondSlide = peakSlides > 1;
      }
      peakShapes = Math.max(peakShapes, now.shapesOnFirstSlide ?? 0);
      // The recording's first slide carries several shapes; reaching slide two
      // with shapes on it means the sequencer is genuinely driving the editor.
      if (sawSecondSlide && peakShapes >= 3) break;
      await page.waitForTimeout(500);
    }

    console.log(
      `[deck-demo] first=${JSON.stringify(first)} peakSlides=${peakSlides} peakShapesOnSlide1=${peakShapes}`,
    );

    /*
     * The finding was "an empty editor for the whole run". These are its
     * negation, in the order that makes it unambiguous:
     *
     *   - more than one slide means the replay advanced past the blank draft,
     *   - shapes on slide 1 means the *drawing* landed, which is the part that
     *     reported `Editing is not permitted` and that a permission fix was
     *     believed to be required for.
     */
    expect(
      sawSecondSlide,
      "the recording never reached a second slide — the replay did not advance",
    ).toBe(true);
    expect(
      peakShapes,
      "no shape ever landed on slide 1 — the sequencer ran but nothing was drawn",
    ).toBeGreaterThan(0);
  });
});
