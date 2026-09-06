import { planRefresh, type OfficeLineageRef, type OfficeOutputRef, type OfficeRefreshPlan } from "../shared/officeProduct";

export interface RefreshImpact {
  output: OfficeOutputRef;
  plan: OfficeRefreshPlan;
}

export function calculateRefreshImpact(outputs: OfficeOutputRef[], next: OfficeLineageRef, changedViewIds: string[] = next.viewIds): RefreshImpact[] {
  const changed = new Set(changedViewIds);
  return outputs
    .filter((output) => output.lineage?.workbookId === next.workbookId && output.lineage.viewIds.some((id) => changed.has(id)))
    .map((output) => ({ output, plan: planRefresh(output, next) }));
}

export function canAutoRefresh(plan: OfficeRefreshPlan): boolean {
  return !plan.requiresApproval && plan.strategy !== "content";
}
