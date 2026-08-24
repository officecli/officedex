import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Tooltip } from "@vo-ui/backend";
import { BarChartOutlined, PictureOutlined } from "@ant-design/icons";
import type { VibeProjectTreeNode, VibeVisualAsset } from "../../shared/types";
import { workerSetTimeout, workerClearTimeout } from "../workerTimer";

// Shared "living tree" node-drawing animation primitives. Extracted from DialogueScreens
// so other surfaces can reuse the exact same typewriter + timing behaviour without
// importing the multi-thousand-line DialogueScreens module.

export const VIBE_NODE_DRAWING_MS = 1400;
export const IDEA_NODE_DRAWING_MS = VIBE_NODE_DRAWING_MS;
const VIBE_NODE_OUTLINE_MS = 900;
const VIBE_NODE_CARD_REVEAL_MS = 180;
export const VIBE_NODE_TEXT_START_MS = VIBE_NODE_OUTLINE_MS + VIBE_NODE_CARD_REVEAL_MS + 140;
export const VIBE_NODE_CHAR_STEP_MS = 22;
const VIBE_NODE_CHAR_MS = 90;
export const VIBE_NODE_LINE_PAUSE_MS = 150;
export const VIBE_NODE_VISUAL_ASSET_MS = 180;
const VIBE_NODE_VISUAL_ASSET_PAUSE_MS = 90;
const VIBE_NODE_DONE_PAUSE_MS = 260;
export const VIBE_NODE_MAX_VISUAL_ASSETS = 4;

export function vibeStreamingLineDuration(text: string) {
  const length = Array.from(text).length;
  return Math.max(180, (Math.max(1, length) - 1) * VIBE_NODE_CHAR_STEP_MS + VIBE_NODE_CHAR_MS);
}

export function vibeNodeDrawingTexts(label: string, node: VibeProjectTreeNode) {
  return [
    label,
    node.title,
    node.summary ?? "",
    ...(node.outline?.slice(0, 3) ?? []),
  ].filter((text) => text.trim().length > 0);
}

export function vibeNodeDrawingDurationMs(label: string, node: VibeProjectTreeNode) {
  const streamDuration = vibeNodeDrawingTexts(label, node).reduce(
    (total, text) => total + vibeStreamingLineDuration(text) + VIBE_NODE_LINE_PAUSE_MS,
    VIBE_NODE_TEXT_START_MS,
  );
  const visualAssetDuration = Math.min(node.visualAssets?.length ?? 0, VIBE_NODE_MAX_VISUAL_ASSETS)
    * (VIBE_NODE_VISUAL_ASSET_MS + VIBE_NODE_VISUAL_ASSET_PAUSE_MS);
  return Math.max(VIBE_NODE_DRAWING_MS, streamDuration + visualAssetDuration + VIBE_NODE_DONE_PAUSE_MS);
}

export function vibeNodeLineTimings(texts: string[]) {
  let cursor = VIBE_NODE_TEXT_START_MS;
  return texts.map((text) => {
    const timing = { delayMs: cursor, durationMs: vibeStreamingLineDuration(text) };
    cursor += timing.durationMs + VIBE_NODE_LINE_PAUSE_MS;
    return timing;
  });
}

export function vibeNodeVisualAssetTimings(lineTimings: Array<{ delayMs: number; durationMs: number }>, count: number) {
  const lastLineTiming = lineTimings.at(-1);
  let cursor = lastLineTiming
    ? lastLineTiming.delayMs + lastLineTiming.durationMs + VIBE_NODE_LINE_PAUSE_MS
    : VIBE_NODE_TEXT_START_MS;
  return Array.from({ length: count }, () => {
    const timing = { delayMs: cursor, durationMs: VIBE_NODE_VISUAL_ASSET_MS };
    cursor += VIBE_NODE_VISUAL_ASSET_MS + VIBE_NODE_VISUAL_ASSET_PAUSE_MS;
    return timing;
  });
}

type AnimatedTextLineTag = "span" | "strong" | "p" | "li";

export function AnimatedTextLine({ as = "span", text, lineIndex, delayMs, durationMs, className }: {
  as?: AnimatedTextLineTag;
  text: string;
  lineIndex: number;
  delayMs: number;
  durationMs: number;
  className?: string;
}) {
  const Component = as;
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [displayedText, setDisplayedText] = useState(() => reduceMotion ? text : "");
  const [streaming, setStreaming] = useState(false);
  const characters = useMemo(() => Array.from(text), [text]);
  const lineStyle = {
    "--line-index": lineIndex,
    "--line-duration": `${durationMs}ms`,
  } as CSSProperties & { "--line-index": number; "--line-duration": string };

  useEffect(() => {
    if (reduceMotion) {
      setDisplayedText(text);
      setStreaming(false);
      return undefined;
    }
    const timers: number[] = [];
    setDisplayedText("");
    setStreaming(false);

    const startTimer = workerSetTimeout(() => {
      setStreaming(true);
      if (characters.length === 0) {
        setStreaming(false);
        return;
      }
      characters.forEach((_, charIndex) => {
        const charTimer = workerSetTimeout(() => {
          setDisplayedText(characters.slice(0, charIndex + 1).join(""));
          if (charIndex === characters.length - 1) {
            const endTimer = workerSetTimeout(() => setStreaming(false), Math.max(90, VIBE_NODE_CHAR_STEP_MS * 2));
            timers.push(endTimer);
          }
        }, charIndex * VIBE_NODE_CHAR_STEP_MS);
        timers.push(charTimer);
      });
    }, delayMs);
    timers.push(startTimer);

    return () => {
      timers.forEach((timer) => workerClearTimeout(timer));
    };
  }, [characters, delayMs, reduceMotion, text]);

  return (
    <Component
      className={`living-tree-animated-line ${streaming ? "is-streaming" : ""} ${className ?? ""}`}
      data-has-content={displayedText.length > 0 ? "true" : "false"}
      data-line-index={lineIndex}
      data-streaming={streaming ? "true" : "false"}
      style={lineStyle}
    >
      {displayedText}
    </Component>
  );
}

export function AnimatedVisualAssetIcon({ asset, index, delayMs, durationMs, drawing }: {
  asset: VibeVisualAsset;
  index: number;
  delayMs: number;
  durationMs: number;
  drawing: boolean;
}) {
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [visible, setVisible] = useState(() => !drawing || reduceMotion);
  const isChart = asset.kind === "chart";
  const label = isChart ? "Chart" : "Image";
  const assetStyle = {
    "--asset-index": index,
    "--asset-duration": `${durationMs}ms`,
  } as CSSProperties & { "--asset-index": number; "--asset-duration": string };

  useEffect(() => {
    if (!drawing || reduceMotion) {
      setVisible(true);
      return undefined;
    }
    setVisible(false);
    const timer = workerSetTimeout(() => setVisible(true), delayMs);
    return () => workerClearTimeout(timer);
  }, [delayMs, drawing, reduceMotion]);

  if (!visible) return null;

  return (
    <Tooltip title={`${label}: ${asset.description}`} placement="top">
      <span
        className={`living-tree-visual-asset-icon ${isChart ? "is-chart" : "is-image"} ${drawing ? "is-drawing" : ""}`}
        aria-label={`${label}: ${asset.description}`}
        data-asset-kind={asset.kind}
        data-asset-index={index}
        role="img"
        style={assetStyle}
        tabIndex={0}
      >
        {isChart ? <BarChartOutlined /> : <PictureOutlined />}
      </span>
    </Tooltip>
  );
}
