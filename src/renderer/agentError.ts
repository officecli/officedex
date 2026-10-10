import { translate } from "./i18n";

/** User-facing failures; the original diagnostic remains on the task's Details. */
export function agentErrorSummary(error: string): string {
  if (/network|offline|econn|enotfound|socket|dns|\beof\b|connection (?:lost|reset|refused)|fetch failed/i.test(error)) return translate("shell.agent.error.network");
  if (/not a valid zip|failed to open OOXML|invalid (?:docx|xlsx|pptx)|corrupt(?:ed)? (?:file|document|archive)/i.test(error)) return translate("shell.agent.error.document");
  if (/permission denied|eacces|eperm|read.only file system/i.test(error)) return translate("shell.agent.error.access");
  if (/PPTX expansion is incomplete|retained completed pages|page_failed/i.test(error)) return translate("shell.agent.error.partialSlides");
  if (/timed? ?out|timeout|deadline exceeded/i.test(error)) return translate("shell.agent.error.timeout");
  if (/\n\s*at\s|thread .+panicked|stack backtrace|Traceback|HideLastTransition must be bool|\.wasm:|RuntimeError:|https?:\/\/|(?:\/Users\/|\/home\/|\/tmp\/|\/var\/|[A-Z]:\\)|OOXML|\b(?:zip|errno|ENOSPC|ENOENT)\b|content generation failed/i.test(error) || error.length > 600) return translate("shell.agent.technicalFailure");
  return error;
}
