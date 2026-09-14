import type { SVGProps } from "react";

/** Compact outline mark: the detached square shares the body's top/right edges. */
export function OfficeDexOutlineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 2h9a1 1 0 0 1 1 1v1a3.5 3.5 0 0 0 3.5 3.5H21a1 1 0 0 1 1 1V18a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z" />
      <rect x="18" y="2" width="4" height="4" rx="1" />
    </svg>
  );
}
