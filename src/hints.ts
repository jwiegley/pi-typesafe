/**
 * How messages to the operator name the command that logs in. pi-typesafe's own extension registers `/typesafe`, so
 * that is the default; an embedder that registers its own login command — pi-warden's `/warden enable` — passes its
 * name instead, and every hint this library writes uses it. The hint is text only: it changes no key handling.
 */
export const DEFAULT_LOGIN_HINT = "/typesafe login";

/**
 * The caller's hint, or the default when none was given. A blank string is treated as no hint. `backend` is the
 * registry name the default command takes (`/typesafe login openrouter`); a caller's own hint is used as written,
 * because only the caller knows what its command takes.
 */
export function loginHintOf(hint: string | undefined, backend?: string): string {
  const named = hint?.trim();
  if (named) return named;
  return backend ? `${DEFAULT_LOGIN_HINT} ${backend}` : DEFAULT_LOGIN_HINT;
}

/** Whether the caller named a command: a blank or absent hint means it did not. */
export function hasLoginHint(hint: string | undefined): boolean {
  return hint !== undefined && hint.trim().length > 0;
}
