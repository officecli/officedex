import type { AgentStatus } from "../port/types";

const FACES: Record<AgentStatus, { label: string; mouth: string; eyes: [number, number] }> = {
  idle: { label: "Agent idle", mouth: "M9 15.2q3 1.6 6 0", eyes: [0, 0] },
  reading: { label: "Agent reading", mouth: "M9 15.4h6", eyes: [-1.1, 0.6] },
  writing: { label: "Agent preparing changes", mouth: "M9.2 15q2.8 2 5.6 0", eyes: [0.9, 0.6] },
  working: { label: "Agent working", mouth: "M9 15.3q3 1.4 6 0", eyes: [0, 0.4] },
  paused: { label: "Agent paused", mouth: "M9.4 15.4h5.2", eyes: [0, -0.4] },
  "awaiting-review": { label: "Agent waiting for review", mouth: "M9 15q3 2.4 6 0", eyes: [0, -0.8] },
  done: { label: "Agent finished", mouth: "M8.8 14.6q3.2 2.8 6.4 0", eyes: [0, 0] },
};

export interface PresenceFaceProps {
  status: AgentStatus;
  /** Shown when a suggestion is waiting while the panel is collapsed. */
  badge?: number;
  size?: number;
}

/**
 * The collapsed presence.
 *
 * One face, seven expressions driven by `AgentStatus`. The prototype drew this
 * twice — once as a non-interactive "status pet" in Agent mode and once as the
 * clickable companion in Editor mode — with the explicit rule that the pet
 * "never opens a conversation". That rule is dropped: a round, animate face is
 * read as clickable, so here it always is (decision 1).
 */
export function PresenceFace({ status, badge, size = 56 }: PresenceFaceProps) {
  const face = FACES[status];
  const [dx, dy] = face.eyes;
  const working = status === "working" || status === "reading" || status === "writing";

  return (
    <span className="shell-face" data-status={status} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className={working ? "is-working" : undefined}>
        <circle className="shell-face-head" cx="12" cy="12" r="11" />
        <circle className="shell-face-eye" cx={9 + dx} cy={10.4 + dy} r="1.35" />
        <circle className="shell-face-eye" cx={15 + dx} cy={10.4 + dy} r="1.35" />
        <path className="shell-face-mouth" d={face.mouth} />
      </svg>
      {badge ? (
        <span className="shell-face-badge" aria-hidden="true">
          {badge}
        </span>
      ) : null}
      <span className="shell-visually-hidden">{face.label}</span>
    </span>
  );
}

export function statusLabel(status: AgentStatus): string {
  return FACES[status].label;
}
