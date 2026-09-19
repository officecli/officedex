/**
 * W1-D — the mandatory-update page, after the Wave 1 fixes.
 *
 * This is the one full-screen surface a user cannot navigate away from: the
 * backend has refused their build, and whatever is on this card is their only
 * instruction. The audit found it shipping with no stylesheet at all in the
 * shell build (S0-001), a `downloaded` card whose bar, sentence and button each
 * claimed something different (S8-001), three phases rendering the same pixels
 * (S8-003) and an error state whose only control was worded exactly like the
 * one that had just failed (S8-004).
 *
 * Every assertion here runs unconditionally. There is no environment probe and
 * no `test.skip` in this file on purpose: a suite that reports "30 skipped,
 * exit 0" as a pass is how the earlier round of this audit convinced itself a
 * spec was green.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3124 \
 *   OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT=test-results/w1d \
 *   npx playwright test e2e/fix-w1d.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

const PHASES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "error",
] as const;

type Phase = (typeof PHASES)[number];

/** Phases whose card shows a progress bar, and the value it must show. */
const EXPECTED_BAR: Partial<Record<Phase, number>> = {
  // 46,137,344 / 118,489,088 from shell/main.tsx's preview progress.
  downloading: 39,
  // Both of these are complete by definition of the phase, not by byte count.
  downloaded: 100,
  installing: 100,
};

interface CardReading {
  title: string;
  titleFontFamily: string;
  status: string;
  bar: number | null;
  buttons: { text: string; disabled: boolean }[];
  links: { text: string; href: string }[];
  overlayBackground: string;
  cardWidth: number;
}

async function openPhase(page: Page, phase: Phase): Promise<void> {
  await page.goto(`/?forceUpdate=${phase}`);
  await expect(page.locator(".force-update-card")).toBeVisible();
}

async function read(page: Page): Promise<CardReading> {
  return page.evaluate(() => {
    const overlay = document.querySelector(".force-update-overlay");
    const card = document.querySelector(".force-update-card");
    const title = document.querySelector(".force-update-title");
    // One of the two is always present: a bar label while something is in
    // flight, a plain status line otherwise. Both carry the same sentence.
    const status =
      document.querySelector(".force-update-progress-label") ?? document.querySelector(".force-update-status");
    const bar = document.querySelector(".force-update-progress .od-progress");
    return {
      title: title?.textContent?.trim() ?? "",
      titleFontFamily: title ? getComputedStyle(title).fontFamily : "",
      status: status?.textContent?.trim() ?? "",
      bar: bar ? Number(bar.getAttribute("aria-valuenow")) : null,
      buttons: Array.from(card?.querySelectorAll("button") ?? []).map((b) => ({
        text: b.textContent?.trim() ?? "",
        disabled: (b as HTMLButtonElement).disabled,
      })),
      links: Array.from(card?.querySelectorAll("a[href]") ?? []).map((a) => ({
        text: a.textContent?.trim() ?? "",
        href: (a as HTMLAnchorElement).href,
      })),
      overlayBackground: overlay ? getComputedStyle(overlay).backgroundColor : "",
      cardWidth: card?.getBoundingClientRect().width ?? 0,
    };
  });
}

test.describe("W1-D mandatory update page", () => {
  test("the stylesheet ships with the component (S0-001)", async ({ page }) => {
    await openPhase(page, "available");
    const reading = await read(page);
    // Times is what an unstyled h1 falls back to on this platform. Seeing it
    // here is the whole of S0-001: the rules were in a bundle the shell entry
    // does not link.
    expect(reading.titleFontFamily).not.toMatch(/times/i);
    expect(reading.titleFontFamily.length).toBeGreaterThan(0);
    // 480px wide card, i.e. `.force-update-card` actually applied.
    expect(reading.cardWidth).toBe(480);
    // And the backdrop is opaque now, not a scrim over nothing (S8-006).
    expect(reading.overlayBackground).not.toMatch(/rgba/);
  });

  for (const phase of PHASES) {
    test(`${phase}: bar, status line and buttons agree (S8-001, S8-003)`, async ({ page }) => {
      await openPhase(page, phase);
      const reading = await read(page);

      expect(reading.title).toBe("Required update");
      expect(reading.status.length).toBeGreaterThan(0);

      const expectedBar = EXPECTED_BAR[phase] ?? null;
      expect(reading.bar).toBe(expectedBar);

      if (phase === "downloaded") {
        // The finding: a 39% bar under "Download complete. Restarting...".
        expect(reading.bar).toBe(100);
        expect(reading.status).toContain("Download complete");
        // And no button the auto-installer makes unpressable (S8-002).
        expect(reading.buttons.map((b) => b.text)).not.toContain("Restart to install");
      }
      if (phase === "downloading") {
        expect(reading.status).toContain("Downloading");
        // The sentence and the bar read the same byte counter.
        expect(reading.status).toContain("113 MB");
      }
      if (phase === "installing") {
        expect(reading.status).toBe("Restarting...");
      }
      if (phase === "checking") {
        // A phase that says it is doing something must not offer a button that
        // starts it again.
        expect(reading.buttons.map((b) => b.text)).toEqual(["Checking..."]);
        expect(reading.buttons[0].disabled).toBe(true);
      }
      if (phase === "idle" || phase === "available") {
        expect(reading.buttons.map((b) => b.text)).toEqual(["Update now"]);
        expect(reading.buttons[0].disabled).toBe(false);
      }
      // A bar means work is in flight; nothing in flight offers "Update now".
      if (reading.bar !== null) {
        expect(reading.buttons.map((b) => b.text)).not.toContain("Update now");
      }
    });
  }

  test("no two phases render the same card (S8-003)", async ({ page }) => {
    const seen = new Map<string, Phase>();
    for (const phase of PHASES) {
      await openPhase(page, phase);
      const reading = await read(page);
      // The identity of a phase is what it says and what it offers.
      const signature = JSON.stringify({
        status: reading.status,
        bar: reading.bar,
        buttons: reading.buttons,
        links: reading.links.map((l) => l.text),
      });
      const clash = seen.get(signature);
      expect(clash, `${phase} renders exactly what ${clash} renders`).toBeUndefined();
      seen.set(signature, phase);
    }
    expect(seen.size).toBe(PHASES.length);
  });

  test("the error state has a second way out (S8-004)", async ({ page }) => {
    await openPhase(page, "error");
    const reading = await read(page);

    // Not worded like the button that just failed.
    const texts = reading.buttons.map((b) => b.text);
    expect(texts).toContain("Try again");
    expect(texts).not.toContain("Update now");

    // At least two things the user can operate, and the second one is not the
    // same action under another name.
    const operable = reading.buttons.filter((b) => !b.disabled).length + reading.links.length;
    expect(operable).toBeGreaterThanOrEqual(2);
    expect(texts).toContain("Copy error details");

    // The failure text is labelled rather than dropped in as the page's own
    // voice (S8-005: it is server/exception wording, in whatever language).
    await expect(page.locator(".force-update-error-label")).toHaveText("Error details");
    await expect(page.locator(".force-update-error-detail")).toHaveText(
      "The download could not be verified.",
    );
    await expect(page.locator(".force-update-fallback")).toBeVisible();

    // And it is operable, not decorative.
    await page.locator(".force-update-fallback button").click();
    await expect(page.locator(".force-update-fallback button")).toHaveText("Copied");
  });

  test("server-authored release notes are labelled and can wrap (S8-005, S8-007)", async ({ page }) => {
    await openPhase(page, "available");
    await expect(page.locator(".force-update-notes-heading")).toHaveText("Release notes");

    const measured = await page.evaluate(() => {
      const notes = document.querySelector<HTMLElement>(".force-update-notes");
      if (!notes) return null;
      notes.textContent = "https://" + "a".repeat(100) + ".example.test/OfficeDex-1.4.0-arm64.dmg";
      const card = document.querySelector<HTMLElement>(".force-update-card");
      return {
        overflowWrap: getComputedStyle(notes).overflowWrap,
        overflow: notes.scrollWidth - notes.clientWidth,
        pastCard: Math.round(notes.getBoundingClientRect().right - (card?.getBoundingClientRect().right ?? 0)),
      };
    });
    expect(measured).not.toBeNull();
    expect(measured!.overflowWrap).toBe("anywhere");
    expect(measured!.overflow).toBe(0);
    expect(measured!.pastCard).toBeLessThan(0);
  });
});
