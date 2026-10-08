/**
 * W1-A regression gate: every menu the S2 audit found clipped is still fully on
 * screen, in the r10 surface that replaced the one it was measured in.
 *
 * This is a gate, not a probe. Each check ends in `expectNoClip`, which fails
 * unless the panel is inside the viewport *and* no ancestor's overflow cuts it.
 *
 * **What r10 changed.** The engine W1-A wrote — `chrome/Menu.tsx`, measuring its
 * anchor and portalling to `#shell` — is no longer the workspace's. Menus come
 * from `openMenu` in `src/shell/kit/layers.tsx` and are drawn in `#dx-layers`.
 * So every case below is a rewrite against `.dx-menu`, and each one says which
 * r10 control now stands where the audited one did. The findings that were about
 * controls r10 deleted outright — the Agent/Editor mode switch, the composer's
 * scope and permission chips — are gone from this file and recorded in the
 * migration ledger rather than reinterpreted into something they were not about.
 *
 * There is deliberately no `test.skip` anywhere in this file, conditional or
 * otherwise. `e2e/ui-audit-s4.spec.ts` is 30 cases of `test.skip(!BRIDGE)`,
 * which reports "30 skipped" and exit code 0 when its environment is absent —
 * indistinguishable from a pass in a CI summary line. Everything here runs
 * against the fixture server, which needs nothing but the dev server, so a
 * missing environment is a failure rather than a silent pass.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w1a.spec.ts
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoClip, expectOnTop, open, type Combination } from "./r10-a-helpers";

const MENU = ".dx-menu";

/** The measurement the fix is judged on, printed so the report can quote it. */
async function record(page: Page, name: string) {
  const measured = await expectNoClip(page, MENU);
  // eslint-disable-next-line no-console
  console.log(`W1A-FIXED ${name} ${JSON.stringify(measured)}`);
  return measured;
}

async function closeMenu(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(MENU)).toHaveCount(0);
}

/**
 * Opens a list row's menu.
 *
 * The "more" button on a tree row, a file row and an asset line is `opacity: 0`
 * and — in the conversation column — `pointer-events: none` until its row is
 * hovered, so the row is hovered first and the button clicked second. This is
 * the r10 shape of the hazard the old spec noted at `FileTree.tsx:281`
 * (`display: none` until hover), and the reason a menu must not anchor to its
 * trigger: the panel outlives the hover that revealed it.
 */
async function openRowMenu(row: Locator, trigger: string): Promise<void> {
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator(trigger).click();
}

test.describe("W1-A overlay engine", () => {
  /* ------------------------------------------------------------- S2-002 */

  /*
   * S2-002 was "the 250px sidebar settings menu is 84% clipped in all four
   * combinations". That menu is gone, and so is the full-window settings cover
   * W1-A replaced it with: r10 makes Settings a page of the content region
   * (`state.page === "settings"`, `pages/SettingsPage.tsx`).
   *
   * The finding is still guarded, and the guarantee is the one it was really
   * about: the shell's door onto settings is not a dropdown trapped in the
   * sidebar's overflow box (`#dx-sidebar` is `overflow: hidden` and 0px wide
   * when hidden). So pressing the gear must open no menu at all, and what it
   * does open must escape that box — which `expectNoClip` fails unless no
   * ancestor's overflow touches it.
   */
  test("S2-002 the settings door opens a page, not a panel inside the sidebar", async ({ page }) => {
    for (const combination of ["C1", "C3", "C4", "C5"] as Combination[]) {
      await open(page, combination);
      await page.locator("#dx-sidebar .dx-sidebar-footer [data-act=settings]").click();
      await expect(page.locator("#shell")).toHaveAttribute("data-page", "settings");
      // Not a dropdown: the thing the finding was about cannot have opened.
      await expect(page.locator(MENU)).toHaveCount(0);

      // The page's own region, not its scrolled contents: a settings page is
      // taller than the window by design and scrolls inside itself, which is
      // what `.dx-settings-layout` being cut off by `.dx-page-scroll` means.
      // What must not be cut off is the region the page is drawn in.
      const measured = await expectNoClip(page, "#dx-content > .dx-page-scroll");
      // eslint-disable-next-line no-console
      console.log(`W1A-FIXED settings-page-${combination} ${JSON.stringify(measured)}`);
      // And it is the content region's width, not the sidebar's 244.
      expect(measured.rect.width).toBeGreaterThan(400);
      // The section nav and the body are both inside it rather than in a 250px
      // dropdown, which is the shape the finding was about.
      await expect(page.locator("#dx-content .dx-settings-nav")).toBeVisible();
      await expect(page.locator("#dx-content .dx-settings-content")).toBeVisible();
    }
  });

  /* ------------------------------------------------------- S2-001 / S1-002 */

  /**
   * S2-001, first instance: a menu hanging off a row of the sidebar's tree.
   *
   * The audited control was a folder row's right-click context menu, which r10
   * does not have — the tree holds projects and conversations, and each row's
   * management is behind its own "more" button (`Sidebar.tsx`,
   * `useWorkspaceMenus.projectMenu`). Same row, same two overflow ancestors
   * (`#dx-sidebar`, `.dx-sidebar-scroll`), same question.
   *
   * Measured in every shell whose sidebar is showing. The four that hide it have
   * no tree to open a menu from at all, which `gates.spec.ts` asserts as an
   * absence rather than leaving as a gap here.
   */
  test("S2-001 a project row's menu is fully visible wherever the tree is showing", async ({ page }) => {
    for (const combination of ["C1", "C3", "C4", "C5", "C8", "C10"] as Combination[]) {
      await open(page, combination);
      const row = page.locator("#dx-sidebar .dx-project-row").first();
      await expect(row).toBeVisible();
      await openRowMenu(row, "[data-act=project-menu]");
      await page.locator(MENU).waitFor();
      await record(page, `project-row-menu-${combination}`);
      // On the old rail the panel was a 35px white sliver; the first item's
      // label being readable is the thing the number stands for.
      await expect(page.locator(`${MENU} button`).first()).toBeVisible();
      await closeMenu(page);
    }
  });

  /**
   * S2-001, the instance the audit inferred rather than measured: a file row's
   * menu, whose trigger is invisible until the row is hovered and whose panel
   * outlives the hover.
   *
   * r10's file rows are in Home Recent, Local and a project's Assets, and all
   * three go through the same `useFileActions.fileMenu`. Its sixteen items make
   * it the tallest menu the shell has, so it is also the one most likely to run
   * off the bottom of the window — which is why the row is taken from the
   * *lower* half of the list rather than the first one.
   */
  test("S2-001 a file row's menu, opened from a row near the bottom of the list", async ({ page }) => {
    await open(page, "C1");
    const rows = page.locator("#dx-content .dx-file-row");
    const count = await rows.count();
    expect(count, "Home has no Recent rows to open a menu from").toBeGreaterThan(1);
    const row = rows.nth(count - 1);
    await openRowMenu(row, "[data-act=file-menu]");
    await page.locator(MENU).waitFor();
    const measured = await record(page, "file-row-menu-C1");
    await expect(page.locator(`${MENU} button`).first()).toBeVisible();
    // The trigger's own row is at the foot of a scroller; a panel placed from
    // `rect.bottom` with no clamp would be below the window.
    expect(measured.rect.bottom).toBeLessThanOrEqual(720);
    await closeMenu(page);
  });

  /* ------------------------------------------------------------- S2-004 */

  /**
   * S2-004: the document strip's menu, which opened from a trigger 44px from
   * the right edge of the window and ran 146px past it.
   *
   * r10's counterpart is the same control in the same corner:
   * `DocumentTabs.tsx`'s `[data-act=file-menu]`, last in
   * `.dx-source-header-actions` at the right end of the content region's 40px
   * top row.
   */
  test("S2-004 the document strip's menu stays inside the window", async ({ page }) => {
    for (const combination of ["C6", "C7", "C9"] as Combination[]) {
      await open(page, combination);
      await page.locator(".dx-source-header-actions [data-act=file-menu]").click();
      await page.locator(MENU).waitFor();
      const measured = await record(page, `document-menu-${combination}`);
      expect(measured.rect.right).toBeLessThanOrEqual(1280);
      await closeMenu(page);
    }
  });

  /* ------------------------------------------------- S2-005 / S2-006 / S4-006 */

  /**
   * S2-005: a menu opened from the composer, in every placement the composer
   * has.
   *
   * The audit measured three chips — scope, permission and model. r10's agent
   * composer has one menu left: Model. Scope went with the mode switch (the
   * conversation belongs to a project, so there is nothing to pick) and
   * permission is in the Task context dialog. Those two are recorded as deleted
   * in the migration ledger rather than mapped onto controls they were not
   * about; the placements are what mattered here and all of them still exist.
   *
   * C4/C5 dock the conversation on the left, C6 on the right, C7 floats it, C8
   * has it alone — four different clipping contexts for the same panel. C5/C6/C7
   * additionally carry the Dex panel over the document, which is the only r10
   * composer *inside* an overflow container (`.dx-editor-wrapper` is
   * `overflow: hidden`) and therefore the direct heir to the old
   * `.shell-cx` / `.shell-presence-panel` cases.
   */
  test("S2-005 the composer's model menu in every placement", async ({ page }) => {
    for (const combination of ["C4", "C5", "C6", "C7", "C8"] as Combination[]) {
      await open(page, combination);
      const trigger = page.locator("#dx-conversation [data-act=model-picker]");
      await expect(trigger).toBeVisible();
      await trigger.click();
      await page.locator(MENU).waitFor();
      await record(page, `conversation-model-menu-${combination}`);
      await closeMenu(page);
    }

    for (const combination of ["C5", "C6", "C7", "C9"] as Combination[]) {
      await open(page, combination);
      await page.locator("button.dx-dex[data-act=dex]").click();
      const trigger = page.locator(".dx-dex-panel [data-act=model-picker]");
      await expect(trigger).toBeVisible();
      await trigger.click();
      await page.locator(MENU).waitFor();
      const measured = await record(page, `dex-model-menu-${combination}`);
      // The Dex panel is 320px wide and lives inside the editor wrapper. A panel
      // that stayed inside its host would be narrower than the menu's own
      // minimum, so this also says it really did escape.
      expect(measured.rect.width).toBeGreaterThanOrEqual(240);
      await closeMenu(page);
    }
  });

  test("S2-006 a menu never grows past the room it has", async ({ page }) => {
    // The file menu is the shell's longest — sixteen rows — opened from the last
    // row of a list, which is where the old `max-height: 340px` constant put the
    // panel exactly 1px past the bottom of a 720px window.
    await open(page, "C3");
    const rows = page.locator("#dx-content .dx-file-row");
    const row = rows.nth((await rows.count()) - 1);
    await openRowMenu(row, "[data-act=file-menu]");
    await page.locator(MENU).waitFor();

    const measured = await record(page, "file-menu-height-C3");
    expect(measured.rect.bottom).toBeLessThanOrEqual(720);
    expect(measured.rect.top).toBeGreaterThanOrEqual(0);

    const room = await page.locator(MENU).evaluate((node) => ({
      maxHeight: getComputedStyle(node).maxHeight,
      // `overflow: auto` is the other half of the promise: a menu taller than
      // the room scrolls inside itself rather than being cut off.
      overflowY: getComputedStyle(node).overflowY,
      scrollable: node.scrollHeight > node.clientHeight,
    }));
    // OD-UI-1.2 §08: the panel keeps 16px from each edge of the window.
    expect(parseFloat(room.maxHeight)).toBeLessThanOrEqual(720 - 32);
    expect(room.overflowY).toBe("auto");
  });

  /* ------------------------------------------------------------- S2-007 */

  /**
   * S2-007: a menu whose anchor scrolls away.
   *
   * The audited fix was "follow the anchor while it is in its scroller, close
   * once it has left" — a menu still pointing at a row that has moved is the
   * defect, and either answer cures it. So both are accepted here; what is not
   * accepted is the panel sitting still over whatever is in that spot now.
   *
   * Measured on Local's file table rather than the sidebar's tree: r10's tree
   * holds four projects and their conversations and does not overflow the window,
   * so there would be nothing to scroll. Local lists every file in the folder —
   * 57 rows in the audit fixture — inside `.dx-page-scroll`, which is the r10
   * place this happens in.
   *
   * At 1280×1200, not the default 1280×720, and both numbers are load-bearing.
   * The file menu is 652px tall, so in a 720px window `MenuLayer`'s
   * `min(rect.bottom + 4, innerHeight - height - 8)` resolves to 60 wherever the
   * anchor is: the panel's position stops depending on its anchor at all and the
   * measurement cannot answer the question being asked. The taller window, plus a
   * row picked from the upper third of the list, leaves room below the anchor — so
   * "did it follow" is a fact rather than an artefact of the clamp. The premise is
   * asserted below rather than assumed.
   */
  test("S2-007 a menu does not stay behind when its anchor scrolls away", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1200 });
    await open(page, "C3");
    const scroller = page.locator("#dx-content > .dx-page-scroll");
    expect(
      await scroller.evaluate((node) => node.scrollHeight - node.clientHeight),
      "Local's file table does not scroll, so there is nothing to measure",
    ).toBeGreaterThan(400);

    // Part-way down the list, so there are rows above and below the one used and
    // the scroll that follows moves it rather than hitting either end.
    await scroller.evaluate((node) => {
      node.scrollTop = 800;
    });
    await page.waitForTimeout(100);
    const index = await page.evaluate(() =>
      [...document.querySelectorAll("#dx-content .dx-file-row")].findIndex(
        (node) => node.getBoundingClientRect().top > 300,
      ),
    );
    expect(index, "no file row sits below y=300 to open a menu from").toBeGreaterThanOrEqual(0);

    const row = page.locator("#dx-content .dx-file-row").nth(index);
    await openRowMenu(row, "[data-act=file-menu]");
    await page.locator(MENU).waitFor();
    const before = await record(page, "scroll-follow-before");
    const anchorBefore = await row.boundingBox();
    // The premise: there is room below the row, so the panel's top is its
    // anchor's and not the window's floor. Without this the rest proves nothing.
    expect(before.rect.top).toBeGreaterThan(anchorBefore!.y);

    await scroller.evaluate((node) => {
      node.scrollTop += 240;
    });
    await page.waitForTimeout(250);

    const anchorAfter = await row.boundingBox();
    const menu = await page.locator(MENU).count();
    const after = menu > 0 ? await expectNoClip(page, MENU) : null;
    // eslint-disable-next-line no-console
    console.log(
      `W1A-FIXED scroll-follow-after ${JSON.stringify({ open: menu > 0, menu: after?.rect, anchor: anchorAfter })}`,
    );

    /*
     * One of the two cures, and nothing else.
     *
     * "Followed" is the panel moving by what the anchor moved by and not
     * drifting sideways — the anchor is the trigger, whose box does not change
     * when the pointer leaves the row and the hover-only button fades out.
     * "Closed" is the other acceptable answer. A panel still open at its old
     * coordinates is the defect, whichever of the two the engine was aiming for.
     */
    const followed =
      after !== null &&
      Math.abs(before.rect.top - after.rect.top - (anchorBefore!.y - anchorAfter!.y)) < 1 &&
      Math.abs(after.rect.left - before.rect.left) < 1;
    expect(
      menu === 0 || followed,
      `the menu neither followed its anchor nor closed: it stayed at top ${after?.rect.top} while the row moved ${
        anchorBefore!.y - anchorAfter!.y
      }px`,
    ).toBe(true);

    // Scrolled right past it: the anchor leaves the scroller, so the panel must
    // be gone rather than hanging over whatever is in that spot now.
    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page.waitForTimeout(250);
    await expect(page.locator(MENU)).toHaveCount(0);
  });

  /* ------------------------------ the portal's two structural requirements */

  test("the panel is portalled inside #shell, not onto document.body", async ({ page }) => {
    // Every design token is declared on `#shell` (`tokens.css`), the `--od-*`
    // bridge included. A panel on `document.body` renders in the browser's
    // default serif with every token unresolved — R3's failure mode, and the fix
    // for R1 must not create a second instance of it.
    await open(page, "C1");
    await openRowMenu(page.locator("#dx-sidebar .dx-project-row").first(), "[data-act=project-menu]");
    await page.locator(MENU).waitFor();

    const placement = await page.locator(MENU).evaluate((node) => ({
      insideShell: !!node.closest("#shell"),
      parentId: node.parentElement?.id ?? "",
      position: getComputedStyle(node).position,
      fontFamily: getComputedStyle(node).fontFamily,
      shellFont: getComputedStyle(document.querySelector("#shell")!).fontFamily,
      // The host carries the scope attribute the element selectors are keyed to
      // (`:where([data-ui-scope=officedex])`), or the panel is unstyled inside a
      // styled window.
      hostScope: node.parentElement?.getAttribute("data-ui-scope") ?? "",
    }));
    // eslint-disable-next-line no-console
    console.log(`W1A-FIXED portal ${JSON.stringify(placement)}`);

    expect(placement.insideShell).toBe(true);
    expect(placement.parentId).toBe("dx-layers");
    expect(placement.position).toBe("fixed");
    expect(placement.hostScope).toBe("officedex");
    expect(placement.fontFamily).toBe(placement.shellFont);
    expect(placement.fontFamily).toContain("PingFang SC");
  });

  test("no inner overflow container is above an open panel", async ({ page }) => {
    /*
     * The old spec named five `overflow: hidden` ancestors and required four of
     * them to be out of the chain, `.shell` staying because it is the portal host
     * and is the size of the viewport.
     *
     * r10's five are `#dx-sidebar` and `.dx-sidebar-scroll` (the tree),
     * `#dx-conversation` and `.dx-chat-scroll` (the conversation), and
     * `.dx-editor-wrapper` (the document host, which holds the Dex panel).
     * Measured from the Dex panel's own menu, because that is the one opened
     * from inside the deepest of them.
     */
    await open(page, "C7");
    await page.locator("button.dx-dex[data-act=dex]").click();
    await page.locator(".dx-dex-panel [data-act=model-picker]").click();
    await page.locator(MENU).waitFor();

    const chain = await page.locator(MENU).evaluate((node) => {
      const clippers: string[] = [];
      for (let p = node.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflow !== "visible" || s.overflowX !== "visible" || s.overflowY !== "visible") {
          clippers.push(`${p.tagName.toLowerCase()}${p.id ? `#${p.id}` : ""}.${String(p.className)}`.trim());
        }
      }
      const shell = document.querySelector("#shell")!.getBoundingClientRect();
      return {
        clippers,
        shellCoversViewport:
          shell.left <= 0 &&
          shell.top <= 0 &&
          shell.right >= window.innerWidth &&
          shell.bottom >= window.innerHeight,
      };
    });
    // eslint-disable-next-line no-console
    console.log(`W1A-FIXED clipping-ancestors ${JSON.stringify(chain)}`);

    for (const gone of [
      "dx-sidebar",
      "dx-sidebar-scroll",
      "dx-conversation",
      "dx-chat-scroll",
      "dx-editor-wrapper",
      "dx-dex-panel",
    ]) {
      expect(chain.clippers.join(" "), `${gone} still clips the open panel`).not.toContain(gone);
    }
    expect(chain.shellCoversViewport).toBe(true);
    // And nothing painted over it, which the box walk above cannot see.
    await expectOnTop(page, MENU);
  });

  test("the keyboard contract S2-015 recorded as correct still holds", async ({ page }) => {
    /*
     * Portalling moves the panel out of its trigger's DOM subtree, which is
     * exactly the kind of change that quietly breaks Escape-returns-focus.
     *
     * Measured on a project row's menu. The brand's mode menu — where the old
     * spec measured it, "the call site that still exercises it from the same
     * corner of the frame" — went with the Agent/Editor switch, and the tree row
     * is the r10 call site that has the same shape: a trigger revealed by hover,
     * inside two scrollers, with a keyboard user having to get back out.
     */
    await open(page, "C1");
    const row = page.locator("#dx-sidebar .dx-project-row").first();
    await openRowMenu(row, "[data-act=project-menu]");
    await page.locator(MENU).waitFor();

    const focusInMenu = await page.evaluate(() => ({
      inMenu: document.activeElement?.closest(".dx-menu") !== null,
      role: document.activeElement?.getAttribute("role") ?? "",
    }));
    expect(focusInMenu.inMenu).toBe(true);
    expect(focusInMenu.role).toBe("menuitem");

    // Arrow keys move inside the panel, and Escape hands focus back to the
    // trigger — not to `document.body`, which is where a portalled panel leaves
    // it if nobody restores it.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(page.locator(MENU)).toHaveCount(0);
    await expect(row.locator("[data-act=project-menu]")).toBeFocused();
    // The trigger's own state goes with the panel (§17).
    await expect(row.locator("[data-act=project-menu]")).toHaveAttribute("aria-expanded", "false");

    // And a click on an item still reaches its handler through the portal:
    // New chat opens the name dialog.
    await openRowMenu(row, "[data-act=project-menu]");
    await page.locator(MENU).waitFor();
    await page.getByRole("menuitem", { name: "New Chat" }).click();
    await expect(page.locator("dialog#dx-modal")).toBeVisible();
    await expect(page.locator("#dx-modal-title")).toHaveText("New Chat");
  });
});
