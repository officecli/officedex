/**
 * A probe for "Editing is not permitted".
 *
 * WHY THIS EXISTS
 *
 * The live-draw path (`VibeReplaySequencer` → `presentation:execute-script` →
 * Office.js) reported `drawing slide 1 of 3` and then failed with
 * `Editing is not permitted`. That string has two producers, and by message
 * alone they are indistinguishable:
 *
 *   - `AccessPolicy.canEdit()` — `presentation-engine/src/core/model/ui-state.ts`
 *       `mode === "edit" && !forceDisconnected && privilege.permissionWithReason.edit.hasPermission`
 *   - the Office.js capability grant — `presentation-office-js/src/addin-runtime.ts`
 *       `#grant.permissions.includes(permission)`
 *
 * Reading the source did not settle which one fires: the frame boots at
 * `?mode=embed`, which does NOT set `isEmbeddedPreview` (that flag needs
 * `mode=preview`), so the editor is not forced to readonly, and the privilege
 * factory grants `edit`.
 *
 * WHAT IT HAS ESTABLISHED SO FAR
 *
 * A slide-level write (`slides.add()` + `sync()`) **succeeds** in the frame's
 * editor. So "the frame has no write permission" — which was the working theory,
 * and is still written into `findings-pptx-track.md` §4 — is false.
 *
 * That result is not yet sufficient, because the sequencer does not add slides:
 * it adds *shapes* (`slide.shapes.addTextBox`, `vibeReplay.ts:562`), which is a
 * different and more permission-sensitive path. This probe therefore measures
 * both levels, and the shape level is the one that answers the question.
 *
 * WHERE IT RUNS, AND WHAT IT CANNOT SEE
 *
 * `presentation-component` (the frame's editor bundle), so it executes in the
 * editor's own realm. It still cannot read the model directly: measured on a
 * live boot, this window exposes `PowerPoint` / `Office` / `OfficeExtension`,
 * `__PRESENTATION_DESKTOP_HOST__`, `__presentationEmbeddedDocument` and the
 * React context singletons — and *no* handle on the editor core. `__core` is
 * registered through `exposeOnWindow`, which publishes only on a trigger
 * message and only from localhost, and this build does not get it either way.
 *
 * So the measurement is behavioural, and the error's `code` is what separates
 * the gates.
 *
 * WHEN IT IS MEANINGFUL
 *
 * Only once the deck has loaded: `main.ts` calls this after
 * `installOfficeDexPresentationBridge()`, which is before the workbench mounts
 * and installs Office.js. A report taken too early is a page of nulls on a
 * perfectly healthy boot; the caller waits for `PowerPoint` to exist first.
 */

const DIAGNOSE_KEY = "__officedexEditorDiagnose";

/** Office.js-shaped handles, deliberately loose. */
interface TextBoxOptions {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ShapeLike {
  id?: string;
  delete?(): void;
}

interface TextBoxLike extends ShapeLike {
  textFrame?: { textRange?: { text?: string } };
}

interface ShapeCollectionLike {
  load(properties: string): void;
  addTextBox?(text: string, options: TextBoxOptions): TextBoxLike;
  items?: readonly ShapeLike[];
}

interface SlideLike {
  delete?(): void;
  shapes: ShapeCollectionLike;
}

interface ScriptContext {
  presentation: {
    slides: {
      load(properties: string): void;
      add?(): unknown;
      getItemAt?(index: number): SlideLike;
      items?: readonly SlideLike[];
    };
  };
  sync(): Promise<void>;
}

interface PowerPointGlobal {
  run?(fn: (context: ScriptContext) => Promise<unknown>): Promise<unknown>;
}

interface StepOutcome {
  readonly attempted: boolean;
  readonly ok: boolean;
  readonly error: string | null;
  readonly code: string | null;
}

export interface EditorDiagnoseReport {
  readonly where: string;
  /**
   * A read that needs no write permission. If this fails, the write questions
   * cannot be put to this editor at all and nothing else here means anything.
   */
  readonly read: StepOutcome & {
    readonly slideCount: number | null;
    readonly shapesOnFirstSlide: number | null;
  };
  /** `slides.add()` — establishes the editor accepts structural writes at all. */
  readonly slideWrite: StepOutcome & { readonly rolledBack: boolean };
  /**
   * `shapes.addTextBox()` — **the one that matters**: the exact call
   * `VibeReplaySequencer` makes for every text element it draws.
   *
   * Read the three shape counts together, not `ok` alone. `ok` only says the
   * call did not throw. An earlier run reported `ok: true` with
   * `shapesBefore === shapesAfter === 0`, which would mean the editor accepted
   * the command and the shape never landed — a silently dropped write, and a
   * completely different bug from a refused one. `shapesAdded` is what
   * separates "wrote and rolled back" from "never wrote".
   */
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
  /** Names this realm exposes, so nobody has to guess at them again. */
  readonly exposedGlobals: readonly string[];
}

const DONE: StepOutcome = { attempted: false, ok: false, error: null, code: null };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : null;
}

function candidateGlobals(target: Record<string, unknown>): readonly string[] {
  return Object.getOwnPropertyNames(target)
    .filter((key) => /presentation|office|workbench|^__core$/i.test(key))
    .sort();
}

/**
 * Collects one report.
 *
 * Read-only unless `attemptWrite` is set. Any mutation it makes is undone in
 * the same script, and the report says whether the undo happened — a probe that
 * silently leaves a text box behind in a deck someone was only inspecting would
 * be a worse bug than the one it is chasing.
 */
export async function diagnoseEditor(
  options: { attemptWrite?: boolean } = {},
): Promise<EditorDiagnoseReport> {
  const target = globalThis as unknown as Record<string, unknown>;
  const search = typeof window === "undefined" ? "" : window.location.search;
  const params = new URLSearchParams(search);
  const powerpoint = target.PowerPoint as PowerPointGlobal | undefined;

  const url = {
    search,
    hasOfficedexEmbed: params.get("officedexEmbed") === "1",
    hasChannel: Boolean(params.get("channel")),
  };
  const officeJs = {
    powerpointGlobal: Boolean(target.PowerPoint),
    officeGlobal: Boolean(target.Office),
    officeExtensionGlobal: Boolean(target.OfficeExtension),
  };

  type Mutable<T> = { -readonly [K in keyof T]: T[K] };
  const read: Mutable<EditorDiagnoseReport["read"]> = {
    ...DONE,
    slideCount: null,
    shapesOnFirstSlide: null,
  };
  const slideWrite: Mutable<EditorDiagnoseReport["slideWrite"]> = {
    ...DONE,
    rolledBack: false,
  };
  const shapeWrite: Mutable<EditorDiagnoseReport["shapeWrite"]> = {
    ...DONE,
    rolledBack: false,
    shapesBefore: null,
    shapesAfterAdd: null,
    shapesAdded: null,
    shapesAfter: null,
  };

  const build = (): EditorDiagnoseReport => ({
    where: "presentation-component (editor realm)",
    read,
    slideWrite,
    shapeWrite,
    officeJs,
    url,
    exposedGlobals: candidateGlobals(target),
  });

  if (!powerpoint || typeof powerpoint.run !== "function") {
    read.error = "PowerPoint.run is unavailable.";
    return build();
  }

  // --- read -------------------------------------------------------------
  try {
    await powerpoint.run(async (context) => {
      const slides = context.presentation.slides;
      slides.load("items/id");
      await context.sync();
      read.slideCount = slides.items?.length ?? null;
      const first = slides.items?.[0];
      if (first) {
        first.shapes.load("items/id");
        await context.sync();
        read.shapesOnFirstSlide = first.shapes.items?.length ?? null;
      }
    });
    read.ok = true;
  } catch (error) {
    read.error = messageOf(error);
    read.code = codeOf(error);
  }

  if (options.attemptWrite !== true) return build();

  // --- slide-level write (rolled back) ----------------------------------
  slideWrite.attempted = true;
  try {
    await powerpoint.run(async (context) => {
      context.presentation.slides.add?.();
      await context.sync();
    });
    slideWrite.ok = true;
  } catch (error) {
    slideWrite.error = messageOf(error);
    slideWrite.code = codeOf(error);
  }
  if (slideWrite.ok) {
    try {
      await powerpoint.run(async (context) => {
        const slides = context.presentation.slides;
        slides.load("items/id");
        await context.sync();
        const last = (slides.items?.length ?? 0) - 1;
        const added = last >= 0 ? slides.getItemAt?.(last) : undefined;
        (added as { delete?(): void } | undefined)?.delete?.();
        await context.sync();
      });
      slideWrite.rolledBack = true;
    } catch {
      slideWrite.rolledBack = false;
    }
  }

  // --- shape-level write: the sequencer's own call (rolled back) --------
  /*
   * Measured in three separate runs, because one run cannot tell "added then
   * deleted" from "never added" — both end with a shape count of zero, and the
   * first version of this probe reported those two cases identically.
   */
  shapeWrite.attempted = true;
  let addedShape: ShapeLike | undefined;
  try {
    await powerpoint.run(async (context) => {
      const slides = context.presentation.slides;
      slides.load("items/id");
      await context.sync();
      const first = slides.items?.[0];
      if (!first) throw new Error("The deck has no slide to draw on.");
      first.shapes.load("items/id");
      await context.sync();
      shapeWrite.shapesBefore = first.shapes.items?.length ?? null;
      addedShape = first.shapes.addTextBox?.("officedex-probe", {
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      });
      await context.sync();
      shapeWrite.ok = true;
    });
  } catch (error) {
    shapeWrite.error = messageOf(error);
    shapeWrite.code = codeOf(error);
  }

  // Did it actually land? A fresh run re-reads the collection, so the count
  // here cannot be an artefact of the handle we just held.
  if (shapeWrite.ok) {
    try {
      await powerpoint.run(async (context) => {
        const slides = context.presentation.slides;
        slides.load("items/id");
        await context.sync();
        const first = slides.items?.[0];
        if (!first) return;
        first.shapes.load("items/id");
        await context.sync();
        shapeWrite.shapesAfterAdd = first.shapes.items?.length ?? null;
      });
      if (
        shapeWrite.shapesBefore !== null &&
        shapeWrite.shapesAfterAdd !== null
      ) {
        shapeWrite.shapesAdded =
          shapeWrite.shapesAfterAdd - shapeWrite.shapesBefore;
      }
    } catch (error) {
      shapeWrite.error = messageOf(error);
      shapeWrite.code = codeOf(error);
    }

    try {
      await powerpoint.run(async (context) => {
        const slides = context.presentation.slides;
        slides.load("items/id");
        await context.sync();
        const first = slides.items?.[0];
        if (!first) return;
        first.shapes.load("items/id");
        await context.sync();
        const target =
          addedShape ??
          (first.shapes.items?.[
            (first.shapes.items?.length ?? 1) - 1
          ] as ShapeLike | undefined);
        target?.delete?.();
        await context.sync();
        shapeWrite.rolledBack = true;
      });
    } catch {
      shapeWrite.rolledBack = false;
    }

    try {
      await powerpoint.run(async (context) => {
        const slides = context.presentation.slides;
        slides.load("items/id");
        await context.sync();
        const first = slides.items?.[0];
        if (!first) return;
        first.shapes.load("items/id");
        await context.sync();
        shapeWrite.shapesAfter = first.shapes.items?.length ?? null;
      });
    } catch {
      // Left null on purpose rather than guessed.
    }
  }

  return build();
}

/**
 * Publishes the probe on the editor window.
 *
 * The frame's `presentation:execute-script` realm can only see Office.js, so
 * the caller has to be a test talking to the iframe directly:
 *
 *   frameLocator.evaluate(() => window.__officedexEditorDiagnose())
 */
export function installEditorDiagnose(): void {
  Object.defineProperty(globalThis, DIAGNOSE_KEY, {
    configurable: true,
    value: (options?: { attemptWrite?: boolean }) => diagnoseEditor(options ?? {}),
  });
}
