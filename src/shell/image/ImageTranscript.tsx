import { ArrowUpRight, Image as ImageGlyph, RotateCcw } from "lucide-react";
import { Fragment, useState } from "react";

import type { useAgentTask } from "../agent/useAgentTask";
import { useShell } from "../state/ShellContext";
import { aspectLabel } from "./imageFormat";
import { retryImageRun } from "./retryImageRun";
import { useImageBlobUrl } from "./useImageBlobUrl";
import { useImageSeries, type ImageVersion } from "./useImageSeries";
import "./imageTranscript.css";

/**
 * The conversation, when what is being made is a picture.
 *
 * It replaces the generic transcript rather than decorating it, because almost
 * nothing in the generic one applies: an image run has no steps to tick off, no
 * outline, and no suggestion to apply — it either produces a file or it does
 * not. What it has instead is a history of versions, and every message is about
 * one of them.
 *
 * A batch is one message. Asking for four pictures is four runs in the series
 * and one thing the user said, so the four arrive as four result cards under a
 * single bubble; `useImageSeries` does that folding, and this only draws it.
 */
export function ImageTranscript({ agent }: { agent: ReturnType<typeof useAgentTask> }) {
  const { dispatch } = useShell();
  const series = useImageSeries(agent.task);
  const failure = series.failure;

  const open = (version: ImageVersion) =>
    dispatch({ type: "open-file", fileId: version.file.id });

  return (
    <>
      <div className="shell-image-context">
        <ImageGlyph size={14} strokeWidth={1.6} aria-hidden="true" />
        <span>Image creation</span>
      </div>

      {series.batches.map((batch) => (
        <Fragment key={batch.id}>
          <div className="shell-task-user">
            {batch.baseVersion !== null ? (
              <small className="shell-image-based-on">Based on Version {batch.baseVersion}</small>
            ) : null}
            {batch.prompt}
          </div>
          {batch.versions.map((version) => (
            <ImageResultCard key={version.file.id} version={version} onOpen={() => open(version)} />
          ))}
        </Fragment>
      ))}

      {series.busy ? (
        <div className="shell-image-progress" role="status">
          <span className="shell-task-spinner" aria-hidden="true" />
          Creating your image…
        </div>
      ) : null}

      {!series.busy && series.versions.length > 0 ? (
        <p className="shell-image-hint">
          Describe a change below. Your original stays in version history.
        </p>
      ) : null}

      {failure ? (
        <div
          className="shell-image-error"
          role={failure.status === "failed" ? "alert" : "status"}
        >
          {failure.status === "failed"
            ? "The image couldn't be created. Your instructions are saved."
            : "Generation stopped. Your previous images are safe."}
          <button
            type="button"
            className="shell-task-button"
            onClick={() => void retryImageRun(agent, agent.task, failure.prompt)}
          >
            <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : null}
    </>
  );
}

/**
 * The picture a batch produced, as one row of the conversation.
 *
 * It is a button because its whole purpose is to put that version on the
 * canvas: the transcript scrolls, versions accumulate, and scrolling back to a
 * card is how you return to a picture you have moved past.
 */
function ImageResultCard({ version, onOpen }: { version: ImageVersion; onOpen: () => void }) {
  const url = useImageBlobUrl(version.file.id);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const ratio = size ? aspectLabel(size.width, size.height) : null;

  return (
    <button type="button" className="shell-image-result" onClick={onOpen}>
      <img
        src={url ?? undefined}
        alt=""
        onLoad={(event) =>
          setSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
      />
      <span>
        <strong>{version.file.name}</strong>
        <small>{[`Version ${version.version}`, ratio].filter(Boolean).join(" · ")}</small>
      </span>
      <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
