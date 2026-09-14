import type { SVGProps } from "react";

/** Minimal robot mark, shared by the Agent entry and panel heading. */
export function AgentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="4" y="6" width="16" height="13" rx="4.5" />
      <path d="M12 6V4l2-1" />
      <circle cx="9" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 14.5q2.5 2 5 0" strokeWidth={1.3} />
    </svg>
  );
}
