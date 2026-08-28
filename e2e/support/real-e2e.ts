import { expect, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";

export type DocumentType = "pptx" | "docx" | "xlsx" | "report" | "img" | "gif";
export type GenerationMode = "plan";

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

const ONBOARDING_WELCOME_TEXT = /Welcome to OfficeDex/i;
const ONBOARDING_SKIP_BUTTON = /Skip for now/i;
const VIBE_CONFIRM_BUTTON = /确认这个节点|确认所属|Confirm this node|Confirm parent/i;

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

export async function preparePage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("officedex.locale", "en");
  });
  page.on("pageerror", (error) => {
    if (/Failed to fetch/i.test(error.message)) {
      return;
    }
    throw error;
  });
  await page.goto("/");
  await expect(page.getByText("OfficeDex").first()).toBeVisible({ timeout: 60_000 });
  await dismissOnboarding(page);
}

export async function dismissOnboarding(page: Page): Promise<void> {
  const welcome = page.getByText(ONBOARDING_WELCOME_TEXT).first();
  const skip = page.getByRole("button", { name: ONBOARDING_SKIP_BUTTON }).first();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const welcomeVisible = await welcome.isVisible().catch(() => false);
    const skipVisible = await skip.isVisible().catch(() => false);
    if (!welcomeVisible && !skipVisible) {
      return;
    }
    if (skipVisible && await skip.isEnabled().catch(() => false)) {
      await skip.click({ timeout: 5_000 });
      await expect(welcome).toBeHidden({ timeout: 10_000 });
      return;
    }
    await page.waitForTimeout(250);
  }
  await expect(welcome).toBeHidden();
}

export async function expectPptistText(page: Page, text: string, timeout = 120_000): Promise<void> {
  const iframe = page.locator("iframe[title='PPTist Embed']").first();
  await expect(iframe).toBeVisible({ timeout });
  await expect(page.frameLocator("iframe[title='PPTist Embed']").getByText(text).first()).toBeVisible({ timeout });
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

export async function selectDocumentType(page: Page, documentType: DocumentType): Promise<void> {
  const labels: Record<DocumentType, string> = {
    pptx: "PPTX",
    docx: "DOCX",
    xlsx: "XLSX",
    report: "Report",
    img: "Image",
    gif: "GIF",
  };
  await clickAntRadioButton(page, labels[documentType]);
}

export async function openNewGeneration(page: Page): Promise<void> {
  const prompt = page.getByRole("textbox", { name: /describe the result|what you want to generate/i }).first();
  if (await prompt.isVisible().catch(() => false)) {
    return;
  }
  const expandSidebar = page.getByRole("button", { name: /Expand sidebar/i }).first();
  if (await expandSidebar.isVisible().catch(() => false)) {
    await expandSidebar.click({ force: true });
  }
  const newChat = page.getByRole("button", { name: /New chat/i }).first();
  if (await newChat.isVisible().catch(() => false)) await newChat.click({ force: true, timeout: 60_000 });
  await expect(prompt).toBeVisible({ timeout: 60_000 });
}

async function clickAntRadioButton(page: Page, label: string): Promise<void> {
  const ant = page.locator("label.ant-radio-button-wrapper").filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`, "i") }).first();
  if (await ant.isVisible().catch(() => false)) { await ant.click(); return; }
  await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}$`, "i") }).first().click();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function submitGeneration(page: Page, input: {
  documentType: DocumentType;
  mode?: GenerationMode;
  prompt: string;
  sourceFile?: string;
}): Promise<void> {
  await openNewGeneration(page);
  await selectDocumentType(page, input.documentType);
  if (input.sourceFile) {
    await queueFileDialog(input.sourceFile);
    await page.getByRole("button", { name: /Attach source file/i }).click();
    await expect(page.getByText(input.sourceFile.split(/[\\/]/).pop() ?? input.sourceFile)).toBeVisible();
  }
  const prompt = page.getByRole("textbox", { name: /describe the result|what you want to generate/i }).first();
  await prompt.fill(input.prompt);
  const start = page.getByRole("button", { name: /Start creating|Analyze|Generate|Create/i }).last();
  await start.click();
  const planButton = page.getByRole("button", { name: /Create execution plan|Confirm and start/i });
  if (await planButton.isVisible().catch(() => false)) await planButton.click();
}

export async function waitForCompletedArtifact(page: Page, documentType: DocumentType): Promise<{ taskId: string; artifactPath: string; fileSize: number }> {
  const deadline = Date.now() + 45 * 60_000;
  while (Date.now() < deadline) {
    if (await isCompletedArtifactVisible(page)) {
      break;
    }
    await assertNoResponseContractError(page);
    if (await answerVisibleInteraction(page)) {
      continue;
    }
    await page.waitForTimeout(1_000);
  }
  if (!(await page.getByText("Generation Complete").first().isVisible().catch(() => false))) {
    await expect(completedArtifactSurface(page)).toBeVisible({ timeout: 1_000 });
  }
  const artifact = await hostControl<{ taskId: string; path: string; size: number; documentType: string }>("/control/artifacts/latest");
  expect(artifact.documentType).toBe(documentType);
  if (documentType !== "img" && documentType !== "report") {
    expect(artifact.path.toLowerCase()).toContain(`.${documentType}`);
  }
  expect(artifact.size).toBeGreaterThan(0);
  return { taskId: artifact.taskId, artifactPath: artifact.path, fileSize: artifact.size };
}

export async function answerPlanUntilCompleted(page: Page, documentType: DocumentType): Promise<{ taskId: string; artifactPath: string; fileSize: number }> {
  const deadline = Date.now() + 45 * 60_000;
  while (Date.now() < deadline) {
    if (await isCompletedArtifactVisible(page)) {
      return waitForCompletedArtifact(page, documentType);
    }
    await assertNoResponseContractError(page);

    if (await answerVisibleInteraction(page)) {
      continue;
    }

    await page.waitForTimeout(1_000);
  }
  throw new Error(`Timed out waiting for ${documentType} plan generation to complete`);
}

async function isCompletedArtifactVisible(page: Page): Promise<boolean> {
  if (await page.getByText("Generation Complete").first().isVisible().catch(() => false)) {
    return true;
  }
  return completedArtifactSurface(page).isVisible().catch(() => false);
}

function completedArtifactSurface(page: Page) {
  return page.locator([
    ".living-tree-cockpit[data-vibe-stage='completed'] .living-tree-artifact-actions",
    ".living-tree-cockpit[data-vibe-stage='completed'] .living-tree-pptx-edit-panel.is-review-mode",
  ].join(", ")).first();
}

async function answerVisibleInteraction(page: Page): Promise<boolean> {
  const attention = page.locator(".home-attention-row").first();
  if (await attention.isVisible().catch(() => false)) {
    await attention.click();
    await page.waitForTimeout(300);
    return true;
  }
  const stageContinue = page.getByRole("button", { name: /Continue|继续确认|Start drawing|开始绘制|Approve plan|确认计划|开始执行/i }).first();
  if (await stageContinue.isVisible().catch(() => false)) {
    await stageContinue.click();
    await page.waitForTimeout(1_000);
    return true;
  }
  if (await answerVisibleVibeCanvas(page)) {
    return true;
  }

  const approve = page.locator("button.plan-review-approve").first();
  if (await approve.isVisible().catch(() => false)) {
    await approve.click();
    await page.waitForTimeout(1_000);
    return true;
  }

  const option = page.locator(".question-composer-option").first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    await page.waitForTimeout(1_000);
    return true;
  }

  const freeform = page.getByPlaceholder(/Type a custom answer/i).first();
  if (await freeform.isVisible().catch(() => false)) {
    await freeform.fill("Use the recommended concise default for this real E2E run.");
    await page.locator(".question-composer button").last().click();
    await page.waitForTimeout(1_000);
    return true;
  }

  return false;
}

async function answerVisibleVibeCanvas(page: Page): Promise<boolean> {
  const canvas = page.locator(".living-tree-cockpit").first();
  if (!(await canvas.isVisible().catch(() => false))) {
    return false;
  }

  if (await page.locator(".living-tree-flow-node.is-node-drawing, .living-tree-flow-node.is-idea-drawing").first().isVisible().catch(() => false)) {
    await page.waitForTimeout(1_000);
    return true;
  }

  const existingConfirmButton = page.getByRole("button", { name: VIBE_CONFIRM_BUTTON }).filter({ visible: true }).first();
  if (await existingConfirmButton.isVisible().catch(() => false)) {
    await existingConfirmButton.dispatchEvent("click");
    await page.waitForTimeout(600);
    return true;
  }

  const pendingNode = page.locator(".living-tree-flow-node.is-confirmable.is-pending").first();
  if (await pendingNode.isVisible().catch(() => false)) {
    await pendingNode.dispatchEvent("click");
    const confirmButton = page.getByRole("button", { name: VIBE_CONFIRM_BUTTON }).filter({ visible: true }).first();
    await expect(confirmButton).toBeVisible({ timeout: 60_000 });
    await confirmButton.dispatchEvent("click");
    await page.waitForTimeout(600);
    return true;
  }

  const stageButton = page.locator(".living-tree-task-card button.living-tree-stage-cta-ready").first();
  if (await stageButton.isVisible().catch(() => false)) {
    await stageButton.click({ force: true });
    await page.waitForTimeout(1_000);
    return true;
  }

  return false;
}

export async function assertNoResponseContractError(page: Page): Promise<void> {
  await expect(page.getByText(/either option_id or answer is required/i)).toHaveCount(0);
}

export async function readTextFixture(name: string): Promise<string> {
  return readFile(await fixturePath(name), "utf8");
}
