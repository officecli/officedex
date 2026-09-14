import { describe, expect, it } from "vitest";
import { createInitialTaskState } from "../taskState";
import { reconcilePptxTaskStatus } from "./pptxStatusReconciliation";
const state = () => ({ ...createInitialTaskState(), tasks: { t: { id: "t", conversationId: "c", status: "running" as const, events: [] } } });
describe("live task status reconciliation", () => {
 it.each(["failed", "cancelled", "completed"])("recovers a missing %s event", status => {
  const result = reconcilePptxTaskStatus(state(), "t", { task_id: "t", status, last_error: "timeout" });
  expect(result.tasks.t.status).toBe(status);
  expect(result.tasks.t.events).toHaveLength(1);
  expect(reconcilePptxTaskStatus(result,"t",{ task_id:"t",status })).toBe(result);
 });
 it("does not count status replies as generated content", () => {
  const result = reconcilePptxTaskStatus(state(),"t",{ task_id:"t",status:"running" },123);
  expect(result.tasks.t.lastStatusCheckAt).toBe(123);
  expect(result.tasks.t.events).toEqual([]);
  expect(result.tasks.t.lastProgressAt).toBeUndefined();
 });
 it("ignores another task and a late response after cancellation", () => {
  const initial=state();expect(reconcilePptxTaskStatus(initial,"t",{task_id:"other",status:"failed"})).toBe(initial);
  const canceled=reconcilePptxTaskStatus(initial,"t",{task_id:"t",status:"cancelled"});
  expect(reconcilePptxTaskStatus(canceled,"t",{task_id:"t",status:"completed"})).toBe(canceled);
 });
});
