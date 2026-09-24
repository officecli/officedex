import { Check, Download, Folder, Image as ImageGlyph, Maximize2, Plus, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useT } from "../../renderer/i18n";
import { toast } from "../../renderer/ui";
import type { Folder as FolderMeta } from "../../shared/uiPort";
import type { useAgentTask } from "../agent/useAgentTask";
import { Menu } from "../chrome/Menu";
import { usePort } from "../port/PortContext";
import { attempt, reportPortFailure } from "../port/reportPortFailure";
import { useShell } from "../state/ShellContext";
import { requestComposerFill } from "./composerFill";
import { aspectLabel, fileBaseName, fileFormat } from "./imageFormat";
import { ImageViewer } from "./ImageViewer";
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
  const [viewing, setViewing] = useState(false);
  const pictureRef = useRef<HTMLImageElement>(null);
  const t = useT();

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
  const title = file ? fileBaseName(file.name) : t("shell.imageWs.title");
  const ratio = size ? aspectLabel(size.width, size.height) : null;
  const defaultFolder = folders.find((folder) => folder.isDefault) ?? null;
  const filed = Boolean(file && defaultFolder && file.folderId !== defaultFolder.id);

  const meta = series.busy
    ? t("shell.imageWs.creating")
    : file && size && format
      ? `${format} · ${size.width} × ${size.height}`
      : t("shell.imageWs.creation");

  const index = selected ? series.versions.findIndex((version) => version.file.id === selected.file.id) : -1;
  const previous = index > 0 ? series.versions[index - 1] : null;
  const next = index >= 0 && index < series.versions.length - 1 ? series.versions[index + 1] : null;
  const openVersion = (version: ImageVersion) => dispatch({ type: "open-file", fileId: version.file.id });

  async function download(fileId: string) {
    const images = port.images;
    if (!images) return;
    try {
      const path = await images.saveCopy(fileId);
      // Cancelling a save dialog is an ordinary thing to do, not a failure.
      if (path) toast.success(t("shell.imageWs.savedTo", { path }));
    } catch (reason) {
      reportPortFailure(reason);
    }
  }

  async function saveToFolder(fileId: string, folder: FolderMeta) {
    if (!(await attempt(() => port.files.move(fileId, folder.id)))) return;
    await reload();
    toast.success(t("shell.imageWs.savedToFolder", { folder: folder.name }));
  }

  return (
    <section className="shell-image-surface" aria-label={t("shell.imageWs.aria")}>
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
              title={port.images ? undefined : t("shell.imageWs.downloadDesktopOnly")}
              onClick={() => void download(file.id)}
            >
              <Download size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("shell.image.viewer.download")}
            </button>

            <Menu
              label={t("shell.imageWs.saveToFolder")}
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
                  {filed ? t("shell.imageWs.savedToFolderState") : t("shell.imageWs.saveToFolder")}
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
            <h2>{t("shell.imageWs.creatingYour")}</h2>
            <p>{t("shell.imageWs.leave")}</p>
            <button type="button" className="shell-image-message-button" onClick={() => void agent.stop()}>
              <Square size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("shell.imageWs.stop")}
            </button>
          </div>
        ) : selected ? (
          <figure className="shell-image-figure">
            {/*
              The picture is the button: clicking what you want to see bigger
              is the one gesture nobody has to be told. The corner badge is the
              telling, for whoever does not try it.
            */}
            <button
              type="button"
              className="shell-image-zoom-trigger"
              aria-label={t("shell.image.viewer.open")}
              title={t("shell.image.viewer.open")}
              disabled={!pictureUrl}
              onClick={() => setViewing(true)}
            >
              <img
                ref={pictureRef}
                src={pictureUrl ?? undefined}
                alt={t("shell.imageWs.version", { version: selected.version })}
                onLoad={(event) =>
                  setSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
              <span className="shell-image-zoom-badge" aria-hidden="true">
                <Maximize2 size={13} strokeWidth={1.8} />
                {t("shell.image.viewer.open")}
              </span>
            </button>
            <figcaption>
              <span>{t("shell.imageWs.version", { version: selected.version })}</span>
              <span>{[ratio, format].filter(Boolean).join(" · ")}</span>
            </figcaption>
          </figure>
        ) : (
          <div className="shell-image-message">
            <ImageGlyph size={30} strokeWidth={1.6} aria-hidden="true" />
            <h2>{t("shell.imageWs.retryTitle")}</h2>
            <p>{t("shell.imageWs.retryBody")}</p>
            <button
              type="button"
              className="shell-image-message-button"
              onClick={() => void retryImageRun(agent, agent.task, series.lastPrompt)}
            >
              <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("shell.imageWs.tryAgain")}
            </button>
          </div>
        )}
      </div>

      {series.versions.length > 0 ? (
        <div className="shell-image-versions">
          <div className="shell-image-versions-head">
            <strong>{t("shell.imageWs.versions")}</strong>
            <span>{t("shell.imageWs.versionsHint")}</span>
          </div>
          <div className="shell-image-version-list" role="group" aria-label={t("shell.imageWs.versionsAria")}>
            {series.versions.map((version) => (
              <VersionTile
                key={version.file.id}
                version={version}
                selected={version.file.id === selectedId}
                onSelect={() => openVersion(version)}
              />
            ))}
            <button
              type="button"
              className="shell-image-new-version"
              onClick={() =>
                requestComposerFill(t("shell.imageWs.anotherPrompt"))
              }
            >
              <Plus size={16} strokeWidth={1.7} aria-hidden="true" />
              {t("shell.imageWs.another")}
            </button>
          </div>
        </div>
      ) : null}

      {viewing && selected && !series.busy ? (
        <ImageViewer
          src={pictureUrl}
          title={title}
          meta={[
            // "1 of 1" says nothing; the position only earns its place once
            // the arrows have somewhere to go.
            series.versions.length > 1
              ? t("shell.image.viewer.position", {
                  version: selected.version,
                  index: index + 1,
                  total: series.versions.length,
                })
              : t("shell.image.viewer.version", { version: selected.version }),
            format,
            size ? `${size.width} × ${size.height}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          natural={size}
          origin={() => pictureRef.current && containedRect(pictureRef.current)}
          onPrevious={previous ? () => openVersion(previous) : undefined}
          onNext={next ? () => openVersion(next) : undefined}
          onDownload={port.images ? () => void download(selected.file.id) : undefined}
          onClose={() => setViewing(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * Where the picture is actually drawn inside its `<img>`.
 *
 * The element is as wide as the canvas allows and `object-fit: contain` letterboxes
 * the picture inside it, so the element's own box is the frame, not the
 * picture. The viewer flies from — and back to — the picture.
 */
function containedRect(image: HTMLImageElement): DOMRect | null {
  const box = image.getBoundingClientRect();
  const { naturalWidth, naturalHeight } = image;
  if (!naturalWidth || !naturalHeight || box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return new DOMRect(box.left + (box.width - width) / 2, box.top + (box.height - height) / 2, width, height);
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
  const t = useT();
  const url = useImageBlobUrl(version.file.id);
  return (
    <button
      type="button"
      className={`shell-image-version${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      aria-label={t("shell.imageWs.selectVersion", { version: version.version })}
      onClick={onSelect}
    >
      <img src={url ?? undefined} alt="" />
      <span>
        {t("shell.imageWs.version", { version: version.version })}
        {selected ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : null}
      </span>
    </button>
  );
}
