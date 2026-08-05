import type { AbstractedSheetSDK } from "@shimo/sdk-sheet";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Artifact, PreviewGrant } from "../../shared/types";
import { officecli } from "../bridge";
import { ErrorState } from "../preview/components/ErrorState";
import { LoadingState } from "../preview/components/LoadingState";
import { createOfflineSheetEditor } from "./sheetSdk";

export type SpreadsheetCanvasState = "loading" | "clean" | "dirty" | "saving" | "saved" | "error";

export interface SpreadsheetCanvasHandle {
  save(): Promise<boolean>;
  focus(): void;
}

export interface SpreadsheetCanvasProps {
  artifact: Artifact;
  grant: PreviewGrant;
  onDirtyChange?: (dirty: boolean) => void;
  onStateChange?: (state: SpreadsheetCanvasState) => void;
  onError?: (error?: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const SpreadsheetCanvas = forwardRef<SpreadsheetCanvasHandle, SpreadsheetCanvasProps>(
  function SpreadsheetCanvas({ artifact, grant, onDirtyChange, onStateChange, onError }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<AbstractedSheetSDK | null>(null);
    const sessionIdRef = useRef("");
    const focusedRef = useRef(false);
    const lifecycleVersionRef = useRef(0);
    const changeVersionRef = useRef(0);
    const dirtyRef = useRef(false);
    const savePromiseRef = useRef<Promise<boolean> | null>(null);
    const saveHandlerRef = useRef<() => Promise<boolean>>(async () => false);
    const callbacksRef = useRef({ onDirtyChange, onStateChange, onError });
    const [state, setState] = useState<SpreadsheetCanvasState>("loading");
    const [prepareError, setPrepareError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [loadAttempt, setLoadAttempt] = useState(0);

    callbacksRef.current = { onDirtyChange, onStateChange, onError };

    const publishState = useCallback((nextState: SpreadsheetCanvasState) => {
      setState(nextState);
      callbacksRef.current.onStateChange?.(nextState);
    }, []);

    const publishDirty = useCallback((dirty: boolean) => {
      dirtyRef.current = dirty;
      callbacksRef.current.onDirtyChange?.(dirty);
    }, []);

    const openExternal = useCallback(() => {
      void officecli.openPath(artifact.filePath).catch(() => undefined);
    }, [artifact.filePath]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const lifecycleVersion = ++lifecycleVersionRef.current;
      let disposed = false;
      let tornDown = false;
      let sessionId = "";
      let editor: AbstractedSheetSDK | null = null;
      let unsubscribe: (() => void) | undefined;
      let observer: ResizeObserver | undefined;

      const teardown = async () => {
        if (tornDown) return;
        tornDown = true;
        unsubscribe?.();
        observer?.disconnect();
        if (editor) {
          await editor.unmount().catch(() => undefined);
          await editor.destroy().catch(() => undefined);
        }
        if (sessionId) {
          await officecli.closeXlsxEditor({ previewToken: grant.token, sessionId }).catch(() => undefined);
        }
      };

      publishState("loading");
      publishDirty(false);
      setPrepareError(null);
      setSaveError(null);
      callbacksRef.current.onError?.(undefined);
      editorRef.current = null;
      sessionIdRef.current = "";
      savePromiseRef.current = null;
      changeVersionRef.current = 0;

      void (async () => {
        try {
          const prepared = await officecli.prepareXlsxEditor(grant.token);
          sessionId = prepared.sessionId;
          if (disposed) {
            await teardown();
            return;
          }
          editor = await createOfflineSheetEditor(container, prepared.modocContent);
          if (disposed) {
            await teardown();
            return;
          }
          observer = new ResizeObserver(() => window.dispatchEvent(new Event("resize")));
          observer.observe(container);
          unsubscribe = editor.content.addChangeListener(() => {
            changeVersionRef.current += 1;
            publishDirty(true);
            setSaveError(null);
            callbacksRef.current.onError?.(undefined);
            publishState("dirty");
          });
          editorRef.current = editor;
          sessionIdRef.current = sessionId;
          publishState("clean");
        } catch (error) {
          await teardown();
          if (!disposed) {
            const message = errorMessage(error);
            setPrepareError(message);
            callbacksRef.current.onError?.(message);
            publishState("error");
          }
        }
      })();

      return () => {
        disposed = true;
        if (lifecycleVersionRef.current === lifecycleVersion) {
          lifecycleVersionRef.current += 1;
          savePromiseRef.current = null;
        }
        editorRef.current = null;
        sessionIdRef.current = "";
        focusedRef.current = false;
        void teardown();
      };
    }, [artifact.filePath, grant.token, loadAttempt, publishDirty, publishState]);

    const save = useCallback((): Promise<boolean> => {
      if (savePromiseRef.current) return savePromiseRef.current;
      const editor = editorRef.current;
      const sessionId = sessionIdRef.current;
      if (!editor || !sessionId) return Promise.resolve(false);
      if (!dirtyRef.current && state !== "error") return Promise.resolve(true);

      const lifecycleVersion = lifecycleVersionRef.current;
      const versionAtSaveStart = changeVersionRef.current;
      publishState("saving");
      setSaveError(null);
      callbacksRef.current.onError?.(undefined);

      const pending = (async () => {
        try {
          const delta = await editor.content.getContent();
          await officecli.saveXlsxEditor({
            previewToken: grant.token,
            sessionId,
            modocContent: delta.stringify(),
          });
          if (lifecycleVersionRef.current !== lifecycleVersion) return false;
          const changedDuringSave = changeVersionRef.current !== versionAtSaveStart;
          publishDirty(changedDuringSave);
          publishState(changedDuringSave ? "dirty" : "saved");
          return true;
        } catch (error) {
          if (lifecycleVersionRef.current === lifecycleVersion) {
            const message = errorMessage(error);
            publishDirty(true);
            setSaveError(message);
            callbacksRef.current.onError?.(message);
            publishState("error");
          }
          return false;
        } finally {
          if (lifecycleVersionRef.current === lifecycleVersion) {
            savePromiseRef.current = null;
          }
        }
      })();
      savePromiseRef.current = pending;
      return pending;
    }, [grant.token, publishDirty, publishState, state]);
    saveHandlerRef.current = save;

    useImperativeHandle(ref, () => ({
      save,
      focus() {
        focusedRef.current = true;
        containerRef.current?.focus();
      },
    }), [save]);

    useEffect(() => {
      const handlePointerDown = (event: PointerEvent) => {
        focusedRef.current = Boolean(containerRef.current?.contains(event.target as Node));
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!focusedRef.current || !event.metaKey || event.key.toLowerCase() !== "s") return;
        event.preventDefault();
        void saveHandlerRef.current();
      };
      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, []);

    useEffect(() => {
      if (!dirtyRef.current) return;
      const handleBeforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [state]);

    useEffect(() => () => {
      callbacksRef.current.onDirtyChange?.(false);
    }, []);

    if (prepareError) {
      return (
        <section className="spreadsheet-canvas spreadsheet-canvas--error" aria-label={artifact.fileName}>
          <ErrorState
            message={prepareError}
            fileName={artifact.fileName}
            onRetry={() => {
              setPrepareError(null);
              setLoadAttempt((attempt) => attempt + 1);
            }}
            onOpenExternal={openExternal}
          />
        </section>
      );
    }

    return (
      <section className="spreadsheet-canvas" aria-label={artifact.fileName}>
        <div ref={containerRef} className="spreadsheet-canvas__editor" tabIndex={-1} />
        {state === "loading" ? (
          <div className="spreadsheet-canvas__loading">
            <LoadingState fileName={artifact.fileName} />
          </div>
        ) : null}
        {saveError ? <div className="spreadsheet-canvas__save-error" role="alert">{saveError}</div> : null}
      </section>
    );
  },
);
