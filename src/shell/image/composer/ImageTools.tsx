import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  Aperture,
  AtSign,
  Box,
  Camera,
  Check,
  ChevronDown,
  Focus,
  Image as ImageIcon,
  ImagePlus,
  MoveHorizontal,
  Palette,
  Sparkles,
  Type,
  X,
} from "lucide-react";

import {
  CAMERA_FIELDS,
  IMAGE_COUNTS,
  IMAGE_RATIOS,
  IMAGE_RESOLUTIONS,
  IMAGE_STYLES,
  MAX_IMAGE_EDGE,
  MIN_IMAGE_EDGE,
  imageDimensions,
  imageSizeProblem,
} from "../../../shared/imageGeneration";
import { translate, useT } from "../../../renderer/i18n";
import { notBuiltYet } from "../../port/reportPortFailure";
import { useImageBlobUrl } from "../useImageBlobUrl";
import type { ImageEditTarget } from "../useImageEditTarget";
import { useLibraryActions } from "../../nav/useLibraryActions";
import { ImagePopover } from "./ImagePopover";
import { useReferenceImport } from "./ReferenceList";
import type { ImageDraft } from "./imageDraft";

/**
 * The image composer's tool strip.
 *
 * Every control here maps to something the runtime receives, with one
 * exception: the model. The runtime picks the image model itself and takes no
 * per-request override, so the list shows what exists and only Auto can be
 * chosen — the others say so rather than pretending to switch.
 */

type ToolName = "settings" | "camera" | "style";

interface ImageModelOption {
  id: string;
  name: string;
  mark: ReactNode;
  tone: string;
  detail: string;
  available: boolean;
}

const MODELS: ImageModelOption[] = [
  { id: "auto", name: "shell.cx.output.autoName", mark: <Sparkles size={14} strokeWidth={1.7} aria-hidden="true" />, tone: "auto", detail: "Let OfficeDex choose for this task.", available: true },
  { id: "seedream", name: "Seedream 5.0 Pro", mark: "SD", tone: "seedream", detail: "Rich compositions and text-led visuals.", available: false },
  { id: "gpt-image", name: "GPT Image 2", mark: "GPT", tone: "gpt", detail: "Precise instructions and image editing.", available: false },
  { id: "nano-banana", name: "Nano Banana 2", mark: "NB", tone: "banana", detail: "Fast exploration with image references.", available: false },
];

const CAMERA_ICONS = {
  body: <Camera size={30} strokeWidth={1.1} aria-hidden="true" />,
  lens: <Focus size={30} strokeWidth={1.1} aria-hidden="true" />,
  focal: <MoveHorizontal size={30} strokeWidth={1.1} aria-hidden="true" />,
  aperture: <Aperture size={30} strokeWidth={1.1} aria-hidden="true" />,
};

function RatioGlyph({ ratio }: { ratio: string }) {
  if (ratio === "auto") return <Sparkles size={18} strokeWidth={1.5} aria-hidden="true" />;
  const [w, h] = ratio.split(":").map(Number);
  const aspect = w / h || 1;
  const width = aspect >= 1 ? 16 : 16 * aspect;
  const height = aspect >= 1 ? 16 / aspect : 16;
  return (
    <svg className="shell-ig-ratio-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <rect x={(20 - width) / 2} y={(20 - height) / 2} width={width} height={height} rx="2" />
    </svg>
  );
}

const ratioLabel = (ratio: string) =>
  ratio === "auto" ? translate("shell.cx.output.autoName") : ratio === "custom" ? translate("shell.cx.permission.custom") : ratio;

/** The model's name as shown. Auto's is a dictionary key; the others are product names. */
const modelName = (model: ImageModelOption, t: (key: string) => string) => (model.id === "auto" ? t(model.name) : model.name);

export interface ImageToolsProps {
  draft: ImageDraft;
  onChange: (patch: Partial<ImageDraft>) => void;
  /**
   * Leaves image mode. The words typed so far stay in the composer. Absent
   * beside an image task: there the only thing a message can do is change it.
   */
  onExit?: () => void;
  onMention: () => void;
  /** Wraps the selection in quotes — words the picture should show. */
  onQuoteText: () => void;
  disabled: boolean;
  /**
   * The task column's strip. The mode label and the model move up into
   * `ImageComposerHeader`, the reference tiles into a row above the prompt,
   * and adding a reference becomes the strip's first tool — so what is left
   * fits one line beside the send button in a 300px column.
   */
  compact?: boolean;
}

export function ImageTools({ draft, onChange, onExit, onMention, onQuoteText, disabled, compact = false }: ImageToolsProps) {
  const t = useT();
  const [open, setOpen] = useState<ToolName | null>(null);
  const anchors = {
    settings: useRef<HTMLButtonElement>(null),
    camera: useRef<HTMLButtonElement>(null),
    style: useRef<HTMLButtonElement>(null),
  };
  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen((current) => {
        if (returnFocus && current) queueMicrotask(() => anchors[current].current?.focus());
        return null;
      });
    },
    // The refs are stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const toggle = (name: ToolName) => setOpen((current) => (current === name ? null : name));
  const references = useReferenceImport({
    references: draft.references,
    onChange: (next) => onChange({ references: next }),
  });

  const tool = (name: ToolName, label: string, content: ReactNode, set = false, chevron = true) => (
    <button
      ref={anchors[name]}
      type="button"
      className={`shell-ig-tool shell-ig-tool--${name}${set ? " is-set" : ""}`}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={open === name}
      disabled={disabled}
      onClick={() => toggle(name)}
    >
      {content}
      {chevron ? <ChevronDown className="shell-ig-chevron" size={12} strokeWidth={1.8} aria-hidden="true" /> : null}
    </button>
  );

  return (
    <div className={`shell-ig-tools${compact ? " is-compact" : ""}`} role="group" aria-label={t("shell.imageTool.options")}>
      {compact ? (
        references.available ? (
          <>
            <button
              type="button"
              className="shell-ig-tool shell-ig-tool--reference"
              aria-label={t("shell.imageTool.addReference")}
              title={references.full ? t("shell.imageTool.referencesFull") : t("shell.imageTool.addReferenceTitle")}
              disabled={disabled || references.full}
              onClick={references.add}
            >
              <ImagePlus size={16} strokeWidth={1.65} aria-hidden="true" />
            </button>
            {references.input}
          </>
        ) : null
      ) : <>
      <span className="shell-ig-mode">
        <ImageIcon size={16} strokeWidth={1.65} aria-hidden="true" />
        <span>{t("shell.imageWs.title")}</span>
        {onExit ? (
          <button
            type="button"
            className="shell-ig-mode-close"
            aria-label={t("shell.imageTool.exit")}
            title={t("shell.imageTool.exit")}
            disabled={disabled}
            onClick={onExit}
          >
            <X size={12} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
      </span>

      <ImageModelButton draft={draft} onChange={onChange} disabled={disabled} />
      </>}
      {tool(
        "settings",
        t("shell.imageTool.settings"),
        <>
          <RatioGlyph ratio={draft.ratio === "custom" ? "1:1" : draft.ratio} />
          <span className="shell-ig-tool-name">
            {draft.ratio === "custom" && draft.width && draft.height ? `${draft.width}×${draft.height}` : ratioLabel(draft.ratio)}
            <i aria-hidden="true">·</i>
            {draft.resolution}
            <i aria-hidden="true">·</i>
            {draft.count}
          </span>
        </>,
      )}

      {compact ? null : <span className="shell-ig-divider" aria-hidden="true" />}

      <button
        type="button"
        className="shell-ig-tool shell-ig-tool--text"
        aria-label={t("shell.imageTool.addText")}
        title={t("shell.imageTool.addText")}
        disabled={disabled}
        onClick={onQuoteText}
      >
        <Type size={16} strokeWidth={1.65} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="shell-ig-tool shell-ig-tool--mention"
        aria-label={t("shell.imageTool.mention")}
        title={t("shell.imageTool.mention")}
        disabled={disabled}
        onClick={onMention}
      >
        <AtSign size={16} strokeWidth={1.65} aria-hidden="true" />
      </button>
      {tool(
        "camera",
        t("shell.imageTool.camera"),
        <>
          <Camera size={16} strokeWidth={1.65} aria-hidden="true" />
          {draft.camera.enabled ? <span className="shell-ig-dot" aria-hidden="true" /> : null}
        </>,
        draft.camera.enabled,
        !compact,
      )}
      {tool("style", t("shell.imageTool.style"), <Palette size={16} strokeWidth={1.65} aria-hidden="true" />, draft.style !== "auto", !compact)}

      {open === "settings" ? (
        <ImagePopover anchor={anchors.settings} title={t("shell.imageTool.settings")} width={350} onClose={close}>
          <SettingsPanel draft={draft} onChange={onChange} />
        </ImagePopover>
      ) : null}

      {open === "camera" ? (
        <ImagePopover anchor={anchors.camera} title={t("shell.imageTool.cameraTitle")} width={520} onClose={close}>
          <div className="shell-ig-camera-switch">
            <span>{t("shell.imageTool.useCamera")}</span>
            <button
              type="button"
              className="shell-ig-switch"
              role="switch"
              aria-label={t("shell.imageTool.useCamera")}
              aria-checked={draft.camera.enabled}
              onClick={() => onChange({ camera: { ...draft.camera, enabled: !draft.camera.enabled } })}
            >
              <span />
            </button>
          </div>
          <p className="shell-ig-hint">{t("shell.imageTool.cameraHint")}</p>
          <div className="shell-ig-camera-grid" data-muted={String(!draft.camera.enabled)}>
            {CAMERA_FIELDS.map((field) => (
              <div key={field.key} className="shell-ig-camera-column">
                <span className="shell-ig-camera-label">{t(`shell.imageTool.cameraField.${field.key}`)}</span>
                <div className="shell-ig-camera-symbol">{CAMERA_ICONS[field.key]}</div>
                <label className="shell-ig-camera-select">
                  <select
                    aria-label={t(`shell.imageTool.cameraField.${field.key}`)}
                    value={draft.camera[field.key]}
                    disabled={!draft.camera.enabled}
                    onChange={(event) => onChange({ camera: { ...draft.camera, [field.key]: event.target.value } })}
                  >
                    {field.values.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <ChevronDown className="shell-ig-chevron" size={11} strokeWidth={1.8} aria-hidden="true" />
                </label>
              </div>
            ))}
          </div>
        </ImagePopover>
      ) : null}

      {open === "style" ? (
        <ImagePopover anchor={anchors.style} title={t("shell.imageTool.style")} width={350} onClose={close}>
          <div className="shell-ig-list" role="radiogroup" aria-label={t("shell.imageTool.styles")}>
            {IMAGE_STYLES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="radio"
                aria-checked={draft.style === entry.value}
                className={draft.style === entry.value ? "is-selected" : undefined}
                onClick={() => {
                  onChange({ style: entry.value });
                  close(true);
                }}
              >
                <span className={`shell-ig-swatch is-${entry.value}`}>
                  {entry.value === "auto" ? (
                    <Sparkles size={15} strokeWidth={1.6} aria-hidden="true" />
                  ) : (
                    <Palette size={15} strokeWidth={1.6} aria-hidden="true" />
                  )}
                </span>
                <span>
                  <strong>{t(`shell.imageTool.styleName.${entry.value}`)}</strong>
                  <small>{t(`shell.imageTool.styleDetail.${entry.value}`)}</small>
                </span>
                {draft.style === entry.value ? <Check size={15} strokeWidth={1.8} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        </ImagePopover>
      ) : null}
    </div>
  );
}

/** The model, as a button that opens its list. Home's strip and the task column's header both use it. */
function ImageModelButton({
  draft,
  onChange,
  disabled,
  quiet = false,
}: {
  draft: ImageDraft;
  onChange: (patch: Partial<ImageDraft>) => void;
  disabled: boolean;
  /** In the header: no icon box, smaller type — it is a setting there, not a tool. */
  quiet?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const model = MODELS.find((entry) => entry.id === draft.modelId) ?? MODELS[0];
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) queueMicrotask(() => anchor.current?.focus());
  }, []);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`shell-ig-tool shell-ig-tool--model${quiet ? " is-quiet" : ""}`}
        aria-label={t("shell.imageTool.chooseModel")}
        title={t("shell.imageTool.chooseModel")}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {quiet ? <Sparkles size={13} strokeWidth={1.7} aria-hidden="true" /> : <Box size={16} strokeWidth={1.65} aria-hidden="true" />}
        <span className="shell-ig-tool-name">{modelName(model, t)}</span>
        <ChevronDown className="shell-ig-chevron" size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open ? (
        <ImagePopover anchor={anchor} title={t("shell.imageTool.model")} width={350} onClose={close}>
          <div className="shell-ig-list" role="radiogroup" aria-label={t("shell.imageTool.models")}>
            {MODELS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={entry.id === model.id}
                className={entry.id === model.id ? "is-selected" : undefined}
                onClick={() => {
                  if (!entry.available) {
                    notBuiltYet(
                      "composer.image.model",
                      t("shell.imageTool.modelNotBuilt", { name: entry.name }),
                    );
                    return;
                  }
                  onChange({ modelId: entry.id });
                  close(true);
                }}
              >
                <span className={`shell-ig-mark is-${entry.tone}`}>{entry.mark}</span>
                <span>
                  <strong>{modelName(entry, t)}</strong>
                  <small>{t(`shell.imageTool.modelDetail.${entry.id}`)}</small>
                </span>
                {entry.id === model.id ? <Check size={15} strokeWidth={1.8} aria-hidden="true" /> : null}
                {!entry.available ? <em className="shell-ig-soon">{t("shell.imageTool.soon")}</em> : null}
              </button>
            ))}
          </div>
        </ImagePopover>
      ) : null}
    </>
  );
}

/**
 * The top line of the composer in the task column: what this message acts on,
 * and with which model.
 *
 * "Editing Version 2" used to float above the card as a separate bar; it is
 * the most important fact about the message, so it now opens the card itself,
 * with the version's thumbnail so "Version 2" is a picture rather than a
 * number to look up. With nothing open it says "New image", and — when the
 * composer can leave image mode — carries the way out.
 *
 * A version the shell picked (`source: "latest"` — nothing is open, so the
 * message continues from the newest) is said differently from one the user
 * opened: it is marked as the latest, the thumbnail opens it on the canvas so
 * "which picture?" is one click from an answer, and "New image instead" turns
 * the message back into a new picture. Declined, the header says "New image"
 * and keeps the way back.
 */
export function ImageComposerHeader({
  draft,
  onChange,
  onExit,
  disabled,
  target,
  declined,
  onDecline,
  onRestore,
}: {
  draft: ImageDraft;
  onChange: (patch: Partial<ImageDraft>) => void;
  onExit?: () => void;
  disabled: boolean;
  /** The version this message changes, or null for a new picture. */
  target: ImageEditTarget | null;
  /** The version the shell picked and the user turned down, if any. */
  declined?: ImageEditTarget | null;
  onDecline?: () => void;
  onRestore?: () => void;
}) {
  const t = useT();
  const actions = useLibraryActions();
  const thumb = useImageBlobUrl(target?.fileId ?? null);
  const picked = target?.source === "latest";

  const face = (
    <>
      {target && thumb ? (
        <img className="shell-ig-head-thumb" src={thumb} alt="" draggable={false} />
      ) : (
        <span className="shell-ig-head-glyph" aria-hidden="true">
          <ImageIcon size={13} strokeWidth={1.7} />
        </span>
      )}
      <span className="shell-ig-head-label">
        {target
          ? t(picked ? "shell.imageTool.editingLatest" : "shell.imageTool.editingVersion", { version: target.version })
          : t("shell.imageTool.newImage")}
      </span>
      {target ? (
        <span className="shell-ig-head-note">
          {t(picked ? "shell.imageTool.latestNote" : "shell.imageTool.originalPreserved")}
        </span>
      ) : null}
    </>
  );

  return (
    <div className="shell-ig-head" data-target={target?.source ?? (declined ? "declined" : "none")}>
      {picked && target ? (
        <button
          type="button"
          className="shell-ig-head-target is-button"
          title={t("shell.imageTool.latestTitle")}
          onClick={() => void actions.openFile(target.fileId)}
        >
          {face}
        </button>
      ) : (
        <span
          className="shell-ig-head-target"
          title={target ? t("shell.imageTool.newVersionTitle") : undefined}
        >
          {face}
        </span>
      )}
      {picked && onDecline ? (
        <button
          type="button"
          className="shell-ig-head-switch"
          disabled={disabled}
          onClick={onDecline}
        >
          <ImagePlus size={13} strokeWidth={1.7} aria-hidden="true" />
          {t("shell.imageTool.newImageInstead")}
        </button>
      ) : null}
      {!target && declined && onRestore ? (
        <button
          type="button"
          className="shell-ig-head-switch"
          disabled={disabled}
          onClick={onRestore}
        >
          {t("shell.imageTool.backToVersion", { version: declined.version })}
        </button>
      ) : null}
      <ImageModelButton draft={draft} onChange={onChange} disabled={disabled} quiet />
      {onExit ? (
        <button
          type="button"
          className="shell-ig-head-exit"
          aria-label={t("shell.imageTool.exit")}
          title={t("shell.imageTool.exit")}
          disabled={disabled}
          onClick={onExit}
        >
          <X size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function SettingsPanel({ draft, onChange }: { draft: ImageDraft; onChange: (patch: Partial<ImageDraft>) => void }) {
  const t = useT();
  const [width, height] = imageDimensions(draft);
  const [error, setError] = useState<string | null>(null);
  // Typed text, kept apart from the draft so a half-typed "20" is not rejected mid-word.
  const [typed, setTyped] = useState<{ width: string; height: string } | null>(null);

  const commit = (edge: "width" | "height", raw: string) => {
    const next = { width: String(width), height: String(height), ...typed, [edge]: raw };
    setTyped(next);
    const size = { width: Number(next.width), height: Number(next.height) };
    const problem = imageSizeProblem(size.width, size.height);
    setError(problem);
    if (!problem) onChange({ ratio: "custom", ...size });
  };

  return (
    <>
      <div className="shell-ig-block">
        <h3>{t("shell.imageTool.aspect")}</h3>
        <div className="shell-ig-ratios" role="radiogroup" aria-label={t("shell.imageTool.aspectAria")}>
          {IMAGE_RATIOS.map((ratio) => (
            <button
              key={ratio}
              type="button"
              role="radio"
              aria-checked={draft.ratio === ratio}
              aria-label={ratioLabel(ratio)}
              className={draft.ratio === ratio ? "is-selected" : undefined}
              onClick={() => {
                setTyped(null);
                setError(null);
                onChange({ ratio, width: undefined, height: undefined });
              }}
            >
              <RatioGlyph ratio={ratio} />
              <span>{ratioLabel(ratio)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="shell-ig-block">
        <h3>{t("shell.imageTool.resolution")}</h3>
        <div className="shell-ig-segments" role="radiogroup" aria-label={t("shell.imageTool.resolutionAria")}>
          {IMAGE_RESOLUTIONS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="radio"
              aria-checked={draft.resolution === entry.value}
              aria-label={entry.value}
              className={draft.resolution === entry.value ? "is-selected" : undefined}
              onClick={() => {
                setTyped(null);
                onChange({ resolution: entry.value });
              }}
            >
              <span>{t(`shell.imageTool.resolution.${entry.value}`)}</span>
              <strong>{entry.value}</strong>
            </button>
          ))}
        </div>
      </div>
      <div className="shell-ig-block">
        <h3>{t("shell.imageTool.count")}</h3>
        <div className="shell-ig-segments shell-ig-count" role="radiogroup" aria-label={t("shell.imageTool.count")}>
          {IMAGE_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              role="radio"
              aria-checked={draft.count === count}
              aria-label={t(count === 1 ? "shell.imageTool.countOne" : "shell.imageTool.countMany", { count })}
              className={draft.count === count ? "is-selected" : undefined}
              onClick={() => onChange({ count })}
            >
              {count}
            </button>
          ))}
        </div>
      </div>
      <div className="shell-ig-block">
        <h3>
          {t("shell.imageTool.size")} <span>px</span>
        </h3>
        <div className="shell-ig-dimensions">
          {(["width", "height"] as const).map((edge, index) => (
            <label key={edge}>
              <span>{edge === "width" ? t("shell.imageTool.widthShort") : t("shell.imageTool.heightShort")}</span>
              <input
                type="number"
                min={MIN_IMAGE_EDGE}
                max={MAX_IMAGE_EDGE}
                step={1}
                aria-label={edge === "width" ? t("shell.imageTool.widthAria") : t("shell.imageTool.heightAria")}
                aria-invalid={error && typed?.[edge] !== undefined ? true : undefined}
                value={typed?.[edge] ?? String(index === 0 ? width : height)}
                onChange={(event) => commit(edge, event.target.value)}
              />
            </label>
          ))}
        </div>
        {error ? (
          <p className="shell-ig-error" role="alert">
            {error}
          </p>
        ) : null}
        {draft.ratio === "auto" ? <p className="shell-ig-hint">{t("shell.imageTool.autoHint")}</p> : null}
      </div>
    </>
  );
}

/** Style and camera, when set, as removable chips above the tool strip. */
export function ImageSummary({ draft, onChange, disabled }: { draft: ImageDraft; onChange: (patch: Partial<ImageDraft>) => void; disabled: boolean }) {
  const t = useT();
  const style = IMAGE_STYLES.find((entry) => entry.value === draft.style);
  if (draft.style === "auto" && !draft.camera.enabled) return null;
  return (
    <div className="shell-ig-summary">
      {style && style.value !== "auto" ? (
        <button type="button" disabled={disabled} aria-label={t("shell.imageTool.removeStyle")} title={t("shell.imageTool.removeStyle")} onClick={() => onChange({ style: "auto" })}>
          <Palette size={14} strokeWidth={1.65} aria-hidden="true" />
          <span>{t(`shell.imageTool.styleName.${style.value}`)}</span>
          <X size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
      {draft.camera.enabled ? (
        <button
          type="button"
          disabled={disabled}
          aria-label={t("shell.imageTool.removeCamera")}
          title={t("shell.imageTool.removeCamera")}
          onClick={() => onChange({ camera: { ...draft.camera, enabled: false } })}
        >
          <Camera size={14} strokeWidth={1.65} aria-hidden="true" />
          <span>
            {draft.camera.body} · {draft.camera.focal} · {draft.camera.aperture}
          </span>
          <X size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
