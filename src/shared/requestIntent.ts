/** Literal document text must not change routing or permission decisions. */
export function instructionText(prompt: string): string {
  const mask = (literal: string) => literal.replace(/[^\n]/g, " ");
  return prompt
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, mask)
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"(?:\\.|[^"\\])*"|`[^`]*`|(?<![\p{L}\p{N}])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}])/gu, (literal) => {
      // Quoted file names still carry an explicit output type. Quoted prose
      // and code remain available in the original prompt sent to the worker.
      const inner = literal.slice(1, -1).trim();
      return /^[^\n"'<>:]+\.(?:docx?|pptx?|xlsx?|png|jpe?g|gif|txt|md|pdf|html?)$/i.test(inner)
        ? literal : mask(literal);
    });
}

/** Shared by the open-editor runner and the background file runner. */
export function reviewRequestedBy(prompt: string): boolean {
  return /先审阅|先审核|先确认|审阅后|审阅一下|先看一下|先看看|先给我看|看过再|确认后再|确认再|等待.{0,12}确认|等我确认|先.{0,12}review|先别(?:改|写|保存|应用)|不要(?:直接|自动)?(?:改|写|保存|应用)|review (?:it |them |this |that )?(?:first|before)|let me review|for (?:my )?review|before (?:you )?apply(?:ing)?|do(?: not|n't) apply|wait.{0,20}(?:approval|confirmation)|approval/i.test(instructionText(prompt));
}
