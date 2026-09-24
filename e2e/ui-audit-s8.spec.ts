/**
 * S8 — gates and terminal states (docs/ui-audit-2026-09-19/PLAN.md, row S8).
 *
 * Four surfaces that either replace the whole application or stop the user
 * dead, and which nobody in the audit had looked at:
 *
 *   1. the mandatory-update page, all seven phases, both locales, and again
 *      with the legacy stylesheet injected so the layout can be judged on its
 *      own merits rather than through S0-001;
 *   2. the first-run zero-data workspace (no fixture, no folders, no files);
 *   3. the five `notBuiltYet` dead ends;
 *   4. the internal drag-and-drop feedback (private MIME, `useFolderDrop`).
 *
 * Read-only: nothing here writes to a real workspace, and the update page is
 * driven from `?forceUpdate=` which never reaches an updater.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 \
 *   OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT=test-results/s8 \
 *   npx playwright test e2e/ui-audit-s8.spec.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { capture, open } from "./ui-audit-helpers";

const SESSION = { session: "S8" };
const DIR = "docs/ui-audit-2026-09-19/S8/screenshots";

const PHASES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "error",
] as const;

/** The update page has no shell combination — it replaces the shell. */
async function shot(page: Page, name: string): Promise<string> {
  const path = `${DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

const LEGACY_CSS = readFileSync(
  resolve(process.cwd(), "src/renderer/styles/onboarding-update.css"),
  "utf8",
);

/** Everything a finding needs to quote a number about the update page. */
async function measureUpdatePage(page: Page) {
  return page.evaluate(() => {
    const pick = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        text: (element.textContent ?? "").trim().slice(0, 120),
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        fontFamily: style.fontFamily.split(",")[0],
        fontSize: style.fontSize,
        background: style.backgroundColor,
      };
    };
    return {
      overlay: pick(".force-update-overlay"),
      card: pick(".force-update-card"),
      title: pick(".force-update-title"),
      progressLabel: pick(".force-update-progress-label"),
      error: pick(".force-update-error"),
      buttons: [...document.querySelectorAll("button")].map((b) => ({
        text: (b.textContent ?? "").trim(),
        rect: {
          width: Math.round(b.getBoundingClientRect().width),
          height: Math.round(b.getBoundingClientRect().height),
        },
      })),
      progressBars: document.querySelectorAll('.od-progress, [role="progressbar"]').length,
      // The shell's self-drawn traffic lights live in WindowBar; the overlay
      // replaces the shell, so this is how many ways out of the window remain.
      windowControls: document.querySelectorAll(
        ".shell-window-close, .shell-window-minimize, .shell-window-fullscreen",
      ).length,
      shellRoots: document.querySelectorAll("#shell").length,
      bodyOverflow: getComputedStyle(document.body).overflow,
      documentText: (document.body.textContent ?? "").replace(/\s+/g, " ").trim(),
    };
  });
}

/* ------------------------------------------------------- 1. update page */

test.describe("S8-1 mandatory update page", () => {
  test("renders all seven phases (unstyled, as shipped)", async ({ page }) => {
    const report: Record<string, unknown> = {};
    for (const phase of PHASES) {
      await page.goto(`/?forceUpdate=${phase}`);
      await expect(page.locator(".force-update-card")).toBeVisible();
      report[phase] = {
        shot: await shot(page, `GATE-${phase}`),
        ...(await measureUpdatePage(page)),
      };
    }
    console.log("S8-1 phases (as shipped):\n" + JSON.stringify(report, null, 2));
  });

  test("renders the phases with the legacy stylesheet injected", async ({ page }) => {
    const report: Record<string, unknown> = {};
    for (const phase of PHASES) {
      await page.goto(`/?forceUpdate=${phase}`);
      await page.addStyleTag({ content: LEGACY_CSS });
      await expect(page.locator(".force-update-card")).toBeVisible();
      report[phase] = {
        shot: await shot(page, `GATE-${phase}-styled`),
        ...(await measureUpdatePage(page)),
      };
    }
    console.log("S8-1 phases (legacy CSS injected):\n" + JSON.stringify(report, null, 2));
  });

  test("release notes are server text with no wrapping guard", async ({ page }) => {
    // `.force-update-reason` and `.force-update-error` both set
    // `overflow-wrap: anywhere`; `.force-update-notes` does not. The notes
    // string comes from the release feed, so it is the one block on this page
    // whose content nobody in this repo controls.
    await page.goto("/?forceUpdate=available");
    await page.addStyleTag({ content: LEGACY_CSS });
    await expect(page.locator(".force-update-card")).toBeVisible();
    const measure = await page.evaluate(() => {
      const notes = document.querySelector(".force-update-notes") as HTMLElement;
      const card = document.querySelector(".force-update-card") as HTMLElement;
      const before = {
        notesWrap: getComputedStyle(notes).overflowWrap,
        reasonWrap: getComputedStyle(document.querySelector(".force-update-reason")!).overflowWrap,
        errorRuleExists: true,
      };
      notes.textContent =
        "https://download.officedex.example.com/releases/1.4.0/OfficeDex-1.4.0-darwin-arm64-signed-notarized-stapled.dmg";
      const notesRect = notes.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return {
        ...before,
        overflowPx: Math.round(notesRect.right - cardRect.right),
        scrollVsClient: notes.scrollWidth - notes.clientWidth,
        cardWidth: Math.round(cardRect.width),
        notesScrollWidth: notes.scrollWidth,
      };
    });
    const shotPath = await shot(page, "GATE-available-styled-longnotes");
    console.log("S8-1 notes wrapping:\n" + JSON.stringify({ shot: shotPath, ...measure }, null, 2));
  });

  test("narrow viewport, styled", async ({ page }) => {    await page.setViewportSize({ width: 600, height: 420 });
    await page.goto("/?forceUpdate=error");
    await page.addStyleTag({ content: LEGACY_CSS });
    await expect(page.locator(".force-update-card")).toBeVisible();
    const shotPath = await shot(page, "GATE-error-styled-600x420");
    console.log(
      "S8-1 narrow:\n" +
        JSON.stringify({ shot: shotPath, ...(await measureUpdatePage(page)) }, null, 2),
    );
  });
});

test.describe("S8-1b mandatory update page in a Chinese locale", () => {
  test.use({ locale: "zh-CN" });

  test("update page follows navigator.language while the shell does not", async ({ page }) => {
    const report: Record<string, unknown> = {};
    for (const phase of ["available", "downloading", "error"] as const) {
      await page.goto(`/?forceUpdate=${phase}`);
      await page.addStyleTag({ content: LEGACY_CSS });
      await expect(page.locator(".force-update-card")).toBeVisible();
      report[phase] = {
        shot: await shot(page, `GATE-${phase}-zhCN-styled`),
        ...(await measureUpdatePage(page)),
      };
    }

    // The contrast the plan asks for: same machine, same locale, English shell.
    await open(page, "C1", SESSION);
    await capture(page, "C1", "S8-shell-under-zhCN-locale", SESSION);
    report.shell = await page.evaluate(() => ({
      navigatorLanguage: navigator.language,
      sidebarText: (document.querySelector(".shell-sidebar")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim(),
      cjkStringsInShellChrome: [...document.querySelectorAll(".shell-sidebar, .shell-windowbar")]
        .map((n) => n.textContent ?? "")
        .join(" ")
        .match(/[一-鿿]+/g)?.length ?? 0,
    }));
    console.log("S8-1b zh-CN:\n" + JSON.stringify(report, null, 2));
  });
});

/* -------------------------------------------------- 2. first-run, empty */

test.describe("S8-2 first launch, zero data", () => {
  test("the empty workspace a new user actually lands on", async ({ page }) => {
    // No ?shellFixture: this is the browser-preview port, an explicitly empty
    // workspace — the same shape a first launch has.
    await page.goto("/");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
    const shotPath = await shot(page, "C1-S8-first-run-empty");

    const measure = await page.evaluate(() => {
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const controls = [...document.querySelectorAll("button, a[href], input, select, textarea")]
        .filter(visible)
        .filter((element) => getComputedStyle(element).visibility !== "hidden")
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: element.className,
          label:
            (element.getAttribute("aria-label") ||
              element.getAttribute("title") ||
              element.textContent ||
              "").replace(/\s+/g, " ").trim().slice(0, 60),
        }));
      const text = (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        shellState: {
          mode: document.querySelector("#shell")?.getAttribute("data-mode"),
          home: document.querySelector("#shell")?.getAttribute("data-home"),
          navCollapsed: document.querySelector("#shell")?.getAttribute("data-nav-collapsed"),
        },
        controlCount: controls.length,
        controls,
        creationAffordances: controls
          .map((c) => c.label)
          .filter((label) => /new |create|open|blank|import|add file/i.test(label)),
        emptyStates: [...document.querySelectorAll(".shell-list-empty, .shell-tree-empty")].map(
          (n) => (n.textContent ?? "").replace(/\s+/g, " ").trim(),
        ),
        tabCount: document.querySelectorAll('[role="tab"], .shell-tab').length,
        folderRows: document.querySelectorAll(".shell-tree-folder-row").length,
        taskRows: document.querySelectorAll(".shell-task, .shell-task-row").length,
        onboardingMarkers: /get started|welcome|take a tour|onboard|first|step 1/i.test(text),
        bodyText: text.slice(0, 1200),
      };
    });
    console.log("S8-2 first run:\n" + JSON.stringify({ shot: shotPath, ...measure }, null, 2));

    // Expanded sidebar too — the same zero state with the tree visible.
    await page.goto("/?nav=expanded");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
    const expandedShot = await shot(page, "C2-S8-first-run-empty-expanded");
    const expanded = await page.evaluate(() => {
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
      };
      return {
        folderRows: document.querySelectorAll(".shell-tree-folder-row").length,
        sidebarText: (document.querySelector(".shell-sidebar")?.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        // The empty state tells the user to "Create a file, or open one from
        // this computer" — so: which visible control does either of those?
        creationAffordances: [...document.querySelectorAll("button")]
          .filter(visible)
          .map((b) =>
            (b.getAttribute("aria-label") || b.textContent || "").replace(/\s+/g, " ").trim(),
          )
          .filter((label) =>
            /new |create|open|blank|import|add file/i.test(label),
          ),
      };
    });
    console.log(
      "S8-2 first run expanded:\n" + JSON.stringify({ shot: expandedShot, ...expanded }, null, 2),
    );

    // Editor mode's first launch is a different page again.
    await page.goto("/?mode=editor&home=1&nav=expanded");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
    const editorShot = await shot(page, "C4-S8-first-run-empty-editor");
    const editor = await page.evaluate(() => ({
      emptyStates: [...document.querySelectorAll(".shell-list-empty")].map((n) =>
        (n.textContent ?? "").replace(/\s+/g, " ").trim(),
      ),
      actions: [...document.querySelectorAll(".shell-home-new")].map((n) =>
        (n.textContent ?? "").trim(),
      ),
    }));
    console.log(
      "S8-2 first run editor:\n" + JSON.stringify({ shot: editorShot, ...editor }, null, 2),
    );
  });
});

/* ------------------------------------------------------- 3. dead ends */

/** What the toast says, where it is, and what it is sitting on top of. */
async function measureToast(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector(".od-toast-host");
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const covered = document
      .elementsFromPoint(cx, cy)
      .map((n) => `${n.tagName.toLowerCase()}.${(n.className || "").toString().split(" ")[0]}`);
    return {
      text: (host.textContent ?? "").replace(/\s+/g, " ").trim(),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      position: style.position,
      zIndex: style.zIndex,
      /** DOM stack under the toast's centre, toast first. */
      stackUnderCentre: covered,
      /** Anything the toast overlaps, by selector, measured not guessed. */
      overlaps: [" "].length
        ? [".shell-tabs", ".shell-windowbar", ".shell-share", ".shell-menu", ".shell-sidebar"]
            .map((selector) => {
              const target = document.querySelector(selector);
              if (!target) return { selector, present: false };
              const box = target.getBoundingClientRect();
              const overlap =
                rect.left < box.right &&
                rect.right > box.left &&
                rect.top < box.bottom &&
                rect.bottom > box.top;
              return {
                selector,
                present: true,
                overlap,
                overlapPx: overlap
                  ? Math.round(
                      (Math.min(rect.right, box.right) - Math.max(rect.left, box.left)) *
                        (Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top)),
                    )
                  : 0,
                targetZIndex: getComputedStyle(target).zIndex,
              };
            })
        : [],
    };
  });
}

async function clearToasts(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll(".od-toast__close").forEach((b) => (b as HTMLElement).click());
  });
  await page.waitForTimeout(150);
}

test.describe("S8-3 the five notBuiltYet dead ends", () => {
  test("home highlights video card", async ({ page }) => {
    await open(page, "C2", SESSION);
    const card = page.locator(".shell-highlight-card").first();
    await expect(card).toBeVisible();
    const cardBox = await card.boundingBox();
    await card.click();
    await expect(page.locator(".od-toast-host")).toBeVisible();
    const shotPath = await capture(page, "C2", "S8-deadend-highlights", SESSION);
    console.log(
      "S8-3 highlights:\n" +
        JSON.stringify({ shot: shotPath, cardBox, toast: await measureToast(page) }, null, 2),
    );
  });

  test("composer dictation", async ({ page }) => {
    // Chromium ships webkitSpeechRecognition, so the fallback branch
    // (Composer.tsx:449) only runs where it is absent — every Wails webview on
    // Linux/Windows, and Safari-derived webviews without the permission.
    await open(page, "C2", SESSION);
    const nativeSupport = await page.evaluate(
      () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    );

    await page.addInitScript(() => {
      // @ts-expect-error deliberately removing the API to reach the branch
      delete window.SpeechRecognition;
      // @ts-expect-error same
      delete window.webkitSpeechRecognition;
    });
    await open(page, "C2", SESSION);
    const mic = page.locator(".shell-cx-mic").first();
    await expect(mic).toBeVisible();
    await mic.click();
    await expect(page.locator(".od-toast-host")).toBeVisible();
    const shotPath = await capture(page, "C2", "S8-deadend-dictate", SESSION);
    console.log(
      "S8-3 dictate:\n" +
        JSON.stringify(
          { shot: shotPath, nativeSupport, toast: await measureToast(page) },
          null,
          2,
        ),
    );
  });

  test("composer permission tiers", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.locator(".shell-cx-permission").first().click();
    const menu = page.locator(".shell-menu").first();
    await expect(menu).toBeVisible();
    const menuBefore = await menu.boundingBox();
    const items = await menu.locator("[role='menuitem'], button").allTextContents();
    await page.getByText("Review changes", { exact: false }).first().click();
    await expect(page.locator(".od-toast-host")).toBeVisible();
    const shotPath = await capture(page, "C2", "S8-deadend-permission-review", SESSION);
    const toast = await measureToast(page);
    const menuStillOpen = await page.locator(".shell-menu").count();
    console.log(
      "S8-3 permission:\n" +
        JSON.stringify({ shot: shotPath, menuBefore, items, menuStillOpen, toast }, null, 2),
    );

    // The tier the button now claims, after pressing a tier that does nothing.
    const buttonLabel = await page.locator(".shell-cx-permission").first().textContent();
    console.log("S8-3 permission button after press: " + JSON.stringify(buttonLabel));

    // The same call site serves a second dead row: Custom (Composer.tsx:68,
    // available:false). So "five notBuiltYet sites" is six dead controls.
    await clearToasts(page);
    await page.locator(".shell-cx-permission").first().click();
    await expect(page.locator(".shell-menu").first()).toBeVisible();
    await page.getByText("Custom", { exact: false }).first().click();
    await expect(page.locator(".od-toast-host")).toBeVisible();
    const customShot = await capture(page, "C2", "S8-deadend-permission-custom", SESSION);
    console.log(
      "S8-3 permission custom:\n" +
        JSON.stringify({ shot: customShot, toast: await measureToast(page) }, null, 2),
    );
  });

  test("file tabs share, with and without an open file", async ({ page }) => {
    // On Home the whole file-action group is visibility:hidden (chrome.css:334)
    // whose comment claims it stays reachable for the keyboard. Check that.
    await page.goto("/");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
    const hiddenOnHome = await page.evaluate(() => {
      const share = document.querySelector(".shell-share") as HTMLElement | null;
      if (!share) return null;
      const style = getComputedStyle(share);
      const rect = share.getBoundingClientRect();
      share.focus();
      return {
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
        rect: { width: Math.round(rect.width), height: Math.round(rect.height) },
        focusable: document.activeElement === share,
        inTabOrder: share.tabIndex >= 0 && style.visibility !== "hidden",
      };
    });
    console.log("S8-3 share on Home:\n" + JSON.stringify(hiddenOnHome, null, 2));

    // Off Home with an empty workspace the button is visible and has no file:
    // the pure dead end.
    await page.goto("/?home=0");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
    const share = page.locator(".shell-share").first();
    const sharePresent = await share.count();
    let noFile: unknown = null;
    if (sharePresent) {
      await share.click();
      await expect(page.locator(".od-toast-host")).toBeVisible();
      noFile = { shot: await shot(page, "C5-S8-deadend-share-nofile"), toast: await measureToast(page) };
    }
    console.log("S8-3 share (no file):\n" + JSON.stringify({ sharePresent, noFile }, null, 2));

    // With a file open it takes a different branch entirely (clipboard).
    // Home hides the whole action group, so this has to be an off-Home shell.
    await open(page, "C6", SESSION);
    await page.locator(".shell-share").first().click();
    await page.waitForTimeout(300);
    const shotPath = await capture(page, "C6", "S8-share-withfile", SESSION);
    console.log(
      "S8-3 share (file open):\n" +
        JSON.stringify({ shot: shotPath, toast: await measureToast(page) }, null, 2),
    );
  });

  test("sidebar settings led to a dead end; it now leads to a page", async ({ page }) => {
    for (const combination of ["C1", "C2"] as const) {
      await open(page, combination, SESSION);
      /*
       * S8 recorded a dead end here: the gear opened a three-row dropdown, and
       * its "Review changes" row only ever raised a "not available yet" toast —
       * the shell's sole settings door, with three rows behind it, two of which
       * duplicated the composer.
       *
       * The dropdown is gone and the gear opens the settings page, so what is
       * measured now is that the dead end is absent: no menu opens, and no such
       * row exists on the page that opens in its place. The tier itself still
       * exists, in the composer's permission menu — the test above measures it.
       */
      await page.locator('.shell-sidebar-footer button[aria-label="Settings"]').click();
      await expect(page.locator(".shell-settings")).toBeVisible();
      const menuCount = await page.locator(".shell-menu").count();
      const reviewRows = await page.getByText("Review changes", { exact: false }).count();
      const sections = await page.locator(".shell-settings-nav-label").allTextContents();
      const openShot = await capture(page, combination, "S8-settings-page-open", SESSION);
      console.log(
        `S8-3 sidebar settings ${combination}:\n` +
          JSON.stringify({ openShot, menuCount, reviewRows, sections }, null, 2),
      );
      await page.keyboard.press("Escape");
      await expect(page.locator(".shell-settings")).toHaveCount(0);
    }
  });
});

/* ---------------------------------------------------- 4. internal drag */

/**
 * HTML5 drag-and-drop cannot be driven by Playwright's mouse, so the events are
 * synthesised with one shared DataTransfer — which is exactly what the browser
 * does, and what `useFolderDrop` reads.
 */
const DRAG_SCRIPT = `
  window.__s8 = {
    dt: null,
    start(selector) {
      const source = document.querySelector(selector);
      if (!source) return { ok: false, why: "no source " + selector };
      this.dt = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: this.dt }));
      return { ok: true, sourceClass: source.className, payload: this.dt.getData("application/x-officedex-file") };
    },
    over(selector) {
      const target = document.querySelector(selector);
      if (!target) return { ok: false, why: "no target " + selector };
      const rect = target.getBoundingClientRect();
      const event = new DragEvent("dragover", {
        bubbles: true, cancelable: true, dataTransfer: this.dt,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      });
      target.dispatchEvent(event);
      return {
        ok: true,
        defaultPrevented: event.defaultPrevented,
        dropEffect: this.dt.dropEffect,
        targetRect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
      };
    },
    drop(selector) {
      const target = document.querySelector(selector);
      if (!target) return { ok: false, why: "no target " + selector };
      const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: this.dt });
      target.dispatchEvent(event);
      return { ok: true, defaultPrevented: event.defaultPrevented };
    },
    leave(selector, outsideSelector) {
      const target = document.querySelector(selector);
      const outside = document.querySelector(outsideSelector);
      if (!target) return { ok: false, why: "no target " + selector };
      const event = new DragEvent("dragleave", { bubbles: true, cancelable: true, dataTransfer: this.dt, relatedTarget: outside });
      target.dispatchEvent(event);
      return { ok: true };
    },
    highlights() {
      return {
        dropTargets: [...document.querySelectorAll(".is-drop-target")].map((n) => ({
          className: n.className,
          folder: n.getAttribute("data-drop-folder"),
          outline: getComputedStyle(n).outlineColor + " " + getComputedStyle(n).outlineWidth,
          background: getComputedStyle(n).backgroundColor,
        })),
        draggingMarkers: document.querySelectorAll(".is-dragging, [data-dragging]").length,
      };
    },
  };
`;

test.describe("S8-4 internal drag and drop", () => {
  test("the collapsed rail (C1/C5/C7) has no tree to drag in or onto", async ({ page }) => {
    const report: Record<string, unknown> = {};
    for (const combination of ["C1", "C5", "C7"] as const) {
      await open(page, combination, SESSION);
      report[combination] = await page.evaluate(() => {
        const tree = document.querySelector(".shell-sidebar-tree");
        const body = document.querySelector(".shell-sidebar-body");
        return {
          treeInDom: Boolean(tree),
          treeRect: tree
            ? {
                width: Math.round(tree.getBoundingClientRect().width),
                height: Math.round(tree.getBoundingClientRect().height),
              }
            : null,
          bodyDisplay: body ? getComputedStyle(body).display : null,
          dropTargetsInDom: document.querySelectorAll("[data-drop-folder]").length,
          draggableRows: document.querySelectorAll("[draggable='true']").length,
        };
      });
      await capture(page, combination, "S8-collapsed-no-drop-targets", SESSION);
    }
    console.log("S8-4 collapsed rail:\n" + JSON.stringify(report, null, 2));
  });

  test("sidebar tree: valid folder, file row, empty folder, outside", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.addScriptTag({ content: DRAG_SCRIPT });

    const report: Record<string, unknown> = {};

    // Geometry first: how much of an expanded folder actually accepts a drop.
    report.geometry = await page.evaluate(() => {
      const sections = [...document.querySelectorAll(".shell-tree-folder")];
      return sections.map((section) => {
        const row = section.querySelector(".shell-tree-folder-row");
        const sectionRect = section.getBoundingClientRect();
        const rowRect = row?.getBoundingClientRect();
        return {
          label: (row?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
          folderId: row?.getAttribute("data-drop-folder") ?? null,
          sectionHeight: Math.round(sectionRect.height),
          rowHeight: rowRect ? Math.round(rowRect.height) : 0,
          droppableShare: rowRect && sectionRect.height
            ? Number((rowRect.height / sectionRect.height).toFixed(3))
            : null,
        };
      });
    });

    const startRes = await page.evaluate(() => window.__s8.start(".shell-tree-file-row"));
    report.dragstart = startRes;
    report.afterDragStart = await page.evaluate(() => window.__s8.highlights());
    await shot(page, "C2-S8-drag-start-no-source-feedback");

    // (a) a real folder row — the one place a drop is accepted
    report.overFolderRow = await page.evaluate(() =>
      window.__s8.over('.shell-tree-folder-row[data-drop-folder="folder-bulk"]'),
    );
    report.overFolderRowHighlights = await page.evaluate(() => window.__s8.highlights());
    await shot(page, "C2-S8-drag-over-folder-row");

    // (b) the file area *inside* an expanded folder — same folder, visually
    //     the same target to a user, but closest() finds no data-drop-folder
    report.overFilesArea = await page.evaluate(() => window.__s8.over(".shell-tree-files"));
    report.overFilesAreaHighlights = await page.evaluate(() => window.__s8.highlights());
    await shot(page, "C2-S8-drag-over-files-area");

    // (c) the empty folder, yirentk
    report.overEmptyFolder = await page.evaluate(() =>
      window.__s8.over('.shell-tree-folder-row[data-drop-folder="folder-empty"]'),
    );
    report.overEmptyFolderHighlights = await page.evaluate(() => window.__s8.highlights());
    await shot(page, "C2-S8-drag-over-empty-folder");

    // (d) outside the sidebar entirely. Two steps, as a real pointer does it:
    //     dragover somewhere else, then the dragleave the browser fires on the
    //     container it just left.
    report.overOutside = await page.evaluate(() => window.__s8.over(".shell-home, main, body"));
    report.overOutsideHighlightsBeforeLeave = await page.evaluate(() =>
      window.__s8.highlights(),
    );
    report.leave = await page.evaluate(() =>
      window.__s8.leave(".shell-sidebar-tree", ".shell-home"),
    );
    report.overOutsideHighlights = await page.evaluate(() => window.__s8.highlights());
    await shot(page, "C2-S8-drag-outside-sidebar");

    // (e) can a folder below the fold even be reached while dragging?
    report.scroll = await page.evaluate(() => {
      const body = document.querySelector(".shell-sidebar-body");
      if (!body) return null;
      return {
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        offscreenPx: body.scrollHeight - body.clientHeight,
        foldersBelowFold: [...document.querySelectorAll(".shell-tree-folder-row")].filter(
          (n) => n.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom,
        ).length,
      };
    });

    console.log("S8-4 sidebar drag:\n" + JSON.stringify(report, null, 2));
  });

  test("home comfortable list: folder grouping accepts drops but shows nothing", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.addScriptTag({ content: DRAG_SCRIPT });
    const report: Record<string, unknown> = {};

    report.dragstart = await page.evaluate(() =>
      window.__s8.start(".shell-home-list tbody tr[draggable]"),
    );
    report.overGroup = await page.evaluate(() =>
      window.__s8.over('.shell-home-list tbody[data-drop-folder="folder-bulk"] .shell-list-group'),
    );
    report.highlights = await page.evaluate(() => window.__s8.highlights());
    report.cssRuleForComfortable = await page.evaluate(() => {
      const tbody = document.querySelector('.shell-home-list tbody[data-drop-folder]');
      if (!tbody) return null;
      const style = getComputedStyle(tbody);
      return { className: tbody.className, outline: style.outline, background: style.backgroundColor };
    });
    await shot(page, "C2-S8-drag-home-list-no-highlight");

    console.log("S8-4 home list drag:\n" + JSON.stringify(report, null, 2));
  });

  test("editor home: time grouping has no droppable target at all", async ({ page }) => {
    await open(page, "C4", SESSION);
    await page.addScriptTag({ content: DRAG_SCRIPT });
    const report: Record<string, unknown> = {};

    report.groupHeadings = await page.evaluate(() =>
      [...document.querySelectorAll(".shell-list-group")].map((n) =>
        (n.textContent ?? "").replace(/\s+/g, " ").trim(),
      ),
    );
    report.droppableTbodies = await page.evaluate(
      () => document.querySelectorAll("tbody[data-drop-folder]").length,
    );
    report.totalTbodies = await page.evaluate(
      () => document.querySelectorAll(".shell-home-list tbody").length,
    );
    report.dragstart = await page.evaluate(() =>
      window.__s8.start(".shell-home-list tbody tr[draggable]"),
    );
    report.overTimeBucket = await page.evaluate(() =>
      window.__s8.over(".shell-home-list tbody .shell-list-group"),
    );
    report.highlights = await page.evaluate(() => window.__s8.highlights());
    await shot(page, "C4-S8-drag-editorhome-time-bucket");

    console.log("S8-4 editor home drag:\n" + JSON.stringify(report, null, 2));
  });
});

declare global {
  interface Window {
    __s8: {
      start(selector: string): { ok: boolean; why?: string; sourceClass?: string; payload?: string };
      over(selector: string): {
        ok: boolean;
        why?: string;
        defaultPrevented?: boolean;
        dropEffect?: string;
        targetRect?: { left: number; top: number; width: number; height: number };
      };
      drop(selector: string): { ok: boolean; why?: string; defaultPrevented?: boolean };
      leave(selector: string, outsideSelector: string): { ok: boolean; why?: string };
      highlights(): { dropTargets: unknown[]; draggingMarkers: number };
    };
  }
}
