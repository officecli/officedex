import { ArrowDownToLine, RotateCcw } from "lucide-react";

import { useT } from "../../renderer/i18n";
import { Modal } from "../../renderer/ui";
import { optionalUpdateVersion, useShellAppUpdate } from "./UpdateGate";

/** Radius of the progress ring, in the 28px button's own coordinates. */
const RING_R = 12;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The sidebar's update button — there only while an optional update waits.
 *
 * Modelled on the desktop coding apps' corner button: an icon of its own beside
 * the gear, wearing a dot while it wants something from the user, and doing the
 * thing when pressed rather than sending anyone to a settings page to find it.
 *
 * One button, four faces, all driven by the gate's single updater:
 *
 * - available / error — download arrow + dot; pressing downloads (again).
 * - downloading       — the arrow inside a progress ring; pressing does nothing.
 * - downloaded        — restart arrow + dot; pressing asks first, then
 *                       installs, which quits the app. The ask is there
 *                       because the icon alone does not say "this closes
 *                       your documents", and an editor may be holding edits.
 * - installing        — restart arrow, inert, while the app hands over.
 *
 * Mandatory updates never reach here (the gate replaces the whole window), and
 * a browser has no updater, so outside the desktop app this renders nothing.
 */
export function UpdateButton() {
  const t = useT();
  const update = useShellAppUpdate();
  const version = optionalUpdateVersion(update);
  if (!update || !version) return null;

  const { phase, progress } = update;
  const downloading = phase === "downloading";
  const ready = phase === "downloaded" || phase === "installing";
  const busy = downloading || phase === "installing";
  const percent =
    progress.bytesTotal > 0 ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100)) : 0;

  const label =
    phase === "error"
      ? t("shell.update.failed", { version })
      : downloading
        ? t("shell.update.downloading", { version, percent })
        : phase === "installing"
          ? t("shell.update.installing", { version })
          : ready
            ? t("shell.update.ready", { version })
            : t("shell.update.available", { version });

  const onClick = () => {
    if (busy) return;
    if (!ready) {
      void update.download();
      return;
    }
    Modal.confirm({
      title: t("shell.update.confirmTitle", { version }),
      content: t("shell.update.confirmBody"),
      okText: t("shell.update.confirmOk"),
      cancelText: t("shell.update.confirmCancel"),
      onOk: () => update.install(),
    });
  };

  // Counter-clockwise on purpose: its arrowhead sits top-left, clear of the dot.
  const Icon = ready ? RotateCcw : ArrowDownToLine;

  return (
    <button
      type="button"
      className="shell-icon-button shell-update-button"
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      data-phase={phase}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
      {downloading ? (
        /*
          Starts at twelve o'clock by rotating inside the SVG. A CSS transform
          would make the button a stacking context, which the z-index ladder
          (test/layers.test.ts) exists to keep accounted for.
        */
        <svg className="shell-update-ring" viewBox="0 0 28 28" aria-hidden="true">
          <circle className="shell-update-ring-track" cx="14" cy="14" r={RING_R} />
          <circle
            transform="rotate(-90 14 14)"
            className="shell-update-ring-head"
            cx="14"
            cy="14"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - percent / 100)}
          />
        </svg>
      ) : null}
      {busy ? null : <span className="shell-update-dot" aria-hidden="true" />}
    </button>
  );
}
