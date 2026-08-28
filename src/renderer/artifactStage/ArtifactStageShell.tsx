import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Input } from "../ui";
import { ArtifactStageStatusBanner, type ArtifactStageStatus } from "./StageStatus";
import "./artifactStage.css";

/** The amount of artifact surface that an adapter can expose. */
export type ArtifactCapabilityTier = "T0" | "T1" | "T2" | "T3";

/** The user-visible cost class of an intent. Adapters own this decision. */
export type IntentCost = "free" | "metered" | "heavy";

export interface ArtifactStageSelection {
  readonly artifactId?: string | null;
  readonly itemId?: string | null;
  readonly slideNumber?: number | null;
}

export interface ArtifactStageScope<TSelection extends ArtifactStageSelection = ArtifactStageSelection> {
  readonly id: string;
  readonly label: ReactNode;
  readonly cost?: IntentCost;
  readonly disabled?: boolean;
  readonly description?: ReactNode;
  readonly selection?: TSelection;
}

export interface ArtifactStageActionContext<TSelection extends ArtifactStageSelection = ArtifactStageSelection> {
  readonly instruction: string;
  readonly scope: ArtifactStageScope<TSelection>;
  readonly selection: TSelection;
}

export interface ArtifactStageAction<TSelection extends ArtifactStageSelection = ArtifactStageSelection> {
  readonly id: string;
  readonly label?: ReactNode;
  readonly execute: (context: ArtifactStageActionContext<TSelection>) => void | Promise<void>;
}

export interface ArtifactStageAdapter<TSelection extends ArtifactStageSelection = ArtifactStageSelection> {
  /** Prefer `capabilityTier`; `tier` is retained as a small fixture-friendly alias. */
  readonly capabilityTier?: ArtifactCapabilityTier;
  readonly tier?: ArtifactCapabilityTier;
  readonly getScopes: (selection: TSelection) => readonly ArtifactStageScope<TSelection>[];
  readonly defaultScopeId?: string;
  /** Selects a new default when the artifact selection itself changes. */
  readonly getDefaultScopeId?: (
    selection: TSelection,
    scopes: readonly ArtifactStageScope<TSelection>[],
  ) => string | null | undefined;
  readonly getCost?: (scope: ArtifactStageScope<TSelection>, selection: TSelection) => IntentCost;
  readonly getPlaceholder?: (scope: ArtifactStageScope<TSelection> | null, selection: TSelection) => string;
  readonly placeholder?: (scope: ArtifactStageScope<TSelection> | null, selection: TSelection) => string;
  readonly getAction?: (context: ArtifactStageActionContext<TSelection>) => ArtifactStageAction<TSelection> | null | undefined;
  readonly createAction?: (context: ArtifactStageActionContext<TSelection>) => ArtifactStageAction<TSelection> | null | undefined;
}

export interface ArtifactStageSlotContext<TSelection extends ArtifactStageSelection = ArtifactStageSelection> {
  readonly selection: TSelection;
  readonly scope: ArtifactStageScope<TSelection> | null;
  readonly busy: boolean;
}

export type ArtifactStageSlot<TSelection extends ArtifactStageSelection = ArtifactStageSelection> =
  | ReactNode
  | ((context: ArtifactStageSlotContext<TSelection>) => ReactNode);

export interface ArtifactStageShellProps<TSelection extends ArtifactStageSelection = ArtifactStageSelection> {
  readonly adapter: ArtifactStageAdapter<TSelection>;
  readonly selection: TSelection;
  readonly stage?: ArtifactStageSlot<TSelection>;
  readonly timeline?: ArtifactStageSlot<TSelection>;
  /** Optional type-specific intent UI while adapters migrate to the generic controls. */
  readonly intent?: ArtifactStageSlot<TSelection>;
  readonly hideIntent?: boolean;
  readonly busy?: boolean;
  readonly status?: ArtifactStageStatus;
  readonly statusMessage?: ReactNode;
  readonly statusError?: ReactNode;
  readonly onCancel?: () => void | Promise<void>;
  readonly onRetry?: () => void | Promise<void>;
  readonly className?: string;
  readonly "aria-label"?: string;
}

function renderSlot<TSelection extends ArtifactStageSelection>(
  slot: ArtifactStageSlot<TSelection> | undefined,
  context: ArtifactStageSlotContext<TSelection>,
) {
  return typeof slot === "function" ? slot(context) : slot;
}

function resolveTier<TSelection extends ArtifactStageSelection>(adapter: ArtifactStageAdapter<TSelection>): ArtifactCapabilityTier {
  return adapter.capabilityTier ?? adapter.tier ?? "T0";
}

function selectionKey(selection: ArtifactStageSelection): string {
  try {
    return JSON.stringify(selection);
  } catch {
    return String(selection);
  }
}

/**
 * Generic artifact workspace shell. Adapters provide capabilities and action
 * routing; this component deliberately knows nothing about pptx/docx/xlsx.
 */
export function ArtifactStageShell<TSelection extends ArtifactStageSelection>({
  adapter,
  selection,
  stage,
  timeline,
  intent,
  hideIntent = false,
  busy = false,
  status,
  statusMessage,
  statusError,
  onCancel,
  onRetry,
  className,
  "aria-label": ariaLabel = "Artifact workspace",
}: ArtifactStageShellProps<TSelection>) {
  const scopes = useMemo(() => adapter.getScopes(selection), [adapter, selection]);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const previousSelectionKeyRef = useRef<string | null>(null);
  const currentSelectionKey = selectionKey(selection);

  const selectedScope = useMemo(
    () => scopes.find((scope) => scope.id === scopeId) ?? null,
    [scopeId, scopes],
  );

  // Scope is always a member of the current adapter selection. This is the
  // convergence point when a slide/block/document selection changes.
  useEffect(() => {
    const selectionChanged = previousSelectionKeyRef.current !== currentSelectionKey;
    previousSelectionKeyRef.current = currentSelectionKey;
    const currentScopeIsValid = Boolean(scopeId && scopes.some((scope) => scope.id === scopeId && !scope.disabled));
    if (!selectionChanged && currentScopeIsValid) return;
    const dynamicDefaultId = adapter.getDefaultScopeId?.(selection, scopes);
    const dynamicDefault = dynamicDefaultId
      ? scopes.find((scope) => scope.id === dynamicDefaultId && !scope.disabled)
      : undefined;
    const preferred = dynamicDefault ?? (adapter.defaultScopeId
      ? scopes.find((scope) => scope.id === adapter.defaultScopeId && !scope.disabled)
      : undefined);
    const documentScope = scopes.find((scope) => scope.id === "document" && !scope.disabled);
    const next = preferred ?? documentScope ?? scopes.find((scope) => !scope.disabled) ?? null;
    setScopeId(next?.id ?? null);
  }, [adapter, currentSelectionKey, scopeId, scopes, selection]);

  const cost = selectedScope
    ? adapter.getCost?.(selectedScope, selection) ?? selectedScope.cost ?? "free"
    : "free";
  const placeholder = adapter.getPlaceholder?.(selectedScope, selection)
    ?? adapter.placeholder?.(selectedScope, selection)
    ?? "Describe what you want to change";
  const canSubmit = Boolean(instruction.trim()) && Boolean(selectedScope) && !selectedScope?.disabled && !busy && !mutationBusy && !mutationRef.current;

  const submit = () => {
    if (!canSubmit || mutationRef.current || !selectedScope) return;
    const context: ArtifactStageActionContext<TSelection> = {
      instruction: instruction.trim(),
      scope: selectedScope,
      selection,
    };
    const action = adapter.getAction?.(context) ?? adapter.createAction?.(context);
    if (!action) return;
    setActionError(null);
    mutationRef.current = true;
    setMutationBusy(true);
    void Promise.resolve()
      .then(() => action.execute(context))
      .then(() => setInstruction(""))
      .catch((cause) => setActionError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => {
        mutationRef.current = false;
        setMutationBusy(false);
      });
  };

  const slotContext: ArtifactStageSlotContext<TSelection> = { selection, scope: selectedScope, busy: busy || mutationBusy || mutationRef.current };
  const tier = resolveTier(adapter);

  return (
    <section className={["artifact-stage-shell", className].filter(Boolean).join(" ")} aria-label={ariaLabel} data-tier={tier}>
      {status ? <ArtifactStageStatusBanner status={status} message={statusMessage} error={statusError} onCancel={onCancel} onRetry={onRetry} /> : null}
      {tier !== "T0" && stage ? <div className="artifact-stage-shell__stage" data-slot="stage">{renderSlot(stage, slotContext)}</div> : null}
      {timeline ? <div className="artifact-stage-shell__timeline" data-slot="timeline">{renderSlot(timeline, slotContext)}</div> : null}
      {!hideIntent ? <div className="artifact-stage-shell__intent" data-slot="intent">
        {intent ? renderSlot(intent, slotContext) : (
          <>
        <div className="artifact-stage-intent__scopes" role="radiogroup" aria-label="Intent scope">
          {scopes.map((scope) => {
            const scopeCost = adapter.getCost?.(scope, selection) ?? scope.cost ?? "free";
            return (
              <Button
                key={scope.id}
                type="text"
                size="small"
                ariaLabel={typeof scope.label === "string" ? scope.label : scope.id}
                aria-pressed={scope.id === selectedScope?.id}
                data-cost={scopeCost}
                disabled={scope.disabled || busy || mutationBusy || mutationRef.current}
                onClick={() => setScopeId(scope.id)}
                title={scope.description ? String(scope.description) : undefined}
                className={scope.id === selectedScope?.id ? "artifact-stage-intent__scope--selected" : undefined}
              >
                {scope.label}
              </Button>
            );
          })}
        </div>
        <div className="artifact-stage-intent__input-row">
          <Input
            value={instruction}
            placeholder={placeholder}
            aria-label="Artifact intent"
            disabled={busy || mutationBusy || mutationRef.current}
            onChange={(event) => setInstruction(event.target.value)}
            onPressEnter={submit}
          />
          <span className="artifact-stage-intent__cost" data-cost={cost}>{cost}</span>
          <Button type="primary" size="small" disabled={!canSubmit} loading={busy || mutationBusy || mutationRef.current} onClick={submit}>Apply</Button>
        </div>
          </>
        )}
        {actionError ? <div className="artifact-stage-shell__error" role="alert">{actionError}</div> : null}
      </div> : null}
    </section>
  );
}
