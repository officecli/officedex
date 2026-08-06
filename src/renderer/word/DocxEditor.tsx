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
import { exportDocx } from "./docxExport";
import { importDocx } from "./docxImport";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
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
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editor, previewToken]);

  const save = useCallback(async (saveAsCopy = false) => {
    if (!editor || saving) return;
    if (!saveAsCopy && !overwriteConfirmedRef.current) {
      const confirmed = window.confirm("OfficeDex 会根据当前编辑内容重新生成 DOCX。复杂版式可能发生变化，建议先保存副本。确认覆盖原文档吗？");
      if (!confirmed) return;
      overwriteConfirmedRef.current = true;
    }
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
        setMessage("已保存到原文档");
      } else {
        setMessage(`副本已保存：${result.filePath}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [editor, fileName, previewToken, saving]);

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

  if (loading) return <div className="word-editor-state">正在转换 DOCX 为可编辑文档…</div>;
  if (!editor) return <div className="word-editor-state">正在初始化编辑器…</div>;

  return (
    <div className="word-editor-shell">
      <div className="word-editor-toolbar" role="toolbar" aria-label="Word 编辑工具栏">
        <div className="word-tool-group">
          <ToolButton label="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></ToolButton>
          <ToolButton label="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></ToolButton>
        </div>
        <div className="word-tool-group">
          <ToolButton label="标题 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></ToolButton>
          <ToolButton label="标题 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></ToolButton>
          <ToolButton label="粗体" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></ToolButton>
          <ToolButton label="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></ToolButton>
          <ToolButton label="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={16} /></ToolButton>
          <ToolButton label="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></ToolButton>
        </div>
        <div className="word-tool-group">
          <ToolButton label="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></ToolButton>
          <ToolButton label="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></ToolButton>
          <ToolButton label="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16} /></ToolButton>
        </div>
        <div className="word-tool-group">
          <ToolButton label="左对齐" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft size={16} /></ToolButton>
          <ToolButton label="居中" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter size={16} /></ToolButton>
          <ToolButton label="右对齐" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight size={16} /></ToolButton>
          <ToolButton label="两端对齐" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}><AlignJustify size={16} /></ToolButton>
        </div>
        <div className="word-tool-group word-save-group">
          <button type="button" className="word-save-button secondary" disabled={saving} onClick={() => void save(true)}><Copy size={15} />保存副本</button>
          <button type="button" className="word-save-button" disabled={saving || !dirty} onClick={() => void save(false)}><Save size={15} />{saving ? "保存中…" : dirty ? "保存" : "已保存"}</button>
        </div>
      </div>

      <div className={`word-editor-notice${error ? " is-error" : ""}`}>
        {error ?? message ?? (warnings.length > 0
          ? `本地可编辑模式会重建 DOCX；检测到 ${warnings.length} 条兼容性提示，请用“版式预览”对照原文档。`
          : "本地可编辑模式支持常规标题、段落、列表、图片和表格；保存前可用“版式预览”对照复杂排版。")}
      </div>

      <div className="word-editor-canvas">
        <div className="word-editor-page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
