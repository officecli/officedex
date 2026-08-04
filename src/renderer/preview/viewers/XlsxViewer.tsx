import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "antd";
import type { AbstractedSheetSDK } from "@shimo/sdk-sheet";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { officecli } from "../../bridge";
import { createOfflineSheetEditor } from "./sheetSdk";

interface XlsxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  onDirtyChange?: (dirty: boolean) => void;
}

type EditorState = "loading" | "clean" | "dirty" | "saving" | "saved" | "error";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function XlsxViewer({ previewToken, fileName, documentType, onDirtyChange }: XlsxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<AbstractedSheetSDK | null>(null);
  const sessionIDRef = useRef("");
  const focusedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const lifecycleVersionRef = useRef(0);
  const changeVersionRef = useRef(0);
  const saveHandlerRef = useRef<() => void>(() => undefined);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const [state, setState] = useState<EditorState>("loading");
  const [dirty, setDirty] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  onDirtyChangeRef.current = onDirtyChange;

  const openExternal = useCallback(() => {
    officecli.openPath(fileName).catch(() => undefined);
  }, [fileName]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const lifecycleVersion = ++lifecycleVersionRef.current;
    let disposed = false;
    let tornDown = false;
    let sessionID = "";
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
      if (sessionID) {
        await officecli.closeXlsxEditor({ previewToken, sessionId: sessionID }).catch(() => undefined);
      }
    };

    setState("loading");
    setDirty(false);
    setPrepareError(null);
    setSaveError(null);
    editorRef.current = null;
    sessionIDRef.current = "";
    saveInFlightRef.current = false;
    changeVersionRef.current = 0;

    void (async () => {
      try {
        const prepared = await officecli.prepareXlsxEditor(previewToken);
        sessionID = prepared.sessionId;
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
          setDirty(true);
          setSaveError(null);
          setState("dirty");
        });
        editorRef.current = editor;
        sessionIDRef.current = sessionID;
        setState("clean");
      } catch (error) {
        await teardown();
        if (!disposed) {
          setPrepareError(errorMessage(error));
          setState("error");
        }
      }
    })();

    return () => {
      disposed = true;
      if (lifecycleVersionRef.current === lifecycleVersion) {
        lifecycleVersionRef.current += 1;
        saveInFlightRef.current = false;
      }
      editorRef.current = null;
      sessionIDRef.current = "";
      void teardown();
    };
  }, [loadAttempt, previewToken]);

  const save = useCallback(async () => {
    const editor = editorRef.current;
    const sessionID = sessionIDRef.current;
    if (!editor || !sessionID || saveInFlightRef.current) return;

    saveInFlightRef.current = true;
    const lifecycleVersion = lifecycleVersionRef.current;
    const versionAtSaveStart = changeVersionRef.current;
    setState("saving");
    setSaveError(null);
    try {
      const delta = await editor.content.getContent();
      const modocContent = delta.stringify();
      await officecli.saveXlsxEditor({ previewToken, sessionId: sessionID, modocContent });
      if (lifecycleVersionRef.current === lifecycleVersion) {
        const changedDuringSave = changeVersionRef.current !== versionAtSaveStart;
        setDirty(changedDuringSave);
        setState(changedDuringSave ? "dirty" : "saved");
      }
    } catch (error) {
      if (lifecycleVersionRef.current === lifecycleVersion) {
        setSaveError(errorMessage(error));
        setState("error");
      }
    } finally {
      if (lifecycleVersionRef.current === lifecycleVersion) {
        saveInFlightRef.current = false;
      }
    }
  }, [previewToken]);
  saveHandlerRef.current = () => void save();

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  useEffect(() => () => {
    onDirtyChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      focusedRef.current = Boolean(containerRef.current?.contains(event.target as Node));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!focusedRef.current || !event.metaKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      saveHandlerRef.current();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (prepareError) {
    return (
      <ErrorState
        message={prepareError}
        fileName={fileName}
        onRetry={() => {
          setPrepareError(null);
          setLoadAttempt((attempt) => attempt + 1);
        }}
        onOpenExternal={openExternal}
      />
    );
  }

  const status = state === "dirty"
    ? "未保存"
    : state === "saving"
      ? "保存中"
      : state === "error"
        ? "保存失败"
        : "已保存";
  const canSave = Boolean(editorRef.current) && (state === "dirty" || state === "error");

  return (
    <>
      <PreviewToolbar
        fileName={fileName}
        documentType={documentType ?? "xlsx"}
        onOpenExternal={openExternal}
        center={(
          <div className="preview-xlsx-save-controls">
            <span className={`preview-xlsx-save-status preview-xlsx-save-status-${state}`}>{status}</span>
            <Button size="small" type="primary" onClick={() => void save()} disabled={!canSave}>
              保存
            </Button>
          </div>
        )}
      />
      <div className="preview-xlsx-editor-shell">
        <div ref={containerRef} className="preview-xlsx-editor" />
        {state === "loading" && (
          <div className="preview-xlsx-loading">
            <LoadingState fileName={fileName} />
          </div>
        )}
        {saveError && <div className="preview-xlsx-save-error" role="alert">{saveError}</div>}
      </div>
    </>
  );
}
