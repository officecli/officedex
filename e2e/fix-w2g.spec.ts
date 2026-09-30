/**
 * W2-G regression gate: one preference, one answer, everywhere, immediately.
 *
 * The three defects this closes are all the same fault seen from three angles
 * (audit S7-002 / S7-003 / S7-004):
 *
 *   - two menus on the same screen disagreed about `enterToSend`;
 *   - Reduced motion did not reach the carousel until Home happened to remount;
 *   - the workspace's attention border was never handed the preference at all.
 *
 * ── What r10 moved ─────────────────────────────────────────────────────────
 *
 * Both preferences now have exactly one control: a `role="switch"` in Settings
 * → General. The composer's permission menu, which carried "Enter sends · on"
 * as its own second opinion, is gone, and so is the carousel Reduced motion
 * failed to reach. So there is no longer a pair of *controls* to disagree — and
 * that is the fix, not a gap in the check. What is left to guarantee is the
 * harder half: the control and the code that acts on the preference must agree,
 * and a reader on another screen must already have the new value.
 *
 * So the readers are what this file checks: the composer's Enter key (which is
 * what `enterToSend` is actually for), the shell's own reduced-motion state, and
 * the workspace attention border. Every case changes the setting through the one
 * switch and then asks a different consumer, inside one page load — `#shell` is
 * stamped and the stamp is checked at the end of each case, because a reload
 * would make a broken build look fixed, which is exactly how S7 told the two
 * apart.
 *
 * There is deliberately no `test.skip` anywhere in this file, conditional or
 * otherwise. `e2e/ui-audit-s4.spec.ts` is 30 cases of `test.skip(!BRIDGE)`,
 * which reports "30 skipped" and exit code 0 when its environment is absent —
 * indistinguishable from a pass in a CI summary line. Everything here runs
 * against the fixture server, which needs nothing but the dev server.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w2g.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

import { open } from "./r10-b-helpers";

const GEAR = "#dx-sidebar [data-act=settings]";
const HOME_TAB = "#dx-global-controls [data-act=home]";
/** The audit dataset's working conversation — the one C5 and C6 open. */
const WORKING_CHAT = "#dx-sidebar [data-act=open-chat][data-id=task-working]";

/**
 * Reads a preference switch, leaving the shell on the Settings page.
 *
 * Both preferences live under General. The state comes off `aria-checked`
 * rather than out of the label: the old sidebar row wrote its state into its own
 * words ("Enter sends" / "Enter adds a line"), which is one of the three
 * label/sub-label/ARIA inconsistencies S7-012 recorded, and a `role="switch"`
 * makes it unnecessary.
 */
async function readPreference(page: Page, name: string) {
  await page.locator(GEAR).click();
  await expect(page.locator("#shell")).toHaveAttribute("data-page", "settings");
  await page.getByRole("button", { name: "General", exact: true }).click();
  const control = page.getByRole("switch", { name, exact: true });
  await expect(control).toHaveCount(1);
  return { label: name, checked: await control.getAttribute("aria-checked") };
}

/** Flips a preference and reports what it now says. */
async function flipPreference(page: Page, name: string) {
  const before = await readPreference(page, name);
  await page.getByRole("switch", { name, exact: true }).click();
  const control = page.getByRole("switch", { name, exact: true });
  await expect(control).toHaveAttribute("aria-checked", before.checked === "true" ? "false" : "true");
  return { before: before.checked, after: await control.getAttribute("aria-checked") };
}

/**
 * Stamps a node so a later check can tell "still the same element" from "React
 * threw it away and built a new one" — and, for `#shell`, "the page reloaded".
 */
async function stamp(page: Page, selector: string, mark: string) {
  const applied = await page.evaluate(
    ([target, value]) => {
      const node = document.querySelector(target) as HTMLElement | null;
      if (!node) return false;
      node.dataset.w2gMark = value;
      return true;
    },
    [selector, mark] as const,
  );
  expect(applied, `${selector} is not in the DOM to stamp`).toBe(true);
}

async function expectSameNode(page: Page, selector: string, mark: string) {
  const found = await page.getAttribute(selector, "data-w2g-mark");
  expect(found, `${selector} was replaced — this check proves nothing now`).toBe(mark);
}

/** Types into a composer and returns what happened when Enter was pressed. */
async function tryEnter(page: Page, draft: string, modifier: "" | "Meta" = "") {
  const input = page.locator(`textarea[data-draft=${draft}]`);
  await expect(input).toHaveCount(1);
  await input.fill("Draft the launch checklist");
  await input.press(modifier ? `${modifier}+Enter` : "Enter");
  // Sending clears the draft; on Home it also opens a conversation, which takes
  // the page off Home. Either way, what is asserted is whether the words went.
  await page.waitForTimeout(300);
  return page.evaluate((selector: string) => {
    const node = document.querySelector<HTMLTextAreaElement>(selector);
    return {
      stillThere: node !== null,
      text: node?.value ?? null,
      page: document.getElementById("shell")!.getAttribute("data-page"),
    };
  }, `textarea[data-draft=${draft}]`);
}

test.describe("W2-G one settings store", () => {
  /* ------------------------------------------------------------- S7-002 */

  test("S7-002 the Enter preference and the key that acts on it agree, both ways", async ({ page }) => {
    // The sequence S7 recorded, with the reader that is left: after flipping the
    // setting the *other* consumer still behaved as though it were unchanged.
    // Home's composer is the reader here because Home is one navigation away
    // from Settings and nothing is reloaded in between.
    await open(page, "C1");
    await stamp(page, "#shell", "shell");

    expect(await readPreference(page, "Enter to send")).toEqual({
      label: "Enter to send",
      checked: "true",
    });

    // on → off. Enter must now be a newline, and ⌘Enter must still send.
    await page.getByRole("switch", { name: "Enter to send", exact: true }).click();
    await page.locator(HOME_TAB).click();
    await expect(page.locator("#shell")).toHaveAttribute("data-page", "home");

    const withEnterOff = await tryEnter(page, "home");
    // eslint-disable-next-line no-console
    console.log(`W2G enter-off ${JSON.stringify(withEnterOff)}`);
    expect(withEnterOff.page, "Enter sent the message with the preference off").toBe("home");
    // Off means "Enter adds a line", so the draft is still there and one line
    // longer — not merely "not sent".
    expect(withEnterOff.text, "Enter did not add a line with the preference off").toBe(
      "Draft the launch checklist\n",
    );

    const withModifier = await tryEnter(page, "home", "Meta");
    // eslint-disable-next-line no-console
    console.log(`W2G enter-off-meta ${JSON.stringify(withModifier)}`);
    expect(withModifier.page, "⌘Enter did not send either, so nothing can be sent").not.toBe("home");

    // off → on, from the same one control, and the same reader follows.
    expect(await readPreference(page, "Enter to send")).toEqual({
      label: "Enter to send",
      checked: "false",
    });
    await page.getByRole("switch", { name: "Enter to send", exact: true }).click();
    await page.locator(HOME_TAB).click();
    await expect(page.locator("#shell")).toHaveAttribute("data-page", "home");

    const withEnterOn = await tryEnter(page, "home");
    // eslint-disable-next-line no-console
    console.log(`W2G enter-on ${JSON.stringify(withEnterOn)}`);
    expect(withEnterOn.page, "Enter did not send with the preference back on").not.toBe("home");

    // Nothing reloaded: the whole sequence is one page load, which is what makes
    // it a check on the store rather than on the port's persistence.
    await expectSameNode(page, "#shell", "shell");
  });

  /* ------------------------------------------------------------- S7-003 */

  test("S7-003 Reduced motion reaches the shell in the same mount", async ({ page }) => {
    // The carousel this used to be measured on is gone. What replaced it is a
    // rule on the root — `#shell.dx-reduced [data-ui-scope=officedex] *` — which
    // makes `#shell` itself the consumer, and `#shell` is the one node that can
    // never be remounted while the application is running. So the stamp is worth
    // more here than it was on the carousel, not less.
    await open(page, "C10");
    await stamp(page, "#shell", "shell");

    /** Every scoped element on screen that is still declaring motion. */
    const animating = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#dx-workspace [data-ui-scope="officedex"], #dx-workspace [data-ui-scope="officedex"] *')]
          .filter((node) => {
            const style = getComputedStyle(node);
            const transitions = style.transitionDuration.split(",").some((value) => parseFloat(value) > 0);
            const animations = style.animationName !== "none" && parseFloat(style.animationDuration) > 0;
            return transitions || animations;
          })
          .map((node) => node.className || node.tagName.toLowerCase())
          .slice(0, 12),
      );

    const before = await animating();
    // eslint-disable-next-line no-console
    console.log(`W2G motion before ${JSON.stringify(before)}`);
    expect(
      before.length,
      "nothing on this screen declares motion, so turning it off proves nothing",
    ).toBeGreaterThan(0);
    await expect(page.locator("#shell")).not.toHaveClass(/dx-reduced/);

    const flipped = await flipPreference(page, "Reduce motion");
    expect(flipped).toEqual({ before: "false", after: "true" });
    // Same node, same page load: that is the whole difference between the bug
    // and the fix.
    await expectSameNode(page, "#shell", "shell");
    await expect(page.locator("#shell")).toHaveClass(/dx-reduced/);

    const after = await animating();
    // eslint-disable-next-line no-console
    console.log(`W2G motion after ${JSON.stringify(after)}`);
    expect(after, "Reduced motion is on and these are still declaring motion").toEqual([]);

    // And it is a preference, not a one-way door.
    await page.getByRole("switch", { name: "Reduce motion", exact: true }).click();
    await expect(page.locator("#shell")).not.toHaveClass(/dx-reduced/);
    expect((await animating()).length).toBeGreaterThan(0);
    await expectSameNode(page, "#shell", "shell");
  });

  /* ------------------------------------------------------------- S7-004 */

  test("S7-004 the workspace attention border obeys Reduced motion", async ({ page }) => {
    // C5 is a workspace with the seeded working conversation in scope, which is
    // what lights this border: `attentionActive` in App.tsx needs a run in
    // progress, a document on screen and the editor page.
    await open(page, "C5");
    const host = ".dx-editor-wrapper .shell-attention";
    await expect(page.locator(host)).toHaveCount(1);
    await expect(page.locator(`${host} svg`)).toHaveCount(1);

    /** Samples the travelling light's geometry over ~400ms. */
    const travelling = async () =>
      page.evaluate(async (target: string) => {
        const svg = document.querySelector(`${target} svg`) as SVGElement | null;
        if (!svg) return null;
        const sample = () => (svg.outerHTML.match(/-?\d+\.\d{2}/g) ?? []).slice(0, 12).join(",");
        const first = sample();
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { moved: first !== sample() };
      }, host);

    const before = await travelling();
    // eslint-disable-next-line no-console
    console.log(`W2G attention before ${JSON.stringify(before)}`);
    expect(before?.moved, "the border was not animating, so turning it off proves nothing").toBe(true);

    // The host is only hidden while another page is showing (see the note at the
    // top of App.tsx), so the stamp survives the trip to Settings and back and
    // the measurement afterwards is of the same overlay, not a fresh one.
    await stamp(page, host, "attention");
    await stamp(page, "#shell", "shell");

    const flipped = await flipPreference(page, "Reduce motion");
    expect(flipped).toEqual({ before: "false", after: "true" });

    // Back to the document the way a user gets back to it: the conversation, then
    // its tab. Settings closes the conversation (`go` drops it), so both steps
    // are needed and both are ordinary controls.
    await page.locator(WORKING_CHAT).click();
    await expect(page.locator("#shell")).toHaveAttribute("data-page", "assets");
    await page.locator(".dx-tab-title[data-id=file-plan]").click();
    await expect(page.locator("#shell")).toHaveAttribute("data-page", "editor");
    await expect(page.locator(`${host} svg`)).toHaveCount(1);

    await expectSameNode(page, host, "attention");
    await expectSameNode(page, "#shell", "shell");

    const after = await travelling();
    // eslint-disable-next-line no-console
    console.log(`W2G attention after ${JSON.stringify(after)}`);
    // The prop App.tsx used to omit. Before the fix this stayed true forever,
    // through the switch, a remount and a restart.
    expect(after?.moved, "Reduced motion is on but the light is still travelling").toBe(false);
  });

  /* ---------------------------------------------- the shared store itself */

  test("a preference set in Settings is already set in the Dex panel's composer", async ({ page }) => {
    // The third composer, and the least likely to be remembered: Dex over an
    // open document has its own, and it reads the same store. The setting has to
    // be one value for the whole application, not one per surface that happens
    // to be mounted.
    await open(page, "C5");
    await stamp(page, "#shell", "shell");

    const flipped = await flipPreference(page, "Enter to send");
    expect(flipped).toEqual({ before: "true", after: "false" });

    await page.locator(WORKING_CHAT).click();
    await page.locator(".dx-tab-title[data-id=file-plan]").click();
    await expect(page.locator("#shell")).toHaveAttribute("data-page", "editor");

    await page.locator("button.dx-dex[data-act=dex]").click();
    await expect(page.locator(".dx-dex-panel")).toBeVisible();

    const withEnterOff = await tryEnter(page, "dex");
    // eslint-disable-next-line no-console
    console.log(`W2G dex-enter-off ${JSON.stringify(withEnterOff)}`);
    expect(withEnterOff.text, "the Dex composer sent on Enter with the preference off").toBe(
      "Draft the launch checklist\n",
    );
    await expectSameNode(page, "#shell", "shell");
  });
});
