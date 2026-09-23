import { Check, Download, Folder, Image as ImageGlyph, Plus, RotateCcw, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { toast } from "../../renderer/ui";
import type { Folder as FolderMeta } from "../../shared/uiPort";
import type { useAgentTask } from "../agent/useAgentTask";
import { Menu } from "../chrome/Menu";
import { usePort } from "../port/PortContext";
import { attempt, reportPortFailure } from "../port/reportPortFailure";
import { useShell } from "../state/ShellContext";
import { requestComposerFill } from "./composerFill";
import { aspectLabel, fileBaseName, fileFormat } from "./imageFormat";
import { retryImageRun } from "./retryImageRun";
import { useImageBlobUrl } from "./useImageBlobUrl";
import { useImageSeries, type ImageVersion } from "./useImageSeries";
import "./imageWorkspace.css";

/**
 * The picture, where the document would be.
 *
 * It draws its own `<img>` rather than going through the canvas slot, and it is
 * layered *over* `EditorCanvasHost` rather than replacing it. Both halves of
 * that matter. The host must never unmount (decision 4) — a live editor holding
 * unsaved state has to survive a trip to a picture and back — and the host
 * cannot show the picture anyway outside the desktop build, where there is no
 * adapter registered and it renders a placeholder.
 *
 * So: an absolutely positioned sibling inside `.shell-workspace`, covering the
 * canvas and stopping short of the status bar, which keeps saying what file is
 * open while this is up.
 */
export function ImageWorkspace({ agent }: { agent: ReturnType<typeof useAgentTask> }) {
  const { state, folders, activeFile, dispatch, reload } = useShell();
  const port = usePort();
  const series = useImageSeries(agent.task);
  const selected = series.selected;
  const pictureUrl = useImageBlobUrl(selected?.file.id ?? null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const selectedId = selected?.file.id ?? null;
  useEffect(() => setSize(null), [selectedId]);

  /*
   * When this surface is up.
   *
   * A picture being open is the obvious half. The other half is a run that has
   * not produced one yet — "Creating your image" belongs on the canvas, not in
   * a panel the user may have floated away — and a run that ended without one,
   * which is the only place "Try again" can live.
   *
   * Neither of those outranks a document the user opened. The run is the
   * folder's, not the tab's: clicking a deck while a picture was still being
   * made left "Creating your image" drawn over the deck, with the deck's name
   * in the tab strip and the status bar. Starting a picture clears the open
   * file (`enter-workspace`), so this only stands aside when the user has
   * turned to a document since; the finished picture still opens itself.
   */
  const imageTask = agent.task?.documentType === "img";
  const documentOpen = activeFile !== null && activeFile.type !== "image";
  const visible =
    !state.home &&
    (activeFile?.type === "image" ||
      (imageTask && !documentOpen && (series.busy || (series.failure !== null && series.versions.length === 0))));
  if (!visible) return null;

  const file = selected?.file ?? null;
  const format = file ? fileFormat(file.name) : null;
  const title = file ? fileBaseName(file.name) : "Image";
  const ratio = size ? aspectLabel(size.width, size.height) : null;
  const defaultFolder = folders.find((folder) => folder.isDefault) ?? null;
  const filed = Boolean(file && defaultFolder && file.folderId !== defaultFolder.id);

  const meta = series.busy
    ? "Creating image"
    : file && size && format
      ? `${format} · ${size.width} × ${size.height}`
      : "Image creation";

  async function download(fileId: string) {
    const images = port.images;
    if (!images) return;
    try {
      const path = await images.saveCopy(fileId);
      // Cancelling a save dialog is an ordinary thing to do, not a failure.
      if (path) toast.success(`Saved to ${path}`);
    } catch (reason) {
      reportPortFailure(reason);
    }
  }

  async function saveToFolder(fileId: string, folder: FolderMeta) {
    if (!(await attempt(() => port.files.move(fileId, folder.id)))) return;
    await reload();
    toast.success(`Image saved to ${folder.name}`);
  }

  return (
    <section className="shell-image-surface" aria-label="Image workspace">
      <div className="shell-image-toolbar">
        <div className="shell-image-titles">
          <strong>{title}</strong>
          <span>{meta}</span>
        </div>

        {file ? (
          <div className="shell-image-actions">
            <button
              type="button"
              className="shell-image-action"
              disabled={!port.images}
              title={port.images ? undefined : "Download is available in the desktop app"}
              onClick={() => void download(file.id)}
            >
              <Download size={13} strokeWidth={1.8} aria-hidden="true" />
              Download
            </button>

            <Menu
              label="Save to folder"
              align="end"
              width={220}
              items={folders.map((folder) => ({
                id: folder.id,
                label: folder.name,
                checked: folder.id === file.folderId,
                onSelect: () => void saveToFolder(file.id, folder),
              }))}
            >
              {(trigger) => (
                <button type="button" className="shell-image-action is-primary" {...trigger}>
                  {filed ? (
                    <Check size={13} strokeWidth={1.8} aria-hidden="true" />
                  ) : (
                    <Folder size={13} strokeWidth={1.8} aria-hidden="true" />
                  )}
                  {filed ? "Saved to folder" : "Save to folder"}
                </button>
              )}
            </Menu>
          </div>
        ) : null}
      </div>

      <div className="shell-image-canvas">
        {series.busy ? (
          <div className="shell-image-message" role="status">
            <div className="shell-image-mark">
              <ImageGlyph size={30} strokeWidth={1.6} aria-hidden="true" />
            </div>
            <h2>Creating your image</h2>
            <p>You can leave this task and come back.</p>
            <button type="button" className="shell-image-message-button" onClick={() => void agent.stop()}>
              <Square size={13} strokeWidth={1.8} aria-hidden="true" />
              Stop generation
            </button>
          </div>
        ) : selected ? (
          <figure className="shell-image-figure">
            <img
              src={pictureUrl ?? undefined}
              alt={`Version ${selected.version}`}
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
            <figcaption>
              <span>Version {selected.version}</span>
              <span>{[ratio, format].filter(Boolean).join(" · ")}</span>
            </figcaption>
          </figure>
        ) : (
          <div className="shell-image-message">
            <ImageGlyph size={30} strokeWidth={1.6} aria-hidden="true" />
            <h2>Let’s try that again</h2>
            <p>Your prompt and reference files are still here.</p>
            <button
              type="button"
              className="shell-image-message-button"
              onClick={() => void retryImageRun(agent, agent.task, series.lastPrompt)}
            >
              <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
              Try again
            </button>
          </div>
        )}
      </div>

      {series.versions.length > 0 ? (
        <div className="shell-image-versions">
          <div className="shell-image-versions-head">
            <strong>Versions</strong>
            <span>Your previous images stay here.</span>
          </div>
          <div className="shell-image-version-list" role="group" aria-label="Image versions">
            {series.versions.map((version) => (
              <VersionTile
                key={version.file.id}
                version={version}
                selected={version.file.id === selectedId}
                onSelect={() => dispatch({ type: "open-file", fileId: version.file.id })}
              />
            ))}
            <button
              type="button"
              className="shell-image-new-version"
              onClick={() =>
                requestComposerFill("Create another version with a different composition.")
              }
            >
              <Plus size={16} strokeWidth={1.7} aria-hidden="true" />
              Create another
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function VersionTile({
  version,
  selected,
  onSelect,
}: {
  version: ImageVersion;
  selected: boolean;
  onSelect: () => void;
}) {
  const url = useImageBlobUrl(version.file.id);
  return (
    <button
      type="button"
      className={`shell-image-version${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      aria-label={`Select Version ${version.version}`}
      onClick={onSelect}
    >
      <img src={url ?? undefined} alt="" />
      <span>
        Version {version.version}
        {selected ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : null}
      </span>
    </button>
  );
}
