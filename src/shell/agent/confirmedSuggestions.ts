/**
 * Suggestions this window applied because the user pressed Apply.
 *
 * The port reports a suggestion as applied whether the user approved it or
 * Full access applied it unasked, and the completion card must only say "the
 * changes you approved" for the first (1.0.34 N34-05). Module scope: the id
 * is the port's and outlives the panel that pressed the button.
 */
const confirmed = new Set<string>();

export function rememberConfirmedSuggestion(id: string): void {
  confirmed.add(id);
}

export function wasConfirmedByUser(id: string): boolean {
  return confirmed.has(id);
}
