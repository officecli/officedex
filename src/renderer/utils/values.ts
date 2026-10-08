// Leaf module: small coercion helpers for loosely typed bridge payloads.

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Returns the string as-is, or "" for non-strings. */
export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Returns the trimmed string, or "" for non-strings. */
export function trimmedStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
