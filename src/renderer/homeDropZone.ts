/**
 * Native file drops do not include pointer coordinates when they reach the
 * renderer. Home and the project sidebar therefore arm a small shared
 * hand-off before the native drop callback consumes the paths.
 */
export type HomeDropZone = "intake" | "workspaces" | null;

let activeDropZone: HomeDropZone = null;

export function setHomeDropZone(zone: HomeDropZone): void {
  activeDropZone = zone;
}

export function getHomeDropZone(): HomeDropZone {
  return activeDropZone;
}

export function dragHasFiles(event: { dataTransfer?: DataTransfer | null }): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).some((type) => type === "Files" || type === "application/x-moz-file");
}

/** Reset shared state between tests and app teardown. */
export function resetHomeDropZone(): void {
  activeDropZone = null;
}
