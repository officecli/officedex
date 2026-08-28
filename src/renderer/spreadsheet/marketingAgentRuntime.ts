import type { AgentRun } from "../../shared/types";
import { confirmAgentApproval, waitForAgentRun } from "../agentRuntime";
import { officecli } from "../bridge";
import type { CampaignChannel, MarketingBatchDraft, MarketingCampaignSettings } from "./marketingWorkflow";
import { recordValue, stringValue } from "../utils/values";
export interface MarketingPostprocessInput {
  jobId: string;
  sheetId: string;
  rowIndex: number;
  sourceFilePath: string;
  finalStatus: string;
  channel?: CampaignChannel;
  outputTemplateId?: string;
  campaign?: MarketingCampaignSettings;
  productName: string;
  sourceTaskId?: string;
  batch: MarketingBatchDraft;
  workbookPath?: string;
  workspaceId?: string;
}

export interface MarketingPostprocessHandlers {
  insertImage(filePath: string): Promise<void>;
  setStatus(status: string): Promise<void>;
  save(): Promise<void>;
}

export class MarketingRuntimeError extends Error {
  constructor(message: string, readonly runId: string) {
    super(message);
    this.name = "MarketingRuntimeError";
  }
}

export async function runMarketingPostprocess(
  input: MarketingPostprocessInput,
  handlers: MarketingPostprocessHandlers,
  existingRunId?: string,
): Promise<AgentRun> {
  const workflow = input.channel ? "catalog.campaign.compose.v1" : "client-tools.v1";
  const parameters = input.channel && input.campaign ? {
    sourcePath: input.sourceFilePath,
    channelId: input.channel,
    outputTemplateId: input.outputTemplateId,
    campaignName: input.campaign.name,
    productName: input.productName,
    offer: input.campaign.offer,
    cta: input.campaign.cta,
  } : { filePath: input.sourceFilePath };
  const run = existingRunId
    ? await officecli.retryAgentRun(existingRunId)
    : await officecli.startAgentRun({
      workflow,
      input: {
        parameters,
        client_tools: [
          { call_id: `${input.jobId}:insert-image`, tool: "workbook.insert_image", resource_ref: input.sheetId, risk: "write", arguments: { batch: input.batch, row_index: input.rowIndex, file_path: input.sourceFilePath } },
          { call_id: `${input.jobId}:set-status`, tool: "workbook.set_status", resource_ref: input.sheetId, risk: "write", arguments: { batch: input.batch, row_index: input.rowIndex, status: input.finalStatus } },
          { call_id: `${input.jobId}:save`, tool: "workbook.save", resource_ref: input.sheetId, risk: "write" },
        ],
      },
      metadata: {
        surface: "spreadsheet.marketing",
        operation: "row-postprocess",
        job_id: input.jobId,
        sheet_id: input.sheetId,
        row_index: String(input.rowIndex),
        ...(input.workbookPath ? { workbook_path: input.workbookPath } : {}),
        ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
        ...(input.sourceTaskId ? { source_task_id: input.sourceTaskId } : {}),
      },
    });
  try {
    const outcome = await waitForAgentRun(run.id, {
      approve: confirmAgentApproval,
      clientTools: {
        "workbook.insert_image": async (request) => {
          const workflowResult = recordValue(request.arguments.workflow_result);
          const filePath = stringValue(workflowResult.filePath) || input.sourceFilePath;
          await handlers.insertImage(filePath);
          return { inserted: true, file_path: filePath, row_index: input.rowIndex };
        },
        "workbook.set_status": async () => {
          await handlers.setStatus(input.finalStatus);
          return { updated: true, status: input.finalStatus };
        },
        "workbook.save": async () => {
          await handlers.save();
          return { saved: true };
        },
      },
    });
    if (outcome.kind !== "completed") throw new Error(outcome.question);
    return outcome.run;
  } catch (reason) {
    throw new MarketingRuntimeError(reason instanceof Error ? reason.message : String(reason), run.id);
  }
}
