import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Save,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import { officecli } from "../bridge";
import { dialog } from "../ui";
import { exportDocx } from "./docxExport";
import { DocxImportError, importDocx } from "./docxImport";
import { useT } from "../i18n";

interface DocxEditorProps {
  previewToken: string;
  fileName: string;
  onDirtyChange?: (dirty: boolean) => void;
}

interface ToolButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolButton({ label, active, disabled, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`word-tool-button${active ? " is-active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function DocxEditor({ previewToken, fileName, onDirtyChange }: DocxEditorProps) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const fingerprintRef = useRef<string | undefined>(undefined);
  const loadingContentRef = useRef(false);
  const overwriteConfirmedRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ allowBase64: true, inline: false }),
      TableKit.configure({ table: { resizable: true } }),
    ],
    content: "<p></p>",
    editorProps: {
      attributes: {
        class: "word-editor-content",
        spellcheck: "true",
      },
    },
    onUpdate: () => {
      if (!loadingContentRef.current) setDirty(true);
    },
  });

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    void officecli.readArtifactFile(previewToken)
      .then(async ({ data, sha256 }) => {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
        const imported = await importDocx(bytes);
        if (cancelled) return;
        loadingContentRef.current = true;
        editor.commands.setContent(imported.html, { emitUpdate: false });
        loadingContentRef.current = false;
        fingerprintRef.current = sha256;
        setWarnings(imported.warnings);
        setDirty(false);
        setLoadFailed(false);
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        if (cause instanceof DocxImportError) {
          setError(t(`docx.error.${cause.code}`));
        } else {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
        setLoadFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editor, previewToken, t]);

  const persistDocx = useCallback(async (saveAsCopy: boolean) => {
    if (!editor || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const bytes = await exportDocx(editor.getJSON(), fileName);
      const result = await officecli.saveDocx(bytes, fileName, {
        previewToken,
        expectedSHA256: fingerprintRef.current,
        saveAsCopy,
      });
      if (!saveAsCopy) {
        fingerprintRef.current = result.sha256;
        setDirty(false);
        setMessage(t("docx.editor.savedOriginal"));
      } else {
        setMessage(t("docx.editor.savedCopy", { path: result.filePath }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [editor, fileName, previewToken, saving, t]);

  const save = useCallback(async (saveAsCopy = false) => {
    if (!editor || saving) return;
    if (!saveAsCopy && !overwriteConfirmedRef.current) {
      dialog.confirm({
        title: t("docx.editor.overwriteTitle"),
        content: t("docx.editor.overwriteBody"),
        okText: t("docx.editor.overwriteConfirm"),
        cancelText: t("settings.common.cancel"),
        tone: "danger",
        onOk: async () => {
          overwriteConfirmedRef.current = true;
          await persistDocx(false);
        },
      });
      return;
    }
    await persistDocx(saveAsCopy);
  }, [editor, persistDocx, saving, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save(false);
      }
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [dirty, save]);

  if (loading) return <div className="word-editor-state">{t("docx.editor.converting")}</div>;
  if (!editor) return <div className="word-editor-state">{t("docx.editor.initializing")}</div>;
  if (loadFailed) return <div className="word-editor-state is-error">{t("docx.editor.openFailed", { error: error ?? "" })}</div>;

  return (
    <div className="word-editor-shell">
      <div className="word-editor-toolbar" role="toolbar" aria-label={t("docx.editor.toolbar")}>
        <div className="word-tool-group">
          <ToolButton label={t("docx.editor.undo")} disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.redo")} disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></ToolButton>
        </div>
        <div className="word-tool-group">
          <ToolButton label={t("docx.editor.heading1")} active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.heading2")} active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.bold")} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.italic")} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.underline")} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.strike")} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></ToolButton>
        </div>
        <div className="word-tool-group">
          <ToolButton label={t("docx.editor.bulletList")} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.orderedList")} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.insertTable")} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16} /></ToolButton>
        </div>
        <div className="word-tool-group">
          <ToolButton label={t("docx.editor.alignLeft")} active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.alignCenter")} active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.alignRight")} active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight size={16} /></ToolButton>
          <ToolButton label={t("docx.editor.alignJustify")} active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}><AlignJustify size={16} /></ToolButton>
        </div>
        <div className="word-tool-group word-save-group">
          <button type="button" className="word-save-button secondary" disabled={saving} onClick={() => void save(true)}><Copy size={15} />{t("docx.editor.saveCopy")}</button>
          <button type="button" className="word-save-button" disabled={saving || !dirty} onClick={() => void save(false)}><Save size={15} />{saving ? t("docx.editor.saving") : dirty ? t("docx.editor.save") : t("docx.editor.saved")}</button>
        </div>
      </div>

      <div className={`word-editor-notice${error ? " is-error" : ""}`}>
        {error ?? message ?? (warnings.length > 0
          ? t("docx.editor.compatibilityWarnings", { count: warnings.length })
          : t("docx.editor.compatibilityHint"))}
      </div>

      <div className="word-editor-canvas">
        <div className="word-editor-page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
