// Vertical (connector) contracts: Jira, Liquipedia, marketing images and the
// Shopify catalog cleanup. These are separate products that share the
// spreadsheet workspace; their types and their slice of the desktop API live
// here so the core document contract in types.ts does not grow with every
// connector. Renderer-facing shapes only: secrets never cross this boundary,
// while provider responses keep their source metadata for an auditable Sheet
// writeback.

import type { ImageRatio } from "./types";

export type JiraAuthType = "token" | "basic" | "";

export interface JiraConnectionSummary {
  configured: boolean;
  baseUrl: string;
  authType: JiraAuthType;
  username?: string;
}

export interface JiraProbeResult {
  server: { baseUrl: string; version: string; deploymentType?: string; serverTitle?: string };
  user: { name?: string; displayName?: string };
}

export interface JiraSyncResult {
  sheetName: string;
  headers: string[];
  rows: string[][];
  jql: string;
  total: number;
  fetched: number;
  truncated: boolean;
  syncedAt: string;
  querySummary?: string;
}

export type ConfiguredJiraSyncResult =
  | { status: "completed"; result: JiraSyncResult; message?: string }
  | { status: "unsupported" | "failed"; result?: undefined; message?: string };

export interface LiquipediaConnectionSummary {
  configured: boolean;
  baseUrl: string;
  contact?: string;
}

export interface LiquipediaProbeResult {
  siteName: string;
  generator: string;
  language?: string;
  apiUrl: string;
  userAgent: string;
}

export interface LiquipediaSyncResult {
  sheetName: string;
  headers: string[];
  rows: string[][];
  total: number;
  fetched: number;
  truncated: boolean;
  syncedAt: string;
  querySummary?: string;
  attribution: string;
}

export type ConfiguredLiquipediaSyncResult =
  | { status: "completed"; result: LiquipediaSyncResult; message?: string }
  | { status: "unsupported" | "failed"; result?: undefined; message?: string };

export interface MarketingCampaignPlanInput {
  sheetId: string; sheetName: string; headers: string[];
  rows: Array<{ rowIndex: number; productName: string; basePrompt: string; referenceImages?: string[] }>;
  campaign: Record<string, unknown> & { selectedChannelIds: string[] };
}

export interface MarketingCampaignPlanResult {
  ruleVersion?: string; channels: string[]; missingChannels: string[];
  jobs: Array<{ rowIndex: number; productName?: string; referenceImages?: string[]; channelId: string; outputTemplateId?: string; ratio?: ImageRatio; outputColumn?: number; prompt: string }>;
}

export interface CampaignImageInput { sourcePath: string; channelId: string; outputTemplateId?: string; campaignName?: string; productName?: string; offer?: string; cta?: string; }

export interface CampaignImageResult { filePath: string; width: number; height: number; }

export interface ShopifyCatalogCleanupInput {
  sheetId: string; sheetName: string; rows: string[][]; selectionStartRow: number;
  intent?: "create" | "update" | "mixed";
  confirmedMapping?: Array<{ column: number; header: string; role: string; confidence: number; reason: string }>;
}

export interface ShopifyCatalogCleanupResult {
  sheetId: string; sheetName: string; headerRowIndex: number; firstRowIndex: number;
  existingColumnCount: number; headers: string[]; sourceRows: string[][];
  intent: "create" | "update" | "mixed"; creditEstimate: number;
  mapping: Array<{ column: number; header: string; role: string; confidence: number; reason: string }>;
  rows: Array<{ rowIndex: number; status: string; issues: string[]; findings: Array<{ code: string; severity: string; message: string }>; cleanupActions: Array<{ code: string; field: string; before: string; after: string; safety: string; message: string }>; values: Record<string, string> }>;
  batchFindings: Array<{ code: string; severity: string; message: string }>;
  resultColumns: Record<string, number>; ruleVersion: string; taxonomyVersion: string;
  shopifyCsv: string; findingsCsv: string;
}

/** The connector slice of DesktopAPI. */
export interface DesktopVerticalAPI {
  getJiraConnection(): Promise<JiraConnectionSummary>;
  saveJiraConnection(input: { baseUrl: string; auth: { type: JiraAuthType; username?: string; secret: string } }): Promise<JiraProbeResult>;
  clearJiraConnection(): Promise<void>;
  getLiquipediaConnection(): Promise<LiquipediaConnectionSummary>;
  saveLiquipediaConnection(input: { baseUrl: string; contact: string }): Promise<LiquipediaProbeResult>;
  clearLiquipediaConnection(): Promise<void>;
  planShopifyCatalogCampaign(input: MarketingCampaignPlanInput): Promise<MarketingCampaignPlanResult>;
  composeCampaignImage(input: CampaignImageInput): Promise<CampaignImageResult>;
}
