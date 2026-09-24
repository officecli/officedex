/**
 * Wave 4 gate 1: no shell overlay is ever clipped, in any of the ten shells.
 *
 * R1 (14 of the audit's 124 findings) was one bug: `Menu` placed its panel with
 * `left: 0` / `right: 0` / `top: calc(100% + 6px)` inside whatever overflow
 * container its trigger happened to live in, and never measured anything. Every
 * one of the eight call sites was cut off somewhere — the sidebar settings menu
 * was down to 15.8% visible, the FileTabs menu ran 146px past the window. W1-A
 * fixed the engine. This file is the thing that has to stay green afterwards.
 *
 * **What makes this different from `e2e/fix-w1a.spec.ts`.** That file proves the
 * fix on the combinations the audit measured: ModeMenu on four of ten, the
 * settings menu on four of ten, the file-row menu on exactly one. The audit was
 * explicit that the rest was inference, not measurement ("同取值同结果归类 ——
 * 这是推断不是实测", S2 §4). This runs the full cross product: nine call sites
 * × ten shells, every cell either opened and measured or **declared absent**.
 *
 * Declared, not skipped. A trigger that does not exist in a shell is a row in
 * REACHABILITY with a reason, and the gate asserts the absence just as hard as
 * it asserts the geometry — because "the menu was not clipped" and "the menu
 * was never opened" produce the same green otherwise, and that is precisely the
 * failure mode of `ui-audit-s4.spec.ts` (30 cases, all `test.skip`, exit 0).
 *
 * **Known blind spots.**
 *
 * 1. One viewport (1280×720, the Playwright default) and one theme. A menu that
 *    fits at 1280 can still be clipped at 900; S6 owns viewport sweeps. The
 *    honest statement of what this gate proves is "not clipped at 1280×720".
 * 2. `expectNoClip` compares boxes. It cannot see a panel that is fully inside
 *    the viewport and fully covered by something painted above it — S2-010
 *    (`.shell-presence` z 200 over `.shell-menu` z 60) passes this gate. Overlap
 *    is a stacking question and wants a different instrument (`elementFromPoint`
 *    on the panel's own centre); it is not here because W3-I is still rebuilding
 *    the z-index ladder and a gate written against today's numbers expires the
 *    day it lands.
 * 3. It measures the panel, not the items inside it. A panel that is on screen
 *    but scrolls its own content is green here.
 * 4. Only `Menu`. The legacy overlays (`Modal`, `dialog`, `Popover`, toast) are
 *    W1-C's surface and are guarded structurally by
 *    `src/shell/test/portalHost.test.ts`, not geometrically.
 *
 * Run it:
 *   npx vite --port 3153 --strictPort
 *   PLAYWRIGHT_BASE_URL=http://localhost:3153 npx playwright test e2e/gates.spec.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { COMBINATIONS, expectNoClip, open, type Combination } from "./ui-audit-helpers";

const MENU = ".shell-menu";

/** How a user gets each panel open. */
type Gesture = "click" | "contextmenu" | "arrow-down";

interface CallSite {
  /** Short name, used in failure messages and in REACHABILITY. */
  id: string;
  /** `<Menu>` call site this stands for, so a reader can find the code. */
  source: string;
  trigger: string;
  gesture: Gesture;
}

/**
 * The nine `<Menu>` call sites in `src/shell`, and how to open each.
 *
 * `arrow-down` rather than a click for the four composer chips: the chips
 * overlap each other in a 340px panel (S2-005's cross-reference to S3, and
 * SUMMARY MERGE-001), so a mouse click on one is intercepted by its neighbour.
 * That is a real defect owned by another track — opening from the keyboard
 * measures the menu without pretending the overlap is fixed, and without
 * turning somebody else's bug into a skip here.
 */
const CALL_SITES: readonly CallSite[] = [
  { id: "mode", source: "chrome/ModeMenu.tsx", trigger: ".shell-brand", gesture: "click" },
  {
    id: "tabs-more",
    source: "chrome/FileTabs.tsx",
    trigger: "button[aria-label='More actions']",
    gesture: "click",
  },
  {
    id: "folder-row",
    source: "nav/FileTree.tsx (folder)",
    trigger: ".shell-tree-folder-row",
    gesture: "contextmenu",
  },
  {
    id: "file-row",
    source: "nav/FileTree.tsx (file)",
    trigger: ".shell-tree-file-row",
    gesture: "contextmenu",
  },
  { id: "scope", source: "composer/Composer.tsx (scope)", trigger: ".shell-cx-scope", gesture: "arrow-down" },
  {
    id: "output",
    source: "composer/Composer.tsx (output type)",
    trigger: ".shell-cx-output",
    gesture: "arrow-down",
  },
  {
    id: "permission",
    source: "composer/Composer.tsx (permission)",
    trigger: ".shell-cx-permission",
    gesture: "arrow-down",
  },
  { id: "model", source: "composer/ModelMenu.tsx", trigger: ".shell-cx-model", gesture: "arrow-down" },
];

/**
 * Which call sites a user can actually reach in each shell, measured.
 *
 * Absence is a property of the product, so it is written down rather than
 * discovered at run time: a trigger that quietly stops rendering would
 * otherwise turn into "nothing to measure here" and the gate would go greener,
 * not redder. Every "not here" below has a reason, and the gate fails if one of
 * them starts appearing.
 *
 *   tabs-more   Home has no tab strip (`#shell[data-home="true"] .shell-tabs-actions`).
 *   folder-row  the folder tree is Agent mode's; Editor's library lives on Home.
 *   file-row    file rows render at 0×0 on the collapsed rail, so only the
 *               expanded-sidebar shells have one to right-click.
 *   scope /     Editor's Home is the file library, with no composer on it. The
 *   output /    four chips exist everywhere else, Home hero included.
 *   permission
 *   / model
 */
const REACHABILITY: Record<Combination, readonly string[]> = {
  C1: ["mode", "folder-row", "scope", "output", "permission", "model"],
  C2: ["mode", "folder-row", "file-row", "scope", "output", "permission", "model"],
  C3: ["mode"],
  C4: ["mode"],
  C5: ["mode", "tabs-more", "folder-row", "scope", "output", "permission", "model"],
  C6: ["mode", "tabs-more", "folder-row", "file-row", "scope", "output", "permission", "model"],
  C7: ["mode", "tabs-more", "folder-row", "scope", "output", "permission", "model"],
  C8: ["mode", "tabs-more", "folder-row", "file-row", "scope", "output", "permission", "model"],
  C9: ["mode", "tabs-more", "scope", "output", "permission", "model"],
  C10: ["mode", "tabs-more", "scope", "output", "permission", "model"],
};

async function isVisible(page: Page, selector: string): Promise<boolean> {
  const node = page.locator(selector).first();
  if ((await node.count()) === 0) return false;
  try {
    const box = await node.boundingBox({ timeout: 2_000 });
    return !!box && box.width > 0 && box.height > 0;
  } catch {
    return false;
  }
}

async function openMenu(page: Page, site: CallSite): Promise<void> {
  const trigger = page.locator(site.trigger).first();
  if (site.gesture === "click") await trigger.click();
  else if (site.gesture === "contextmenu") await trigger.click({ button: "right" });
  // `.press` rather than focus-then-key: the composer settles asynchronously
  // after `data-loaded`, and a key aimed at "whatever is focused now" lands
  // nowhere if focus moves between the two calls (see fix-w1a.spec.ts:158).
  else await trigger.press("ArrowDown");
  await page.locator(MENU).waitFor();
}

async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator(MENU)).toHaveCount(0);
}

test.describe("gate: shell overlays are never clipped", () => {
  for (const combination of COMBINATIONS) {
    test(`${combination}: every reachable menu opens fully on screen`, async ({ page }) => {
      await open(page, combination, { session: "fixes/W4" });
      const reachable = new Set(REACHABILITY[combination]);

      for (const site of CALL_SITES) {
        const present = await isVisible(page, site.trigger);

        if (!reachable.has(site.id)) {
          // The declared absences are assertions too. A trigger appearing where
          // the table says there is none means the table is stale, and a stale
          // table is how a call site stops being covered without anyone noticing.
          expect(
            present,
            `${combination}/${site.id} (${site.source}) is reachable now; REACHABILITY says it is not`,
          ).toBe(false);
          continue;
        }

        expect(
          present,
          `${combination}/${site.id} (${site.source}) has no visible trigger; REACHABILITY says it should`,
        ).toBe(true);

        await openMenu(page, site);
        const measured = await expectNoClip(page, MENU);
        // eslint-disable-next-line no-console
        console.log(`W4-GATE1 ${combination}/${site.id} ${JSON.stringify(measured!.rect)}`);
        await closeMenu(page);
      }
    });
  }

  /**
   * A drift guard on the table above, in the spirit of `deadControls.test.ts`.
   *
   * Everything else here iterates CALL_SITES, so a ninth `<Menu>` added to the
   * shell is covered by nothing and every test still passes. This counts the
   * call sites in the source instead, and fails until the new one is registered.
   * (It caught one while this gate was being written: a "What this message
   * makes" menu being added to `Composer.tsx` on another branch.)
   */
  test("every <Menu> in src/shell is registered in CALL_SITES", async () => {
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

    expect(
      found.length,
      `src/shell has ${found.length} <Menu> call sites, CALL_SITES has ${CALL_SITES.length}:\n${found.join("\n")}`,
    ).toBe(CALL_SITES.length);
  });
});
