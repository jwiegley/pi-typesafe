/**
 * How messages to the operator name the command that logs in. pi-typesafe's own extension registers `/typesafe`, so
 * that is the default; an embedder that registers its own login command — pi-warden's `/warden enable` — passes its
 * name instead, and every hint this library writes uses it. The hint is text only: it changes no key handling.
 */
export const DEFAULT_LOGIN_HINT = "/typesafe login";

/** The caller's hint, or the default when none was given. A blank string is treated as no hint. */
export function loginHintOf(hint: string | undefined): string {
  return hasLoginHint(hint) ? (hint as string).trim() : DEFAULT_LOGIN_HINT;
}

/** Whether the caller named a command: a blank or absent hint means it did not. */
export function hasLoginHint(hint: string | undefined): boolean {
  return hint !== undefined && hint.trim().length > 0;
}
