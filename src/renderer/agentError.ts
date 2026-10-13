import { translate } from "./i18n";

const DOCUMENT_ERROR = /not a valid zip|failed to open OOXML|invalid (?:docx|xlsx|pptx)|corrupt(?:ed)? (?:file|document|archive)/i;

/** The input file itself cannot be read: retrying with the same file fails again. */
export function isDocumentError(error: string): boolean {
  return DOCUMENT_ERROR.test(error);
}

/** User-facing failures; the original diagnostic remains on the task's Details. */
export function agentErrorSummary(error: string, options: { resumable?: boolean } = {}): string {
  if (/network|offline|econn|enotfound|socket|dns|\beof\b|connection (?:lost|reset|refused)|fetch failed/i.test(error)) return translate("shell.agent.error.network");
  if (DOCUMENT_ERROR.test(error)) return translate("shell.agent.error.document");
  if (/permission denied|eacces|eperm|read.only file system/i.test(error)) return translate("shell.agent.error.access");
  if (/PPTX (?:expansion|rendering) is incomplete|PPTX content validation|retained completed pages|page_failed|requested exactly \d+ slides?, exported \d+/i.test(error)) {
    // "Retry remaining" is a promise; it is made only when there is something to pick up from (UX30-06).
    return translate(options.resumable === false ? "shell.agent.error.slidesIncomplete" : "shell.agent.error.partialSlides");
  }
  if (/timed? ?out|timeout|deadline exceeded/i.test(error)) return translate("shell.agent.error.timeout");
  if (/\n\s*at\s|thread .+panicked|stack backtrace|Traceback|HideLastTransition must be bool|\.wasm:|RuntimeError:|https?:\/\/|(?:\/Users\/|\/home\/|\/tmp\/|\/var\/|[A-Z]:\\)|OOXML|\b(?:zip|errno|ENOSPC|ENOENT)\b|content generation failed/i.test(error) || error.length > 600) return translate("shell.agent.technicalFailure");
  return error;
}
