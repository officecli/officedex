/**
 * W3-I — the shell renders the values OD-UI-1.2 (r10) says it renders.
 *
 * This file used to be a computed-style snapshot: it walked the CSSOM of every
 * `src/shell` stylesheet, fingerprinted every element under `#shell` in all ten
 * combinations, and compared the lot against
 * `docs/ui-audit-2026-09-19/fixes/W3-I/baseline.json` — ~10,000 readings recorded
 * on a checkout of `4a716ea`. That was the right instrument for the track it was
 * written for, which moved bare colour literals into `--shell-*` tokens and
 * therefore had to prove that nothing on screen moved.
 *
 * It is the wrong instrument now. The shell was rebuilt to r10: the token table
 * is `--dx-*`, the class names are `dx-*`, and the surfaces the baseline
 * fingerprinted (`.shell-presence-panel`, `.shell-tree`, `.shell-window-controls`,
 * `.shell-hero`, the mode menu) do not exist. Re-recording the baseline against
 * whatever r10 happens to render would turn a gate into a photograph: it would
 * agree with the shell by construction and could never disagree with the design.
 *
 * So the values are asserted against their source instead. Every number below is
 * either in the design standard's own tables — §03 layout, §04 type, §05 colour,
 * outlines, radii and elevation — or is a literal the approved prototype carries
 * and `src/shell/tokens.css` names. Where the two differ the comment says which
 * one the assertion follows and why.
 *
 * Light theme only, deliberately. §05: "深色、高对比度是独立主题验收任务；本包只给
 * 浅色执行值" — dark is a separate design and QA task, so `tokens.css` carries the
 * prototype's dark values across without claiming they have been checked. The
 * fixture opens light; the first test states that, so a default flipping to dark
 * fails here rather than quietly rebasing every colour in the file.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w3i.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

import { CHAT_MAX_WIDTH, CHAT_MIN_WIDTH } from "../src/shell/state/shellReducer";
import { box, open } from "./r10-c-helpers";

/**
 * §05's light semantic palette, as the standard's table writes it.
 *
 * Keyed by the token `tokens.css` gives each row. Custom properties have no
 * computed form worth comparing — the browser hands back the authored text — so
 * these are compared as the lowercase hex the table lists.
 */
const PALETTE: Record<string, string> = {
  "--dx-text": "#343a40", // color.text
  "--dx-muted": "#626e79", // color.textSecondary
  "--dx-surface": "#ffffff", // color.surface
  "--dx-canvas": "#f5f6f8", // color.canvas
  "--dx-line": "#d9dfe4", // color.borderSubtle
  "--dx-control": "#7b8794", // color.borderControl
  "--dx-hover": "#eceff2", // color.hover
  "--dx-selected": "#e4e9ee", // color.selected
  "--dx-pressed": "#d9e0e6", // color.pressed
  "--dx-focus": "#526f89", // color.focus
  "--dx-blue": "#2768c9", // color.unread
  "--dx-success": "#2e6b4f", // color.success
  "--dx-warning": "#8a5a17", // color.warning
  "--dx-error": "#a43d37", // color.error
};

/** The same values as the browser reports them once they have been painted. */
const RGB = {
  text: "rgb(52, 58, 64)",
  muted: "rgb(98, 110, 121)",
  surface: "rgb(255, 255, 255)",
  canvas: "rgb(245, 246, 248)",
  line: "rgb(217, 223, 228)",
  hover: "rgb(236, 239, 242)",
  selected: "rgb(228, 233, 238)",
  focus: "rgb(82, 111, 137)",
} as const;

/**
 * §04's adopted type scale: size / line-height / weight.
 *
 * The standard names ten roles over seven size steps; these are the seven, and
 * every assertion below cites the role rather than the pixel count, because the
 * point of a scale is that a surface picks a role.
 */
const TYPE = {
  metadata: { fontSize: "12px", lineHeight: "18px", fontWeight: "400" },
  body: { fontSize: "14px", lineHeight: "20px", fontWeight: "400" },
  helper: { fontSize: "14px", lineHeight: "20px", fontWeight: "400" },
  reading: { fontSize: "16px", lineHeight: "24px", fontWeight: "400" },
  section: { fontSize: "16px", lineHeight: "24px", fontWeight: "600" },
  settingsSection: { fontSize: "20px", lineHeight: "28px", fontWeight: "600" },
  title: { fontSize: "22px", lineHeight: "30px", fontWeight: "600" },
  hero: { fontSize: "28px", lineHeight: "36px", fontWeight: "600" },
} as const;

type Type = keyof typeof TYPE;

/** The properties of one element, read from the cascade that actually paints it. */
async function styleOf(page: Page, selector: string, props: readonly string[]) {
  const value = await page.evaluate(
    ({ target, names }: { target: string; names: readonly string[] }) => {
      const node = document.querySelector(target);
      if (!node) return null;
      const style = getComputedStyle(node);
      const out: Record<string, string> = {};
      for (const name of names) out[name] = style.getPropertyValue(name);
      return out;
    },
    { target: selector, names: props },
  );
  expect(value, `${selector} is not in the DOM`).not.toBeNull();
  return value!;
}

/** Asserts `selector` renders one of §04's roles, naming the role on failure. */
async function expectType(page: Page, selector: string, role: Type) {
  const want = TYPE[role];
  const got = await styleOf(page, selector, ["font-size", "line-height", "font-weight"]);
  expect(
    { fontSize: got["font-size"], lineHeight: got["line-height"], fontWeight: got["font-weight"] },
    `${selector} should be §04 type.${role}`,
  ).toEqual(want);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  /*
   * The first-run usage notice is a `role="status"` panel in the bottom-right
   * corner, and a fresh browser context has never seen it. It lies over the Dex
   * bubble, which two tests below have to reach, so it is acknowledged the way a
   * returning user's storage would have it.
   */
  await page.addInitScript(() => {
    try {
      localStorage.setItem("officedex:usage-notice:v2", new Date().toISOString());
    } catch {
      // A context that cannot write storage will just show the notice.
    }
  });
});

test.describe("OD-UI-1.2 tokens", () => {
  test("the fixture shell is the light theme the standard scopes this acceptance to", async ({ page }) => {
    await open(page, "C1");
    await expect(page.locator("#shell")).toHaveAttribute("data-theme", "light");
    // The dark block is scoped to `[data-theme="dark"]`, so nothing in it is in
    // play here. Said out loud because every colour below depends on it.
    const scheme = await styleOf(page, "#shell", ["color-scheme"]);
    expect(scheme["color-scheme"]).not.toBe("dark");
  });

  test("`#shell` declares §05's light semantic palette, value for value", async ({ page }) => {
    await open(page, "C1");
    const declared = await page.evaluate((names: string[]) => {
      const style = getComputedStyle(document.querySelector("#shell")!);
      const out: Record<string, string> = {};
      for (const name of names) out[name] = style.getPropertyValue(name).trim().toLowerCase();
      return out;
    }, Object.keys(PALETTE));
    expect(declared).toEqual(PALETTE);
  });

  test("§04's type roles reach the surfaces that use them", async ({ page }) => {
    await open(page, "C1");
    // type.hero — "首页唯一主标题", the one hero heading in the product.
    await expectType(page, ".dx-home h1", "hero");
    // type.section — a page's small division.
    await expectType(page, ".dx-home-section .dx-section-heading h2", "section");
    // type.body — file names and table content.
    await expectType(page, ".dx-home-recent tbody td", "body");
    await expectType(page, "#dx-sidebar .dx-nav-item", "body");
    // type.metadata — time, format, non-critical notes.
    await expectType(page, ".dx-home-recent td.dx-metadata", "metadata");
    // type.reading — the composer's own input.
    await expectType(page, ".dx-composer textarea", "reading");

    await open(page, "C3");
    // type.title — a page's title.
    await expectType(page, ".dx-local-page > .dx-page-header h1", "title");

    await open(page, "C10");
    await expectType(page, ".dx-page-header h1", "title");
    // type.settingsSection — the one role with a size of its own.
    await expectType(page, ".dx-settings-content h2", "settingsSection");
    // type.helper — a row's one sentence of explanation.
    await expectType(page, ".dx-setting-row p", "helper");
  });

  test("the Logo tab is the only 13px word mark (§04, WORKSPACE-STANDARD §02)", async ({ page }) => {
    await open(page, "C1");
    // 13 is deliberately outside the adopted scale: the standard gives it to the
    // Logo tab and to nothing else, so it is asserted by name rather than as a
    // role.
    const tab = await styleOf(page, "#dx-global-controls .dx-home-tab", ["font-size", "line-height"]);
    expect(tab).toEqual({ "font-size": "13px", "line-height": "20px" });
  });

  test("§05's radii: control 6, card and menu 8, dialog 12, composer 24, document tab 10", async ({ page }) => {
    await open(page, "C1");

    // composer 24
    const composer = await styleOf(page, ".dx-composer", ["border-radius"]);
    expect(composer["border-radius"]).toBe("24px");

    // control 6 — "需要明确边界的输入框与控件" wear the same step.
    const search = await styleOf(page, "#dx-sidebar .dx-nav-item", ["border-radius"]);
    expect(search["border-radius"]).toBe("6px");

    // menu 8, plus §05's popover elevation: 0 8px 28px rgba(23,33,43,.14).
    await page.locator(".dx-home-recent [data-act=file-menu]").first().click();
    const menu = page.locator("#dx-layers .dx-menu");
    await expect(menu).toBeVisible();
    const menuStyle = await styleOf(page, "#dx-layers .dx-menu", [
      "border-radius",
      "background-color",
      "box-shadow",
    ]);
    expect(menuStyle["border-radius"]).toBe("8px");
    expect(menuStyle["background-color"]).toBe(RGB.surface);
    expect(menuStyle["box-shadow"]).toBe("rgba(23, 33, 43, 0.14) 0px 8px 28px 0px");
    // §04: menu rows are type.reading.
    await expectType(page, "#dx-layers .dx-menu button", "reading");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    /*
     * Application dialog 12, §05's modal elevation 0 16px 48px rgba(23,33,43,.20)
     * and its 24% black backdrop. jsdom has no `showModal`, but a real browser
     * does, so `::backdrop` is readable here and is the only place it is.
     */
    await page.locator(".dx-highlight").first().click();
    const modal = page.locator("#dx-modal");
    await expect(modal).toBeVisible();
    const modalStyle = await styleOf(page, "#dx-modal", ["border-radius", "box-shadow"]);
    expect(modalStyle["border-radius"]).toBe("12px");
    expect(modalStyle["box-shadow"]).toBe("rgba(23, 33, 43, 0.2) 0px 16px 48px 0px");
    const backdrop = await page.evaluate(
      () => getComputedStyle(document.querySelector("#dx-modal")!, "::backdrop").backgroundColor,
    );
    expect(backdrop).toBe("rgba(0, 0, 0, 0.24)");

    await open(page, "C9");
    // Document tab 10, from the Codex reference §05 names: 40px row, 32px tab.
    const tab = await styleOf(page, ".dx-file-tab", ["border-radius", "height"]);
    expect(tab).toEqual({ "border-radius": "10px", height: "32px" });
  });

  test("§03's frame: 244 sidebar, 360 conversation inside 320–520, 40px top rows", async ({ page }) => {
    await open(page, "C5");

    // "左侧展开宽度 | 固定 244，不可拖宽" and the 244px band above it, which
    // stays put whether or not the sidebar is showing (WORKSPACE-STANDARD §02).
    expect((await styleOf(page, "#dx-sidebar", ["width"]))["width"]).toBe("244px");
    expect((await styleOf(page, "#dx-global-controls", ["width", "height"]))).toEqual({
      width: "244px",
      height: "40px",
    });

    // "对话栏 | 默认 360，范围 320–520".
    expect((await styleOf(page, "#dx-conversation", ["width"]))["width"]).toBe("360px");

    // "外层顶部对齐行 | 40；页签本体 32 | 各栏各自顶行对齐，不新增横跨全窗的一条顶栏":
    // each column carries its own 40px row, and no element spans the window.
    expect((await styleOf(page, "#dx-conversation > .dx-pane-top", ["height"]))["height"]).toBe("40px");
    expect((await styleOf(page, "#dx-content > .dx-tabs-strip", ["height"]))["height"]).toBe("40px");
    const band = await box(page, "#dx-global-controls");
    const pane = await box(page, "#dx-conversation > .dx-pane-top");
    const strip = await box(page, "#dx-content > .dx-tabs-strip");
    expect(band!.right, "the top-left band stops at 244").toBeLessThanOrEqual(245);
    expect(pane!.left, "the conversation's top row starts where the band ends").toBeGreaterThanOrEqual(
      band!.right - 0.5,
    );
    expect(strip!.left, "the content region's top row starts after the conversation's").toBeGreaterThanOrEqual(
      pane!.right - 0.5,
    );

    // "第二、三栏之间允许拖宽，分隔线视觉 1px" and the range, which the divider
    // publishes so assistive technology can read it.
    expect((await styleOf(page, "#dx-splitter", ["width"]))["width"]).toBe("1px");
    const handle = page.locator("#dx-splitter .dx-resize-handle");
    await expect(handle).toHaveAttribute("aria-valuemin", String(CHAT_MIN_WIDTH));
    await expect(handle).toHaveAttribute("aria-valuemax", String(CHAT_MAX_WIDTH));

    // And the range holds: a step past either limit stays at the limit.
    await handle.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowLeft");
    expect((await styleOf(page, "#dx-conversation", ["width"]))["width"]).toBe(`${CHAT_MIN_WIDTH}px`);
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    expect((await styleOf(page, "#dx-conversation", ["width"]))["width"]).toBe(`${CHAT_MAX_WIDTH}px`);
  });

  test("§03: a hidden sidebar is 0 wide, not a rail", async ({ page }) => {
    await open(page, "C2");
    // "左侧收缩宽度 | 0，完全消失". The pre-r10 shell kept a 52px rail; r10 does
    // not, and the column it lived in has to collapse for the content region to
    // get the width.
    const nav = await page.evaluate(() =>
      getComputedStyle(document.querySelector("#dx-workspace")!).getPropertyValue("--dx-nav").trim(),
    );
    expect(nav).toBe("0px");
    const content = await box(page, "#dx-content");
    expect(content!.left, "the content region starts at the window edge").toBeLessThan(1);
    // "三色窗口按钮始终保留" — the band above it does not collapse with it.
    expect((await styleOf(page, "#dx-global-controls", ["width", "height"]))).toEqual({
      width: "244px",
      height: "40px",
    });
  });

  test("BRAND-DEX §04: the Dex bubble is 42px and its panel 320 wide", async ({ page }) => {
    await open(page, "C9");
    // "尺寸保持 42px" — read from the computed box, not the client rect, because
    // the bubble carries a transform while it settles and while it is expanded.
    const bubble = await styleOf(page, ".dx-dex", ["width", "height", "border-radius"]);
    expect(bubble).toEqual({ width: "42px", height: "42px", "border-radius": "50%" });

    await page.locator(".dx-dex").click();
    const panel = page.locator(".dx-dex-panel");
    await expect(panel).toBeVisible();
    /*
     * The panel grows out of the bubble over 550ms (§"以气泡为原点550ms膨胀")
     * and interpolates its radius from the bubble's 50% on the way, so a reading
     * taken on the click is a reading of the animation. Polled rather than slept
     * for the length of it: the duration is the design's, not this test's.
     */
    await expect
      .poll(async () => (await styleOf(page, ".dx-dex-panel", ["border-radius"]))["border-radius"])
      .toBe("16px");
    expect((await styleOf(page, ".dx-dex-panel", ["width"]))["width"]).toBe("320px");

    /*
     * "实际尺寸为320px宽，默认336px高、有选区引用400px、有对话512px" — the frozen
     * 1.0 geometry (400×420/500/640) at the 0.8 ratio. The height belongs to
     * whichever of the three states is up, so the state picks the number.
     */
    const heights = { default: "336px", reference: "400px", conversation: "512px" } as const;
    const size = ((await panel.getAttribute("data-size")) ?? "default") as keyof typeof heights;
    expect(Object.keys(heights), `unknown Dex panel size "${size}"`).toContain(size);
    expect((await styleOf(page, ".dx-dex-panel", ["height"]))["height"]).toBe(heights[size]);
  });

  test("§05's colours reach the surfaces that own them", async ({ page }) => {
    await open(page, "C5");

    // color.surface — the content region and a document tab's selected block.
    expect((await styleOf(page, "#dx-content", ["background-color"]))["background-color"]).toBe(RGB.surface);
    expect((await styleOf(page, ".dx-file-tab.dx-active", ["background-color"]))["background-color"]).toBe(
      RGB.surface,
    );
    // color.canvas — "侧栏、应用背景", which in r10 is each column's top row.
    expect((await styleOf(page, "#dx-conversation > .dx-pane-top", ["background-color"]))["background-color"]).toBe(
      RGB.canvas,
    );
    expect((await styleOf(page, "#dx-content > .dx-tabs-strip", ["background-color"]))["background-color"]).toBe(
      RGB.canvas,
    );
    /*
     * The sidebar is the one surface that does not take color.canvas. #f7f7f6 is
     * the literal the approved prototype's own sidebar carries, and `tokens.css`
     * names it `--dx-sidebar` for exactly that reason ("surfaces with one
     * owner"). Recorded here as the divergence it is rather than left to be
     * discovered as a failure of the §05 table.
     */
    expect((await styleOf(page, "#dx-sidebar", ["background-color"]))["background-color"]).toBe(
      "rgb(247, 247, 246)",
    );
    // color.borderSubtle — "分隔线、装饰边框".
    expect((await styleOf(page, "#dx-splitter", ["background-color"]))["background-color"]).toBe(RGB.line);
    expect((await styleOf(page, ".dx-composer", ["border-top-color"]))["border-top-color"]).toBe(RGB.line);

    await open(page, "C3");
    // color.text on body copy, color.textSecondary on metadata. §05: secondary
    // grey is for white / canvas / hover surfaces, and a selected row's text
    // goes back to color.text — so these two are read off unselected rows.
    expect((await styleOf(page, "#dx-local-results tbody td", ["color"]))["color"]).toBe(RGB.text);
    expect((await styleOf(page, "#dx-local-results td.dx-metadata", ["color"]))["color"]).toBe(RGB.muted);
    // color.selected — "已选整行 / 当前导航". Local is the current page here.
    expect(
      (await styleOf(page, "#dx-sidebar .dx-nav-item.dx-selected", ["background-color"]))["background-color"],
    ).toBe(RGB.selected);
    // color.hover — "普通悬停", and a state only a real pointer can produce.
    await page.locator("#dx-sidebar [data-act=new-file]").hover();
    expect(
      (await styleOf(page, "#dx-sidebar [data-act=new-file]", ["background-color"]))["background-color"],
    ).toBe(RGB.hover);
  });

  test("§05's focus outline is 2px at offset 2px in color.focus", async ({ page }) => {
    await open(page, "C1");
    // "color.focus | #526F89 | 焦点外轮廓；2px，offset 2px", and the rule that
    // carries it is the scoped `:focus-visible` in workspace-v11.css, so any
    // control in the workspace answers for it.
    await page.locator("#dx-sidebar [data-act=local]").focus();
    const ring = await styleOf(page, "#dx-sidebar [data-act=local]", [
      "outline-width",
      "outline-style",
      "outline-color",
      "outline-offset",
    ]);
    expect(ring).toEqual({
      "outline-width": "2px",
      "outline-style": "solid",
      "outline-color": RGB.focus,
      "outline-offset": "2px",
    });
  });

  test("the font stack is §04's, and no surface is asked to download one", async ({ page }) => {
    await open(page, "C1");
    /*
     * Asserted on the token's authored text, not on a computed value: Chromium
     * reports `BlinkMacSystemFont` back as `system-ui`, its own alias for the
     * same face, so a computed comparison would fail on a stack that is exactly
     * right. The stack itself is §04's, whitespace collapsed because tokens.css
     * wraps the declaration.
     */
    const token = await page.evaluate(() =>
      getComputedStyle(document.querySelector("#shell")!).getPropertyValue("--dx-font").replace(/\s+/g, " ").trim(),
    );
    expect(token).toBe(
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif',
    );

    // And the surfaces read it rather than writing their own: a heading resolves
    // to whatever `#shell` resolved the token to, alias and all.
    const [heading, shell] = await Promise.all([
      styleOf(page, ".dx-home h1", ["font-family"]),
      styleOf(page, "#shell", ["font-family"]),
    ]);
    expect(heading["font-family"]).toBe(shell["font-family"]);

    /*
     * "不附带或下载专有字体" — the workspace declares no `@font-face` of its own.
     *
     * Counted by the stylesheet each rule comes from rather than by
     * `document.fonts.size`, which is 2 in any shell that has loaded the sheet
     * editor: `@shimo/sdk-sheet` carries two inlined icon fonts (DateMentionIcons,
     * LockIcons). Those are Shimo's own frozen assets, which §01's boundary puts
     * outside this rule; a font declared under `src/shell` would not be.
     */
    const ownFonts = await page.evaluate(() => {
      const hits: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        const owner = sheet.ownerNode as HTMLElement | null;
        const id = owner?.getAttribute?.("data-vite-dev-id") ?? sheet.href ?? "";
        if (!/\/src\/shell\//.test(id)) continue;
        for (const rule of Array.from(rules)) {
          if (rule.constructor.name === "CSSFontFaceRule") hits.push(`${id}: ${rule.cssText.slice(0, 80)}`);
        }
      }
      return hits;
    });
    expect(ownFonts, `src/shell declares a font face:\n${ownFonts.join("\n")}`).toEqual([]);
  });
});
