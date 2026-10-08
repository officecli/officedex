import { expect, type Locator, type Page } from "@playwright/test";
import type { TestInfo } from "@playwright/test";

export type DocumentType = "pptx" | "docx" | "xlsx" | "report" | "img" | "gif";
/** `fast` is the default a shell run takes; `plan` needs the `?planMode=1` opt-in. */
export type GenerationMode = "plan" | "fast";

export interface ScenarioRecord {
  uiScenario: string;
  documentType?: DocumentType;
  mode?: GenerationMode;
  taskId?: string;
  artifactPath?: string;
  fileSize?: number;
  durationMs?: number;
  credits?: unknown;
  runtime?: unknown;
  error?: string;
}

export function realE2EEndpoint(): string {
  const endpoint = process.env.OFFICEDEX_REAL_E2E_ENDPOINT;
  if (!endpoint) {
    throw new Error("OFFICEDEX_REAL_E2E_ENDPOINT is required for real OfficeDex client E2E.");
  }
  return endpoint.replace(/\/+$/, "");
}

export async function hostControl<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${realE2EEndpoint()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.error || `control ${path} failed with ${response.status}`);
  }
  return body as T;
}

export async function recordScenario(record: ScenarioRecord): Promise<void> {
  await hostControl("/control/records", {
    method: "POST",
    body: JSON.stringify(record),
  });
}

export async function attachHostReport(testInfo: TestInfo): Promise<void> {
  const report = await hostControl("/control/report");
  await testInfo.attach("real-e2e-host-report", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
}

export async function queueFileDialog(paths: string | string[]): Promise<void> {
  await hostControl("/control/file-dialog", {
    method: "POST",
    body: JSON.stringify({ paths: Array.isArray(paths) ? paths : [paths] }),
  });
}

export async function fixturePath(name: string): Promise<string> {
  const result = await hostControl<{ path: string }>(`/control/fixture/${encodeURIComponent(name)}`);
  return result.path;
}

/**
 * The shell's own view state. `v1` belonged to the Agent/Editor shell and
 * shares no field with the OD-UI-1.2 (r10) shape, so clearing the old key would
 * silently stop clearing anything (`src/shell/state/persist.ts`).
 */
const SHELL_STATE_KEY = "officedex.shell.v2";

/**
 * The usage notice is shown once per browser profile, and it is a panel over
 * the bottom-right corner of the window — which is where the Dex bubble is. A
 * fresh Playwright profile got it every time, and it intercepted the pointer
 * events for the bubble rather than failing visibly. Marking it as already seen
 * is the only thing suppressed here; nothing these specs assert goes through it.
 */
const USAGE_NOTICE_KEY = "officedex:usage-notice:v2";

/**
 * Boots the shell on the real bridge, from a clean view state, and refuses the
 * in-memory fake.
 *
 * The seed rows belong to `src/shell/port/fake`: seeing them means the page fell
 * back to the preview port and whatever follows would prove nothing about the
 * desktop backend.
 */
export async function openShell(page: Page, url = "/"): Promise<void> {
  page.on("pageerror", (error) => {
    // The bridge's SSE stream aborts as the page navigates; everything else is
    // a genuine failure and should surface here rather than as a later timeout.
    if (/Failed to fetch/i.test(error.message)) return;
    throw error;
  });
  await page.addInitScript(
    ([stateKey, noticeKey]) => {
      try {
        localStorage.removeItem(stateKey);
        localStorage.setItem(noticeKey, new Date().toISOString());
      } catch {
        /* a locked-down profile keeps its state */
      }
    },
    [SHELL_STATE_KEY, USAGE_NOTICE_KEY] as const,
  );
  await page.goto(url);
  await expect(page.locator('#shell[data-loaded="true"]')).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("MO product launch", { exact: true }),
    "the shell fell back to its in-memory fake — check hasDesktopBackend()",
  ).toHaveCount(0);
}

/** Home's composer: the one that starts new work (`pages/Home.tsx`). */
export function homeComposer(page: Page): Locator {
  return page.locator(".dx-home-composer textarea[data-draft=home]");
}

/**
 * The conversation column's composer — r10's "Message OfficeDex".
 *
 * There is no Agent/Editor mode and no "Message Agent": the conversation is a
 * column of its own (`#dx-conversation`), and this is the composer at the bottom
 * of it.
 */
export function chatComposer(page: Page): Locator {
  return page.locator("#dx-conversation textarea[data-draft=chat]");
}

/**
 * The composer for an instruction about the document on screen, opening the Dex
 * panel first if it is closed — the way a person does, by pressing the bubble.
 *
 * This is the r10 stand-in for the old `agentComposer`: the collapsed agent mark
 * of Editor mode is now `button.dx-dex[data-act=dex]`, and the panel it opens
 * (`.dx-dex-panel`) carries the composer that is aimed at the open file. The
 * panel exists only while an editable document is in the content region, which
 * is exactly when these specs use it.
 */
export async function dexComposer(page: Page): Promise<Locator> {
  const composer = page.locator(".dx-dex-panel textarea[data-draft=dex]");
  if (!(await composer.isVisible().catch(() => false))) {
    await page.locator("button.dx-dex[data-act=dex]").click();
  }
  await expect(composer).toBeVisible({ timeout: 30_000 });
  return composer;
}

/** The run card in the conversation or the Dex panel (`chat/AgentRun.tsx`). */
export function runCard(page: Page): Locator {
  return page.locator(".dx-agent-run");
}

/**
 * A question the run is blocked on — not the outline gate, which is the same
 * element with an editable outline in it and is answered differently.
 */
export function questionCard(page: Page): Locator {
  return page.locator(".dx-agent-question:not([data-gate])");
}

/** The outline gate: the one blocking stop a deck run makes. */
export function outlineGate(page: Page): Locator {
  return page.locator(".dx-agent-question[data-gate=outline]");
}

/**
 * The `data-status` values the run card uses for a run that did not finish
 * (`chat/runState.ts`: RUN_DATA_STATUS). `stopped` is left out — a stop is
 * something the test asked for, not something that went wrong.
 */
const FAILED_STATUSES = ["failed", "partial", "interrupted"] as const;

const failedCard = (page: Page): Locator =>
  page.locator(FAILED_STATUSES.map((status) => `.dx-agent-run[data-status="${status}"]`).join(", "));

/**
 * Fails the moment the card says the run did not finish, with the runtime's own
 * words.
 *
 * Polling past a visible failure until a twenty-five minute deadline and then
 * reporting "timed out" is true and useless — that is what this existed for
 * before r10, when the signal was a toast that had already gone by the time the
 * report was read. The card's `data-status` outlives the toast, and
 * `.dx-agent-summary` is where the runtime's sentence ends up (`summaryOf`
 * returns `task.error` for a failure).
 */
export async function assertRunDidNotFail(page: Page): Promise<void> {
  const card = failedCard(page).first();
  if (!(await card.isVisible().catch(() => false))) return;
  const detail = await card
    .locator(".dx-agent-summary")
    .innerText()
    .catch(() => "");
  throw new Error(
    `The shell reported the run as failed: ${detail.trim().replace(/\s+/g, " ") || "no reason shown"}`,
  );
}

/**
 * Answers the question on screen, if there is one, so a run can reach its end
 * without a person.
 *
 * Two steps, not one: in r10 picking a suggested answer fills the field and
 * nothing is sent until Continue (`AgentRun.Question`). A question with no
 * options at all is answered in the same field, which is freeform when the
 * runtime allowed it.
 *
 * The first option is taken rather than the recommended one because r10 draws no
 * mark for `option.recommended` — see the note in the final report.
 */
export async function answerPendingQuestion(page: Page): Promise<boolean> {
  const card = questionCard(page).first();
  if (!(await card.isVisible().catch(() => false))) return false;
  const options = card.locator("[data-act=agent-answer]");
  if ((await options.count()) > 0) {
    await options.first().click();
  } else {
    const field = card.locator("input[data-agent-answer]");
    await expect(field, "the question offers neither an option nor a field to answer in").toBeVisible();
    await field.fill("Use the recommended concise default.");
  }
  await card.locator("button[type=submit]").click();
  /*
   * The card goes away because the run took the answer, not because the page
   * happened to re-render. Without this, an answer the runtime did not
   * understand reads as "still waiting" and the caller loops until its own
   * deadline — the deadlock these specs exist to catch.
   */
  await expect(card).toBeHidden({ timeout: 60_000 });
  return true;
}

/**
 * Opens a file from disk, the way r10 offers it: Local, then Open.
 *
 * Editor mode's Home is gone, and so is its "Open from this computer". Local is
 * where opening a file lives now (`pages/LocalPage.tsx`, §07: "Open 是 Local
 * 的事"), and the page header's button is there whether or not the workspace has
 * files — unlike Home's, which only appears while Recent is empty.
 *
 * `queueFileDialog` has to have been called first: the picker is the host's.
 */
export async function openFromDisk(page: Page): Promise<void> {
  await page.locator("#dx-sidebar [data-act=local]").click();
  await expect(page.locator("#shell")).toHaveAttribute("data-page", "local");
  await page.locator(".dx-page-header [data-act=open-picker]").click();
}

/**
 * Asking for something leaves Home: the canvas the run fills is behind it.
 *
 * `data-home` is gone — the page on screen is one attribute now (`data-page`),
 * and sending from Home opens a conversation, which can never leave the content
 * region on Home (`open-chat` in `state/shellReducer.ts`).
 */
export async function expectLeftHome(page: Page): Promise<void> {
  await expect(page.locator("#shell")).not.toHaveAttribute("data-page", "home", { timeout: 30_000 });
}
