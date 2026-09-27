import { type TestInfo } from "@playwright/test";

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
