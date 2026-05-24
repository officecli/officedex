import type { DesktopAPI } from "../shared/types";

declare global {
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    officecli: DesktopAPI;
    Module?: {
      wasmBinary?: Uint8Array;
      [key: string]: unknown;
    };
  }
}
