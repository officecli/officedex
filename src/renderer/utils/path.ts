// Leaf module: file path helpers (no app imports).

/** Last non-empty path segment (handles "/" and "\\" separators and trailing slashes). */
export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).filter(Boolean).at(-1) ?? filePath;
}

/** Lower-cased extension without the dot, or "" when absent. */
export function fileExtension(filePath?: string): string {
  if (!filePath) return "";
  const fileName = fileNameFromPath(filePath);
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}
