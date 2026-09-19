import { createContext, useContext, type ReactNode } from "react";

import type { CanvasAdapter } from "../editor/canvasContract";

const CanvasContext = createContext<CanvasAdapter | null>(null);

export function CanvasProvider({
  adapter,
  children,
}: {
  adapter: CanvasAdapter | null;
  children: ReactNode;
}) {
  return <CanvasContext.Provider value={adapter}>{children}</CanvasContext.Provider>;
}

/**
 * The document renderer, when there is one.
 *
 * Null is a normal answer, not an error — that is the difference between this
 * and `usePort`. Outside the desktop app there is no embedded editor to mount,
 * and the shell draws its skeleton instead. Every caller has to handle null,
 * which is what keeps the shell runnable in a plain browser.
 */
export function useCanvas(): CanvasAdapter | null {
  return useContext(CanvasContext);
}
