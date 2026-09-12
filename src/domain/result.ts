/**
 * A small Result type used by the parser (and later layers) to report expected
 * errors without throwing. Success carries a value; failure carries a
 * structured, user-facing error.
 */

/** A structured parse/validation error with a machine code and human message. */
export interface DomainError {
  /** Stable machine-readable code, e.g. "PARSE_INVALID_TOKEN". */
  readonly code: string;
  /** Human-readable, actionable message (English + example where useful). */
  readonly message: string;
  /** Optional 0-based character offset into the raw input. */
  readonly position?: number;
}

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err {
  readonly ok: false;
  readonly error: DomainError;
}

export type Result<T> = Ok<T> | Err;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err(code: string, message: string, position?: number): Err {
  const error: DomainError =
    position === undefined ? { code, message } : { code, message, position };
  return { ok: false, error };
}
