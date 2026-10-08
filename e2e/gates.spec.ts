/**
 * Wave 4 gate 1, for OD-UI-1.2 r10: no shell overlay is ever clipped, and none
 * is ever painted under something else.
 *
 * R1 (14 of the 2026-09-19 audit's 124 findings) was one bug: the old `Menu`
 * placed its panel with `left: 0` / `right: 0` / `top: calc(100% + 6px)` inside
 * whatever overflow container its trigger happened to live in, and never
 * measured anything. The sidebar settings menu was down to 15.8% visible; the
 * FileTabs menu ran 146px past the window. W1-A fixed the engine and this file
 * is the thing that has to stay green afterwards.
 *
 * r10 replaced the engine again. The workspace's menus now come from
 * `openMenu` in `src/shell/kit/layers.tsx` and are drawn in `#dx-layers`; the
 * dialog is a real `<dialog>` (`#dx-modal`), the confirmation is `#dx-notice`,
 * the name tip is drawn by `kit/tooltips.ts` and New is its own anchored
 * popover. The class of defect is unchanged, so the gate is not: every one of
 * those is opened, measured against the viewport, walked for a clipping
 * ancestor, and hit-tested at its own centre.
 *
 * **What makes this different from `e2e/fix-w1a.spec.ts`.** That file proves the
 * fix on the specific findings, in the combination each was measured in. This
 * runs the full cross product: ten overlay call sites × ten shells, every
 * cell either opened and measured or **declared absent**.
 *
 * Declared, not skipped. A trigger that does not exist in a shell is a row in
 * REACHABILITY with a reason, and the gate asserts the absence just as hard as
 * it asserts the geometry — because "the menu was not clipped" and "the menu was
 * never opened" produce the same green otherwise, and that is precisely the
 * failure mode of `ui-audit-s4.spec.ts` (30 cases, all `test.skip`, exit 0).
 *
 * **What is new since the old version of this file.** Its second known blind
 * spot was that `expectNoClip` compares boxes and "cannot see a panel that is
 * fully inside the viewport and fully covered by something painted above it —
 * S2-010 (`.shell-presence` z 200 over `.shell-menu` z 60) passes this gate". It
 * was left out because the z-index ladder was being rebuilt. The ladder landed
 * (`src/shell/tokens.css`), `src/shell/test/layers.test.ts` gates it statically,
 * and that gate's own first blind spot says the run-time complement "belongs at
 * run time: `elementFromPoint` on the centre of a panel, in `e2e/`". So every
 * cell here now ends in `expectOnTop` as well, and there is a case at the bottom
 * for the one live instance of S2-010's shape in r10.
 *
 * **Known blind spots.**
 *
 * 1. One viewport (1280×720, the Playwright default) and one theme. A menu that
 *    fits at 1280 can still be clipped at 900; the honest statement of what this
 *    proves is "not clipped at 1280×720".
 * 2. It measures the panel, not the items inside it. A panel that is on screen
 *    but scrolls its own content is green here.
 * 3. `expectOnTop` hit-tests one point — the centre. A panel covered at an edge
 *    and clear in the middle passes.
 *
 * Run it:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/gates.spec.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { COMBINATIONS, expectNoClip, expectOnTop, open, settle, type Combination } from "./r10-a-helpers";

/* ------------------------------------------------------ the legacy component */

/**
 * `src/shell/chrome/Menu.tsx` — the 2026-09 component — and where it is still
 * called from.
 *
 * It is not the workspace's menu any more: `Sidebar`, `DocumentTabs`,
 * `useFileActions` and `Composer` all go through `kit/layers`' `openMenu`, and
 * the surfaces r10 deliberately left alone (§18: "AI image 保留既有图像创作界面")
 * are what is left holding the old one. The static check below still counts
 * every `<Menu>` in `src/shell`, because the reason it exists has not changed:
 * everything else in this file iterates a table, so a call site nobody
 * registered is covered by nothing and every test still passes.
 *
 * `reachableIn` is the honest half. `ImageWorkspace`'s picture toolbar needs a
 * picture, which the fake port only produces by running an image generation, so
 * no shell combination opens it. Written down rather than left out, so "not
 * covered" cannot be mistaken for "not there".
 */
const LEGACY_CALL_SITES: ReadonlyArray<{ source: string; reachableIn: readonly Combination[]; why: string }> = [
  {
    source: join("image", "ImageWorkspace.tsx"),
    reachableIn: [],
    why: "the picture toolbar's Save-to-project menu; needs an image file, which the fixture's seeds do not carry",
  },
];

/* -------------------------------------------------------------- the overlays */

/** Where the overlay comes from, and what gets it open. */
interface OverlaySite {
  /** Short name, used in failure messages and in REACHABILITY. */
  id: string;
  /** The code this stands for, so a reader can find it. */
  source: string;
  /** What is measured once it is open. */
  overlay: string;
  /**
   * Opens it. Returns nothing; the sweep waits for `overlay` afterwards.
   *
   * A function rather than a selector plus a gesture: half of these need a step
   * before the click (a row hovered so its "more" button takes pointer events, a
   * row scrolled into view) and two need a step after it (a menu row chosen, to
   * get at the notice behind it). Spelling that out per site keeps the sweep
   * from growing a flag per special case.
   */
  reach: (page: Page, combination: Combination) => Promise<void>;
  /** Left open on purpose for the notice, which dismisses itself. */
  closeWith?: "escape";
}

/** The row's "more" button only takes pointer events while the row is hovered. */
async function hoverThenClick(row: Locator, trigger: string): Promise<void> {
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator(trigger).click();
}

/** The file menu, from whichever list the shell on screen has. */
function fileMenuTrigger(page: Page, combination: Combination): Locator {
  // The editor shells reach it from the document's own actions; the list shells
  // from a row in Home Recent, Local or Assets.
  return ["C5", "C6", "C7", "C9"].includes(combination)
    ? page.locator(".dx-source-header-actions [data-act=file-menu]")
    : page.locator("#dx-content .dx-file-row [data-act=file-menu]").first();
}

/** The shells whose sidebar is showing, i.e. `navCollapsed: false`. */
const SIDEBAR_SHELLS: readonly Combination[] = ["C1", "C3", "C4", "C5", "C8", "C10"];

const OVERLAYS: readonly OverlaySite[] = [
  {
    id: "project-menu",
    source: "chrome/Sidebar.tsx → useWorkspaceMenus.projectMenu",
    overlay: ".dx-menu",
    reach: (page) => hoverThenClick(page.locator("#dx-sidebar .dx-project-row").first(), "[data-act=project-menu]"),
    closeWith: "escape",
  },
  {
    id: "chat-menu",
    source: "chrome/Sidebar.tsx → useWorkspaceMenus.chatMenu",
    overlay: ".dx-menu",
    reach: (page) => hoverThenClick(page.locator("#dx-sidebar .dx-chat-tree").first(), "[data-act=chat-menu]"),
    closeWith: "escape",
  },
  {
    id: "file-menu",
    source: "chrome/useFileActions.tsx → fileMenu",
    overlay: ".dx-menu",
    reach: async (page, combination) => {
      const trigger = fileMenuTrigger(page, combination);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
    },
    closeWith: "escape",
  },
  {
    id: "model-picker",
    source: "composer/Composer.tsx → chooseModel (conversation column)",
    overlay: ".dx-menu",
    reach: (page) => page.locator("#dx-conversation [data-act=model-picker]").click(),
    closeWith: "escape",
  },
  {
    id: "dex-model-picker",
    source: "composer/Composer.tsx → chooseModel (Dex panel over a document)",
    overlay: ".dx-menu",
    reach: async (page) => {
      // The one r10 menu whose trigger lives inside an overflow container:
      // `.dx-editor-wrapper` is `overflow: hidden` and the Dex panel is drawn
      // inside it. This is the case the old `.shell-cx` clipping was.
      await page.locator("button.dx-dex[data-act=dex]").click();
      await page.locator(".dx-dex-panel [data-act=model-picker]").click();
    },
    closeWith: "escape",
  },
  {
    id: "new-popover",
    source: "chrome/NewPopover.tsx",
    overlay: "#dx-new-popover",
    reach: (page) => page.locator("#dx-sidebar [data-act=new-file]").click(),
    closeWith: "escape",
  },
  {
    id: "new-project-dialog",
    source: "kit/dialogs.tsx → openNameDialog",
    overlay: "dialog#dx-modal",
    reach: (page) => page.locator("#dx-sidebar .dx-group-heading [data-act=new-project]").click(),
    closeWith: "escape",
  },
  {
    id: "task-context-dialog",
    source: "composer/TaskContextDialog.tsx → openTaskContext",
    overlay: "dialog#dx-modal",
    reach: (page) => page.locator("#dx-conversation [data-act=context]").click(),
    closeWith: "escape",
  },
  {
    id: "home-tip",
    source: "kit/tooltips.ts",
    overlay: ".dx-control-tooltip",
    // Keyboard, not pointer: a focused control shows its tip at once, where the
    // pointer waits out `DELAY_MS`. Nothing about the placement differs.
    reach: (page) => page.locator("#dx-global-controls [data-act=home]").focus(),
    closeWith: "escape",
  },
  {
    id: "notice",
    source: "kit/layers.tsx → notice(), raised by port/reportPortFailure.notBuiltYet",
    overlay: "#dx-notice.dx-visible",
    reach: async (page, combination) => {
      /*
       * Two ways in, because no single control raises one in all ten shells.
       * Where the sidebar is showing, a conversation's Move is the shell's
       * nearest `notBuiltYet`; where it is hidden, the file menu's Preview is.
       * Both go through `notBuiltYet`, which is the only thing being relied on.
       */
      if (SIDEBAR_SHELLS.includes(combination)) {
        await hoverThenClick(page.locator("#dx-sidebar .dx-chat-tree").first(), "[data-act=chat-menu]");
        await page.getByRole("menuitem", { name: "Move" }).click();
        return;
      }
      const trigger = fileMenuTrigger(page, combination);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await page.getByRole("menuitem", { name: "Preview" }).click();
    },
    // Left open: it dismisses itself after 3.2s and there is nothing to press.
    // It is measured last in every shell so nothing follows it.
  },
];

/**
 * Which overlays a user can actually reach in each shell, measured.
 *
 * Absence is a property of the product, so it is written down rather than
 * discovered at run time: a trigger that quietly stops rendering would otherwise
 * turn into "nothing to measure here" and the gate would go greener, not redder.
 * Every "not here" below has a reason, and the gate fails if one of them starts
 * appearing.
 *
 *   project-menu        the sidebar is 0px wide and has no rail when it is
 *   chat-menu           hidden (§03), so its rows are clipped away and the
 *   new-popover         content region wins their coordinates. C2, C6, C7 and C9
 *   new-project-dialog  are the four hidden-sidebar shells.
 *   model-picker        no conversation beside the content region: C1, C2, C3,
 *   task-context        C9 and C10 have `chat: null`.
 *   dex-model-picker    the Dex bubble is drawn over an open document only
 *                       (`App.tsx`: page editor, a file, not an image).
 *   file-menu           Settings has no file list and no document; on C8 the
 *                       content region is closed, so its rows render at 0×0.
 */
const REACHABILITY: Record<Combination, readonly string[]> = {
  C1: ["project-menu", "chat-menu", "file-menu", "new-popover", "new-project-dialog", "home-tip", "notice"],
  C2: ["file-menu", "home-tip", "notice"],
  C3: ["project-menu", "chat-menu", "file-menu", "new-popover", "new-project-dialog", "home-tip", "notice"],
  C4: [
    "project-menu",
    "chat-menu",
    "file-menu",
    "model-picker",
    "new-popover",
    "new-project-dialog",
    "task-context-dialog",
    "home-tip",
    "notice",
  ],
  C5: [
    "project-menu",
    "chat-menu",
    "file-menu",
    "model-picker",
    "dex-model-picker",
    "new-popover",
    "new-project-dialog",
    "task-context-dialog",
    "home-tip",
    "notice",
  ],
  C6: ["file-menu", "model-picker", "dex-model-picker", "task-context-dialog", "home-tip", "notice"],
  C7: ["file-menu", "model-picker", "dex-model-picker", "task-context-dialog", "home-tip", "notice"],
  C8: [
    "project-menu",
    "chat-menu",
    "model-picker",
    "new-popover",
    "new-project-dialog",
    "task-context-dialog",
    "home-tip",
    "notice",
  ],
  C9: ["file-menu", "dex-model-picker", "home-tip", "notice"],
  C10: ["project-menu", "chat-menu", "new-popover", "new-project-dialog", "home-tip", "notice"],
};

/**
 * Whether `site`'s own opening gesture can be performed at all.
 *
 * Deliberately the same act as the measurement rather than a cheaper proxy: a
 * hidden sidebar's rows are still in the DOM with real boxes — they are clipped
 * to a 0px column, and the content region owns their coordinates — so "the
 * element exists" and even "the element has a box" both say yes where a user
 * cannot get at it. Trying the gesture is what tells them apart.
 */
async function canReach(page: Page, site: OverlaySite, combination: Combination): Promise<boolean> {
  /*
   * A short leash, restored afterwards.
   *
   * These calls are *expected* to fail, and the config's 60s `actionTimeout` is
   * for a click that ought to land. Left at 60s, twenty absences across the ten
   * shells are twenty minutes of waiting for the answer "no", and the suite dies
   * on its own test timeout rather than reporting anything — which is what
   * happened the first time this ran.
   */
  page.setDefaultTimeout(2_500);
  try {
    await site.reach(page, combination);
    await page.locator(site.overlay).first().waitFor({ state: "visible" });
    return true;
  } catch {
    return false;
  } finally {
    page.setDefaultTimeout(60_000);
  }
}

test.describe("gate: r10 shell overlays are never clipped and never buried", () => {
  for (const combination of COMBINATIONS) {
    test(`${combination}: every reachable overlay opens fully on screen, on top`, async ({ page }) => {
      const reachable = new Set(REACHABILITY[combination]);

      for (const site of OVERLAYS) {
        // A fresh shell per site. The overlays replace each other by design
        // (`kit/layers` keeps one menu, one dialog, one notice), and several of
        // these gestures navigate — choosing a project's New chat, opening a
        // file from a row — so measuring them in sequence in one page would
        // make each cell depend on the last one's side effects.
        await open(page, combination);

        if (!reachable.has(site.id)) {
          // The declared absences are assertions too. An overlay opening where
          // the table says there is none means the table is stale, and a stale
          // table is how a call site stops being covered without anyone noticing.
          expect(
            await canReach(page, site, combination),
            `${combination}/${site.id} (${site.source}) opens now; REACHABILITY says it cannot`,
          ).toBe(false);
          continue;
        }

        await site.reach(page, combination);
        await page.locator(site.overlay).first().waitFor({ state: "visible" });

        const measured = await expectNoClip(page, site.overlay);
        const stacking = await expectOnTop(page, site.overlay);
        // eslint-disable-next-line no-console
        console.log(
          `W4-GATE1 ${combination}/${site.id} ${JSON.stringify(measured.rect)} hit=${stacking.hit} z=${stacking.overlayKey}`,
        );

        if (site.closeWith === "escape") {
          await page.keyboard.press("Escape");
          await expect(page.locator(site.overlay)).toHaveCount(0);
        }
      }
    });
  }

  /**
   * A drift guard on LEGACY_CALL_SITES, in the spirit of `deadControls.test.ts`.
   *
   * The sweep above covers `kit/layers`. `chrome/Menu.tsx` is a second engine
   * with its own placement code, still compiled into the app, and nothing else
   * in this file touches it. Counting its call sites in the source is what
   * notices a second one appearing — or `openMenu` growing a caller that should
   * have replaced this one.
   */
  test("every <Menu> in src/shell is registered in LEGACY_CALL_SITES", async () => {
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.endsWith(".tsx") || entry.includes(".test.")) continue;
        files.push(path);
      }
    };
    walk("src/shell");

    const found: string[] = [];
    for (const path of files) {
      // `chrome/Menu.tsx` is the component itself, not a call site.
      if (path.endsWith(join("chrome", "Menu.tsx"))) continue;
      const source = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
        .replace(/\/\/[^\n]*/g, "");
      for (const _ of source.matchAll(/<Menu[\s>]/g)) found.push(path);
    }

    const registered = LEGACY_CALL_SITES.map((site) => site.source);
    expect(
      found.map((path) => path.replace(`src${join("/", "shell")}/`, "")).sort(),
      `src/shell has ${found.length} <Menu> call sites, LEGACY_CALL_SITES has ${registered.length}:\n${found.join("\n")}`,
    ).toEqual([...registered].sort());
  });

  /**
   * The one live instance of S2-010's shape in r10.
   *
   * S2-010 was a fixed panel at z 200 sitting over the menus at z 60, and the
   * old version of this file named it as the thing `expectNoClip` could not see.
   * r10's ladder puts the workspace's menus at `--dx-z-menu` 60 and keeps the
   * surfaces the design left alone above the whole design ladder
   * (`--shell-z-menu` 300, see `src/shell/test/layers.test.ts`). `UsageNotice` is
   * one of those: a 320px card fixed to the bottom-right corner at 300, shown
   * once per profile — so it is up on first launch, over the corner the
   * conversation's composer occupies when the conversation is docked right.
   *
   * Asserted from the design rather than from today's numbers: §05's order is
   * content → sticky tools → Dex and floating panels → menus and tips → modal,
   * and a first-run status card is none of the things that come after "menus".
   * So a menu the user opens is above it, whatever rung either one is on.
   *
   * Every other case in this file dismisses the notice in `open()`. This one does
   * not, because a setup step that hides the live instance of the defect the file
   * is about is the weakening the rest of the gate exists to prevent.
   */
  test("the first-run usage notice does not bury the conversation's own menu", async ({ page }) => {
    await page.goto("/?shellFixture=1&shell=C6");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
    // It renders once the settings have loaded, which is after `data-loaded`.
    await expect(page.locator(".shell-usage-notice")).toBeVisible();
    await settle(page);

    // Opened from the keyboard, not with a click. The notice sits over the
    // corner the docked-right composer's tool row occupies, so a mouse click
    // aimed at the model button lands on the notice and no menu opens at all —
    // which would report this as a timeout rather than as the stacking answer.
    const trigger = page.locator("#dx-conversation [data-act=model-picker]");
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.locator(".dx-menu").waitFor({ state: "visible" });
    await expect(page.locator(".dx-menu")).toBeVisible();

    await expectOnTop(page, ".dx-menu");
  });
});
