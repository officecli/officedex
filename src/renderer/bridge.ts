// The renderer's one handle on the desktop. The transports and the codec live
// in ./bridge/; this module only instantiates the chosen one at import time,
// which is what every `vi.mock("./bridge")` in the tests replaces.

import type { DesktopAPI } from "../shared/types";
import { createDesktopAPI, readBridgeEnvironment } from "./bridge/select";

export { createRealE2EAPI } from "./bridge/realE2E";
export { normaliseRecentFiles } from "./bridge/codec";

export const officecli: DesktopAPI = createDesktopAPI(readBridgeEnvironment());
