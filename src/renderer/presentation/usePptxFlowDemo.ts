import { useEffect, useState } from "react";
import type { DesktopTask } from "../../shared/types";
import { usePptxFlowCopy } from "./pptxFlowCopy";

/** A local clock only: never sends responses, creates files or changes the live task. */
export function usePptxFlowDemo(taskId: string) {
  const copy = usePptxFlowCopy();
  const [tick, setTick] = useState<number | null>(null);
  const [run, setRun] = useState(0);
  useEffect(() => { setTick(null); }, [taskId]);
  useEffect(() => {
    if (tick === null || tick >= 17) return;
    const timer = window.setTimeout(() => setTick((value) => value === null ? null : value + 1), tick < 9 ? 650 : 1300);
    return () => window.clearTimeout(timer);
  }, [tick, run]);
  const titles = [copy("demoTitle"), copy("demoOne"), copy("demoTwo"), copy("demoThree"), copy("demoFour"), copy("demoFive")];
  const task: DesktopTask | undefined = tick === null ? undefined : {
    id: `pptx-demo-${run}`, conversationId: "pptx-demo", status: tick === 17 ? "completed" : "running",
    events: [], topic: copy("demoBrief"),
    ...(tick >= 2 ? { vibeOutline: { slides: titles.slice(0, Math.min(6, tick - 1)).map((headline, index) => ({ id: `s${index + 1}`, headline })) } } : {}),
    ...(tick >= 9 ? { vibeOutline: { slides: titles.map((headline, index) => ({ id: `s${index + 1}`, headline })), visualDirection: copy("natural") } } : {}),
    ...(tick >= 11 ? { vibeSlides: titles.slice(0, tick - 11).map((title, index) => ({ id: `s${index + 1}`, elements: [{ type: "text", content: title }] })) } : {}),
  };
  return { task, tick, start: () => { setRun(value => value + 1); setTick(0); }, stop: () => setTick(null) };
}
