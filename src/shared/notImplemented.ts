/**
 * A capability the UI has but the service layer cannot deliver yet.
 *
 * The rule this exists to serve: **the UI keeps its buttons.** When a feature
 * has a surface but no implementation behind it, the button stays where the UI
 * layer put it and pressing it says so out loud. It does not get hidden, and it
 * does not fail silently — a dead control that swallows a click is the worst of
 * the three outcomes, because the user cannot tell it apart from a bug in their
 * own file.
 *
 * Distinct from an ordinary `Error` on purpose. The shell shows this as a
 * notice ("not built yet") and a real failure as an error ("something went
 * wrong"), and those are different things to tell someone.
 *
 * `feature` is for us, not the user: it is the stable key that ties the click
 * back to the entry in docs/not-implemented.md.
 */
export class NotImplementedError extends Error {
  readonly feature: string;

  constructor(feature: string, message: string) {
    super(message);
    this.name = "NotImplementedError";
    this.feature = feature;
  }
}

export function isNotImplemented(reason: unknown): reason is NotImplementedError {
  return reason instanceof NotImplementedError;
}
