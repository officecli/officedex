import { useState } from "react";

import { translate, useT } from "../../renderer/i18n";
import { FileIcon, extensionOf } from "../kit/Icon";
import { closeModal, openModal } from "../kit/layers";
import type { Attachment, FileMeta, FileType } from "../../shared/uiPort";

type OutputChoice = "auto" | FileType;

interface TaskContextRequest {
  files: FileMeta[];
  /** The document this composer sits beside, if any. */
  currentFile: FileMeta | null;
  /** File ids already referenced by the message. */
  selected: string[];
  attachments: Attachment[];
  output: OutputChoice;
  /** Who receives what is sent, as the model list names them. */
  provider: string;
  onChooseFromDisk: () => void;
  onApply: (next: { fileIds: string[]; output: OutputChoice }) => void;
}

/**
 * "Task context" — what this one message may use (OD-UI-1.2 §09).
 *
 * The composer's single "add" opens it. Context is explicit: only what is
 * ticked here travels with the message, the default never implies the whole
 * disk is readable, and every reference can still be removed from the composer
 * before sending.
 *
 * It also carries the one thing the old composer kept in its toolbar that the
 * new one has no room for: saying outright that this message should make a
 * *new* document of a given type, rather than change the one that is open.
 */
function TaskContextBody({ request }: { request: TaskContextRequest }) {
  const t = useT();
  const { files, currentFile, provider } = request;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(request.selected));
  const [output, setOutput] = useState<OutputChoice>(request.output);

  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const others = files.filter((file) => file.id !== currentFile?.id && file.type !== "image");

  return (
    <>
      <p>{t("dx.context.intro")}</p>
      {currentFile ? (
        <label className="dx-row dx-context-current">
          <input
            type="checkbox"
            name="context-file"
            value={currentFile.id}
            // The open document is what a message is about unless something else is chosen.
            checked={picked.has(currentFile.id) || picked.size === 0}
            onChange={(event) => toggle(currentFile.id, event.target.checked)}
          />
          <FileIcon ext={extensionOf(currentFile)} />
          {t("dx.context.current", { name: currentFile.name })}
        </label>
      ) : null}
      <div className="dx-context-list">
        {others.map((file) => (
          <label key={file.id} className="dx-row dx-context-file">
            <input
              type="checkbox"
              name="context-file"
              value={file.id}
              checked={picked.has(file.id)}
              onChange={(event) => toggle(file.id, event.target.checked)}
            />
            <FileIcon ext={extensionOf(file)} />
            {file.name}
          </label>
        ))}
      </div>
      <div className="dx-actions dx-context-more">
        <button
          type="button"
          className="dx-btn"
          data-act="add-picker"
          onClick={() => {
            closeModal();
            request.onChooseFromDisk();
          }}
        >
          {t("dx.context.chooseFromMac")}
        </button>
        <label className="dx-context-output">
          <span>{t("dx.context.createAs")}</span>
          <select value={output} onChange={(event) => setOutput(event.target.value as OutputChoice)}>
            <option value="auto">{t(currentFile ? "dx.context.outputEdit" : "dx.context.outputAuto")}</option>
            <option value="doc">{t("dx.type.docx")}</option>
            <option value="sheet">{t("dx.type.xlsx")}</option>
            <option value="slides">{t("dx.type.pptx")}</option>
          </select>
        </label>
      </div>
      <p className="dx-helper dx-context-recipient">
        {t("dx.context.recipient", { provider: provider || t("dx.context.providerFallback") })}
      </p>
      <div className="dx-form-actions">
        <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
          {t("dx.action.cancel")}
        </button>
        <button
          type="button"
          className="dx-btn dx-primary"
          data-act="context-apply"
          onClick={() => {
            request.onApply({ fileIds: [...picked], output });
            closeModal();
          }}
        >
          {t("dx.context.apply")}
        </button>
      </div>
    </>
  );
}

export function openTaskContext(request: TaskContextRequest) {
  openModal({
    title: translate("dx.context.title"),
    render: () => <TaskContextBody request={request} />,
  });
}
