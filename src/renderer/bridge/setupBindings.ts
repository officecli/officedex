import type { SetupState, DefaultDocumentApp } from "../../shared/types";
// Dedicated typed bindings; Wails exposes every public App method at runtime.
interface SetupBindings {
  GetSetupState(): Promise<SetupState>;
  SaveSetupState(state: SetupState): Promise<void>;
  SetSetupWindow(stage: string): Promise<void>;
  GetDefaultDocumentApps(): Promise<DefaultDocumentApp[]>;
  SetDefaultDocumentApps(extensions: string[]): Promise<DefaultDocumentApp[]>;
  TakeNativeOpenFiles(): Promise<string[]>;
}
export function setupBindings(): SetupBindings {
  return (window as unknown as { go: { main: { App: SetupBindings } } }).go.main.App;
}
