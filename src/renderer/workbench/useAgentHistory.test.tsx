import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { agentHistoryKey, messageHistoryCodec, useAgentHistory } from "./useAgentHistory";

afterEach(() => { cleanup(); localStorage.clear(); });
it("persists before unmount and routes a late update to its original file", () => {
  const a = agentHistoryKey("docx", "/a.docx");
  const b = agentHistoryKey("docx", "/b.docx");
  const hook = renderHook(({ storageKey }) => useAgentHistory(storageKey, messageHistoryCodec), { initialProps: { storageKey: a } });
  const updateA = hook.result.current[1];
  act(() => updateA([{ role: "user", text: "Edit A" }]));
  hook.rerender({ storageKey: b });
  act(() => updateA((previous) => [...previous, { role: "assistant", text: "A finished" }]));
  expect(hook.result.current[0]).toEqual([]);
  hook.unmount();
  const reopened = renderHook(() => useAgentHistory(a, messageHistoryCodec));
  expect(reopened.result.current[0].map((item) => item.text)).toEqual(["Edit A", "A finished"]);
  expect(localStorage.getItem(b!)).toBeNull();
});
it("ignores corrupt data and keeps files without a stable path ephemeral", () => {
  const key = agentHistoryKey("docx", "/bad.docx")!;
  localStorage.setItem(key, "{invalid");
  const bad = renderHook(() => useAgentHistory(key, messageHistoryCodec));
  expect(bad.result.current[0]).toEqual([]);
  const ephemeral = renderHook(() => useAgentHistory(undefined, messageHistoryCodec));
  act(() => ephemeral.result.current[1]([{ role: "user", text: "Unsaved" }]));
  ephemeral.unmount();
  expect(renderHook(() => useAgentHistory(undefined, messageHistoryCodec)).result.current[0]).toEqual([]);
});
