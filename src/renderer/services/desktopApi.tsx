import { createContext, useContext, type ReactNode } from "react";
import type { DesktopAPI } from "../../shared/types";
import { officecli } from "../bridge";

/**
 * The renderer's handle on the desktop, as an injected dependency.
 *
 * `bridge/select.ts` already builds the API from an explicit environment;
 * `bridge.ts` then froze that into a module-level singleton, and 44 files came
 * to import it directly — UI leaves included. That is what makes a view hard to
 * move: a component that reaches for a global cannot be rendered anywhere the
 * global is wrong, which in practice means it can only be rendered here, in
 * this app, in this shape.
 *
 * The default is the singleton, so a subtree without a provider behaves exactly
 * as it did. Once no production code imports `officecli` directly, the default
 * goes away and the provider becomes required.
 */
const DesktopApiContext = createContext<DesktopAPI>(officecli);

/** `api` overrides the transport; tests and embeds pass a fake. */
export function DesktopApiProvider({ api, children }: { api?: DesktopAPI; children: ReactNode }) {
  return <DesktopApiContext.Provider value={api ?? officecli}>{children}</DesktopApiContext.Provider>;
}

export function useDesktopApi(): DesktopAPI {
  return useContext(DesktopApiContext);
}
