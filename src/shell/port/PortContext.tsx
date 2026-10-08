import { createContext, useContext, type ReactNode } from "react";

import type { UiPort } from "../../shared/uiPort";

const PortContext = createContext<UiPort | null>(null);

export function PortProvider({ port, children }: { port: UiPort; children: ReactNode }) {
  return <PortContext.Provider value={port}>{children}</PortContext.Provider>;
}

/**
 * The shell's only way to reach the outside world. Components import this,
 * never a concrete implementation — `main.tsx` is the single place that knows
 * which port is in play.
 */
export function usePort(): UiPort {
  const port = useContext(PortContext);
  if (!port) throw new Error("usePort must be used inside <PortProvider>");
  return port;
}
