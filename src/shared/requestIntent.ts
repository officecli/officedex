/** Literal document text must not change routing or permission decisions. */
export function instructionText(prompt: string): string {
  const mask = (literal: string) => literal.replace(/[^\n]/g, " ");
  return prompt
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, mask)
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"(?:\\.|[^"\\])*"|`[^`]*`|(?<![\p{L}\p{N}])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}])/gu, (literal) => {
      // Keep only the type from a quoted filename. Its basename may itself
      // contain words like "create a document" or "do not apply". The full
      // name and all literal text remain in the original worker prompt.
      const inner = literal.slice(1, -1).trim();
      return /^[^\n"'<>:]+\.(?:docx?|pptx?|xlsx?|png|jpe?g|gif|txt|md|pdf|html?)$/i.test(inner)
        ? `file${inner.slice(inner.lastIndexOf("."))}` : mask(literal);
    });
}

/** Shared by the open-editor runner and the background file runner. */
export function reviewRequestedBy(prompt: string): boolean {
  return /先审阅|先审核|先确认|审阅后|审阅一下|先看一下|先看看|先给我看|看过再|确认后再|确认再|等待.{0,12}确认|等我确认|先.{0,12}review|先别(?:改|写|保存|应用)|不要(?:直接|自动)?(?:改|写|保存|应用)|review (?:it |them |this |that )?(?:first|before)|let me review|for (?:my )?review|before (?:you )?apply(?:ing)?|do(?: not|n't) apply|wait.{0,20}(?:approval|confirmation)|approval/i.test(instructionText(prompt));
}

/** An output copy is a deliverable, not permission to overwrite its source. */
export function requestsCopyOnly(prompt: string): boolean {
  const text = instructionText(prompt);
  // 「不要生成说明文档或副本」 forbids a copy; it must not ask for one.
  const positive = text.replace(/(?:不要|不需要|无需|不用|不必|禁止|别|do not|don't|never|no need to)\s*(?:再|也|直接|另外)?\s*(?:另存|保存|生成|输出|创建|新建|save|create|write|produce|return|make)[^\n;；。.!?]*/gi, "");
  return /(?:另存|保存|生成|输出).{0,12}(?:副本|拷贝)|(?:save|create|write|produce|return).{0,35}\b(?:copies|copy)\b/i.test(positive)
    || /(?:保留|不改|不覆盖|不要覆盖|保持).{0,8}(?:原件|原文件|原文档)|\b(?:keep|leave|preserve).{0,20}\boriginals?\b|\b(?:do not|don't|never)\s+overwrite\b/i.test(text);
}
