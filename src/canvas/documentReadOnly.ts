import { instructionText } from "../shared/requestIntent";
/** Explicit no-write requests must never reach the editor's apply/save tools. */
export function requestsReadOnlyAnswer(prompt: string): boolean {
  const request = instructionText(prompt).replace(/[^.!?。！？]*(?:until|before approval|yet|批准后|确认后)[^.!?。！？]*/gi, "");
  return /\bread[- ]only\b|只读|不要(?:修改|编辑|保存|创建)(?:任何)?(?:文件|文档)|不(?:修改|编辑)(?:文件|文档)|(?:do not|don't|never)\s+(?:create\s+or\s+)?(?:edit|modify|change|write|save)\s+(?:(?:any|the|this)\s+)?(?:file|document)s?\b|\b(?:reply|answer)\s+(?:exactly|only)\b/i.test(request);
}
