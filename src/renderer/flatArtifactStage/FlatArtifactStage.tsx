import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  FlatArtifactContractError,
  createFlatArtifactEditRequest,
  createFlatArtifactSelection,
  pixelToNormalizedRegion,
  validateNormalizedRegion,
  type FlatArtifactDescriptor,
  type FlatArtifactEditRequest,
  type FlatArtifactFrameSelection,
  type FlatArtifactSelection,
  type NormalizedRegion,
} from "./contract";
import "./flatArtifactStage.css";
import { useT } from "../i18n";

export interface FlatArtifactStageProps {
  /** Identity and dimensions only. This component never reads artifactPath. */
  readonly artifact: FlatArtifactDescriptor;
  /** Optional already-resolved preview URL. No URL is resolved by this component. */
  readonly previewSrc?: string;
  readonly alt?: string;
  readonly initialRegion?: NormalizedRegion | null;
  readonly initialFrameSelection?: FlatArtifactFrameSelection;
  /** Emits only validated, identity-only selections. */
  readonly onSelectionChange?: (selection: FlatArtifactSelection) => void;
  /** Optional local intent affordance. Execution remains the caller's responsibility. */
  readonly onEditRequest?: (request: FlatArtifactEditRequest) => void | Promise<void>;
  readonly className?: string;
}

type FrameMode = "single" | "range";

interface FrameFields {
  readonly single: string;
  readonly start: string;
  readonly end: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof FlatArtifactContractError) return error.message;
  if (error instanceof Error) return error.message;
  return "Selection is invalid.";
}

function frameFieldsFor(selection: FlatArtifactFrameSelection): FrameFields {
  return selection.kind === "single"
    ? { single: String(selection.index), start: "0", end: "0" }
    : { single: "0", start: String(selection.start), end: String(selection.end) };
}

function frameModeFor(selection: FlatArtifactFrameSelection): FrameMode {
  return selection.kind;
}

function frameSelectionFromFields(mode: FrameMode, fields: FrameFields): FlatArtifactFrameSelection {
  if (mode === "single") return { kind: "single", index: fields.single.trim() === "" ? Number.NaN : Number(fields.single) };
  return {
    kind: "range",
    start: fields.start.trim() === "" ? Number.NaN : Number(fields.start),
    end: fields.end.trim() === "" ? Number.NaN : Number(fields.end),
  };
}

function selectionFor(
  artifact: FlatArtifactDescriptor,
  region: NormalizedRegion | null,
  frameSelection: FlatArtifactFrameSelection,
): FlatArtifactSelection {
  return createFlatArtifactSelection(artifact, { region, frameSelection });
}

/**
 * The flat-artifact T1 surface. It owns only local selection state and emits
 * validated selection/request values; bridge, model, billing and file IO stay
 * outside this component.
 */
export function FlatArtifactStage({
  artifact,
  previewSrc,
  alt = "Artifact preview",
  initialRegion = null,
  initialFrameSelection,
  onSelectionChange,
  onEditRequest,
  className,
}: FlatArtifactStageProps) {
  const t = useT();
  const defaultFrameSelection = useMemo<FlatArtifactFrameSelection>(
    () => initialFrameSelection ?? { kind: "single", index: 0 },
    [initialFrameSelection],
  );
  const [region, setRegion] = useState<NormalizedRegion | null>(() => {
    if (initialRegion == null) return null;
    try {
      return validateNormalizedRegion(initialRegion);
    } catch {
      return null;
    }
  });
  const [frameMode, setFrameMode] = useState<FrameMode>(() => frameModeFor(defaultFrameSelection));
  const [frameFields, setFrameFields] = useState<FrameFields>(() => frameFieldsFor(defaultFrameSelection));
  const [draftRegion, setDraftRegion] = useState<NormalizedRegion | null>(null);
  const [error, setError] = useState<string | null>(() => {
    try {
      selectionFor(artifact, initialRegion, defaultFrameSelection);
      return null;
    } catch (cause) {
      return errorMessage(cause);
    }
  });
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // A new artifact is a new local selection surface. Invalid incoming values
  // remain visibly rejected and are never emitted as a selection.
  useEffect(() => {
    const nextFrame: FlatArtifactFrameSelection = initialFrameSelection ?? { kind: "single", index: 0 };
    let nextRegion: NormalizedRegion | null = null;
    try {
      if (initialRegion != null) nextRegion = validateNormalizedRegion(initialRegion);
      selectionFor(artifact, nextRegion, nextFrame);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setRegion(nextRegion);
    setFrameMode(frameModeFor(nextFrame));
    setFrameFields(frameFieldsFor(nextFrame));
    setDraftRegion(null);
    dragStartRef.current = null;
  }, [artifact, initialFrameSelection, initialRegion]);

  const normalizedPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) throw new FlatArtifactContractError("invalid-region", "Artifact preview is not measurable.");
    const bounds = canvas.getBoundingClientRect();
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
      throw new FlatArtifactContractError("invalid-region", "Artifact preview is not measurable.");
    }
    return {
      x: Math.max(0, Math.min(bounds.width, clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, clientY - bounds.top)),
    };
  }, []);

  const regionFromDrag = useCallback((clientX: number, clientY: number) => {
    const start = dragStartRef.current;
    if (!start) return null;
    const point = normalizedPoint(clientX, clientY);
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      throw new FlatArtifactContractError("invalid-region", "Artifact preview is not measurable.");
    }
    // Pointer coordinates belong to the rendered preview box, not the source
    // artifact's intrinsic pixel grid. The contract still performs the
    // conversion and clamping; using the box dimensions preserves its [0, 1]
    // result at any responsive display size.
    return pixelToNormalizedRegion(
      {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      },
      bounds,
    );
  }, [normalizedPoint]);

  const commitRegion = useCallback((nextRegion: NormalizedRegion | null) => {
    try {
      const validated = nextRegion == null ? null : validateNormalizedRegion(nextRegion);
      const frameSelection = frameSelectionFromFields(frameMode, frameFields);
      const selection = selectionFor(artifact, validated, frameSelection);
      setRegion(validated);
      setDraftRegion(null);
      setError(null);
      onSelectionChange?.(selection);
    } catch (cause) {
      setDraftRegion(null);
      setError(errorMessage(cause));
    }
  }, [artifact, frameFields, frameMode, onSelectionChange]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Some test/browser adapters surface pointer events without `button`; the
    // primary pointer is still the only gesture this canvas accepts.
    if (event.button !== 0 && event.button !== undefined) return;
    try {
      const point = normalizedPoint(event.clientX, event.clientY);
      dragStartRef.current = point;
      setDraftRegion({ x: point.x / (canvasRef.current?.getBoundingClientRect().width || 1), y: point.y / (canvasRef.current?.getBoundingClientRect().height || 1), width: 0.00001, height: 0.00001 });
      setError(null);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    try {
      setDraftRegion(regionFromDrag(event.clientX, event.clientY));
    } catch (cause) {
      setDraftRegion(null);
      setError(errorMessage(cause));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    try {
      const nextRegion = regionFromDrag(event.clientX, event.clientY);
      dragStartRef.current = null;
      commitRegion(nextRegion);
    } catch (cause) {
      dragStartRef.current = null;
      setDraftRegion(null);
      setError(errorMessage(cause));
    }
  };

  const handlePointerCancel = () => {
    dragStartRef.current = null;
    setDraftRegion(null);
  };

  const clearRegion = useCallback(() => commitRegion(null), [commitRegion]);

  const adjustRegion = useCallback((key: "moveX" | "moveY" | "resizeW" | "resizeH", amount: number) => {
    if (!region) return;
    const next = { ...region };
    if (key === "moveX") next.x += amount;
    if (key === "moveY") next.y += amount;
    if (key === "resizeW") next.width += amount;
    if (key === "resizeH") next.height += amount;
    commitRegion(next);
  }, [commitRegion, region]);

  const handleCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      clearRegion();
      return;
    }
    const step = event.shiftKey ? 0.05 : 0.01;
    if (event.key === "ArrowLeft") { event.preventDefault(); adjustRegion("moveX", -step); }
    if (event.key === "ArrowRight") { event.preventDefault(); adjustRegion("moveX", step); }
    if (event.key === "ArrowUp") { event.preventDefault(); adjustRegion("moveY", -step); }
    if (event.key === "ArrowDown") { event.preventDefault(); adjustRegion("moveY", step); }
    if (event.key === "=" || event.key === "+") {
      event.preventDefault();
      if (region) commitRegion({ ...region, width: region.width + step, height: region.height + step });
    }
    if (event.key === "-") {
      event.preventDefault();
      if (region) commitRegion({
        ...region,
        width: region.width - step,
        height: region.height - step,
      });
    }
  };

  const updateFrame = useCallback((mode: FrameMode, fields: FrameFields) => {
    setFrameMode(mode);
    setFrameFields(fields);
    try {
      const selection = selectionFor(artifact, region, frameSelectionFromFields(mode, fields));
      setError(null);
      onSelectionChange?.(selection);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [artifact, onSelectionChange, region]);

  const submitEdit = async () => {
    try {
      const request = createFlatArtifactEditRequest({
        instruction,
        artifact,
        region,
        frameSelection: frameSelectionFromFields(frameMode, frameFields),
      });
      setError(null);
      setSubmitting(true);
      await onEditRequest?.(request);
      setInstruction("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const shownRegion = draftRegion ?? region;
  const regionStyle = shownRegion ? {
    left: `${shownRegion.x * 100}%`,
    top: `${shownRegion.y * 100}%`,
    width: `${shownRegion.width * 100}%`,
    height: `${shownRegion.height * 100}%`,
  } : undefined;
  const canSubmit = Boolean(onEditRequest && instruction.trim() && !error && !submitting);

  return (
    <section className={["flat-artifact-stage", className].filter(Boolean).join(" ")} aria-label={t("flatStage.aria")}>
      <div
        ref={canvasRef}
        className="flat-artifact-stage__canvas"
        style={{ aspectRatio: `${artifact.width} / ${artifact.height}` }}
        role="group"
        aria-label={t("flatStage.region")}
        aria-describedby="flat-artifact-stage-status"
        tabIndex={0}
        onKeyDown={handleCanvasKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {previewSrc ? <img className="flat-artifact-stage__preview" src={previewSrc} alt={alt} draggable={false} /> : <div className="flat-artifact-stage__preview-placeholder" aria-label={alt}>{alt}</div>}
        {regionStyle ? <div className={["flat-artifact-stage__region", draftRegion ? "flat-artifact-stage__region--draft" : ""].filter(Boolean).join(" ")} style={regionStyle} aria-label="Selected artifact region" /> : null}
      </div>
      <div className="flat-artifact-stage__controls">
        <button type="button" className="flat-artifact-stage__clear" onClick={clearRegion} disabled={!region} aria-label={t("flatStage.clear")}>{t("flatStage.clear")}</button>
        {artifact.kind === "gif" ? (
          <fieldset className="flat-artifact-stage__frames" aria-label={t("flatStage.frames")}>
            <legend>{t("flatStage.frames")}</legend>
            <label><input type="radio" name={`${artifact.artifactId}-frame-mode`} checked={frameMode === "single"} onChange={() => updateFrame("single", frameFields)} /> {t("flatStage.single")}</label>
            <label><input type="radio" name={`${artifact.artifactId}-frame-mode`} checked={frameMode === "range"} onChange={() => updateFrame("range", frameFields)} /> {t("flatStage.range")}</label>
            {frameMode === "single" ? (
              <label>{t("flatStage.frame")} <input aria-label={t("flatStage.gifFrame")} type="number" min={0} max={artifact.frameCount - 1} value={frameFields.single} onChange={(event) => updateFrame("single", { ...frameFields, single: event.target.value })} /></label>
            ) : (
              <span className="flat-artifact-stage__range-fields">
                <label>{t("flatStage.start")} <input aria-label={t("flatStage.gifRangeStart")} type="number" min={0} max={artifact.frameCount - 1} value={frameFields.start} onChange={(event) => updateFrame("range", { ...frameFields, start: event.target.value })} /></label>
                <label>{t("flatStage.end")} <input aria-label={t("flatStage.gifRangeEnd")} type="number" min={0} max={artifact.frameCount - 1} value={frameFields.end} onChange={(event) => updateFrame("range", { ...frameFields, end: event.target.value })} /></label>
              </span>
            )}
          </fieldset>
        ) : null}
        {onEditRequest ? (
          <div className="flat-artifact-stage__intent" aria-label="Artifact edit request">
            <label htmlFor={`${artifact.artifactId}-instruction`}>{t("flatStage.instruction")}</label>
            <input id={`${artifact.artifactId}-instruction`} value={instruction} disabled={submitting} onChange={(event) => setInstruction(event.target.value)} placeholder={t("flatStage.placeholder")} />
            <button type="button" onClick={() => void submitEdit()} disabled={!canSubmit}>{submitting ? t("flatStage.checking") : t("flatStage.request")}</button>
          </div>
        ) : null}
      </div>
      <div id="flat-artifact-stage-status" className={error ? "flat-artifact-stage__status flat-artifact-stage__status--error" : "flat-artifact-stage__status"} role={error ? "alert" : "status"}>
        {error ?? (region ? t("flatStage.selected") : t("flatStage.dragHint"))}
      </div>
    </section>
  );
}

export const FlatArtifactEditor = FlatArtifactStage;
