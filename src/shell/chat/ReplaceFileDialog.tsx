import { useState } from "react";

import { translate, useT } from "../../renderer/i18n";
import { formatDateTime } from "../kit/format";
import { FileIcon, extensionOf } from "../kit/Icon";
import { closeModal, openModal } from "../kit/layers";
import type { AgentTask, FileMeta, InputFileReplacement } from "../../shared/uiPort";

interface ReplaceFileRequest {
  task: AgentTask;
  /** What the request said, as the user typed it. */
  request: string;
  files: FileMeta[];
  /** The native picker, when the port has one. */
  pickFromDisk?: () => Promise<string[] | null>;
  onRetry: (replacement: InputFileReplacement) => void;
}

type Choice = { kind: "library"; file: FileMeta } | { kind: "disk"; path: string; name: string };

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * "Choose another file" for a run that could not read its input (UX30-03).
 *
 * The general context picker was the wrong tool: it added a reference to an
 * empty draft, so the request, the failed run and the way to try again all
 * dropped out of sight at once. This one belongs to the failed task. It shows
 * what was asked, the file that could not be read beside the one replacing it,
 * and a single action that runs the same request again with the new file.
 * Cancelling touches nothing.
 */
function ReplaceFileBody({ request }: { request: ReplaceFileRequest }) {
  const t = useT();
  const { task, files } = request;
  const old = task.inputFile;
  const [choice, setChoice] = useState<Choice | null>(null);

  const candidates = files.filter((file) => file.type !== "image");
  // Choosing the unreadable file again would fail the same way, so it is said rather than run.
  const same =
    choice !== null &&
    old !== undefined &&
    (choice.kind === "library" ? choice.file.id === old.fileId : choice.path === old.path);
  const chosenName = choice ? (choice.kind === "library" ? choice.file.name : choice.name) : null;
  const oldName = old?.name ?? task.targetFileName ?? t("shell.task.theFile");

  return (
    <>
      <p>{t("dx.replace.intro")}</p>
      <dl className="dx-definition">
        <dt>{t("dx.replace.request")}</dt>
        <dd className="dx-replace-request">{request.request || task.title}</dd>
        <dt>{t("dx.replace.file")}</dt>
        <dd data-replace-change>
          <span className="dx-replace-old">{oldName}</span>
          {" → "}
          <strong>{chosenName ?? t("dx.replace.none")}</strong>
        </dd>
      </dl>
      <div className="dx-context-list" role="radiogroup" aria-label={t("dx.replace.choose")}>
        {candidates.map((file) => (
          <label key={file.id} className="dx-row dx-context-file">
            <input
              type="radio"
              name="replacement-file"
              value={file.id}
              checked={choice?.kind === "library" && choice.file.id === file.id}
              onChange={() => setChoice({ kind: "library", file })}
            />
            <FileIcon ext={extensionOf(file)} />
            <span className="dx-context-name">
              <span className="dx-ellipsis">{file.name}</span>
              <small className="dx-metadata dx-ellipsis">
                {[
                  file.id === old?.fileId ? t("dx.replace.unreadable") : "",
                  file.updatedAt ? t("dx.context.modified", { time: formatDateTime(file.updatedAt) }) : "",
                ].filter(Boolean).join(" · ")}
              </small>
            </span>
          </label>
        ))}
        {choice?.kind === "disk" ? (
          <label className="dx-row dx-context-file">
            <input type="radio" name="replacement-file" value={choice.path} checked readOnly />
            <FileIcon ext={choice.name.split(".").pop() ?? ""} />
            <span className="dx-context-name" title={choice.path}>
              <span className="dx-ellipsis">{choice.name}</span>
              <small className="dx-metadata dx-ellipsis">{choice.path}</small>
            </span>
          </label>
        ) : null}
      </div>
      {request.pickFromDisk ? (
        <div className="dx-actions dx-context-more">
          <button
            type="button"
            className="dx-btn"
            data-act="replace-pick"
            onClick={() =>
              void request.pickFromDisk!().then((paths) => {
                // Dismissing the picker leaves the choice, and the task, as they were.
                if (paths && paths.length > 0) setChoice({ kind: "disk", path: paths[0], name: baseName(paths[0]) });
              })
            }
          >
            {t("dx.context.chooseFromMac")}
          </button>
        </div>
      ) : null}
      {same ? (
        <p className="dx-error" role="alert" data-replace-same>
          {t("dx.replace.same", { name: oldName })}
        </p>
      ) : null}
      <div className="dx-form-actions">
        <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
          {t("dx.action.cancel")}
        </button>
        <button
          type="button"
          className="dx-btn dx-primary"
          data-act="replace-retry"
          disabled={!choice || same}
          onClick={() => {
            if (!choice || same) return;
            request.onRetry(choice.kind === "library" ? { fileId: choice.file.id } : { path: choice.path, name: choice.name });
            closeModal();
          }}
        >
          {t("dx.replace.retry")}
        </button>
      </div>
    </>
  );
}

export function openReplaceFile(request: ReplaceFileRequest) {
  openModal({
    title: translate("dx.replace.title"),
    render: () => <ReplaceFileBody request={request} />,
  });
}
