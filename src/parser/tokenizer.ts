/**
 * Tokenizer for the PMR3407 sequence notation.
 *
 * Grammar (informal):
 *   sequence   := element+
 *   element    := TIMER? ( movement | group )
 *   group      := '(' movement+ ')'
 *   movement   := ACTUATOR SIGN
 *   ACTUATOR   := letter A..Z except reserved 'T' (case-insensitive input)
 *   SIGN       := '+' | '-'
 *   TIMER      := 'T'  (reserved: marks a timer/temporizador delay)
 *
 * Separators: ASCII whitespace and ';' act only as delimiters and are ignored
 * (so "A+B+", "A+ B+", "A+;B+" tokenize identically). See
 * docs/PMR3407_RULES.md, "Sequence notation".
 *
 * The tokenizer performs LEXICAL validation only (illegal characters). Higher
 * level structure (double signs, dangling signs, unbalanced parens) is checked
 * by the parser.
 */

import type { Result } from '../domain/result.ts';
import { err, ok } from '../domain/result.ts';
import { ParseErrorCode } from './errors.ts';

export type TokenType = 'actuator' | 'sign' | 'timer' | 'lparen' | 'rparen';

export interface Token {
  readonly type: TokenType;
  /** Normalized value: uppercase actuator letter, '+'/'-', 'T', '(' or ')'. */
  readonly value: string;
  /** 0-based offset of the token in the raw input. */
  readonly position: number;
}

const LETTER = /^[A-Za-z]$/;
const SEPARATOR = /^[\s;]$/;

/**
 * The reserved timer marker. PMR3407 uses uppercase 'T' as a temporizador
 * prefix, so 'T'/'t' is never treated as an actuator letter. Actuators are
 * therefore A..S and U..Z (T excluded). This is documented as a deliberate
 * design decision in docs/PMR3407_RULES.md, "Ambiguities".
 */
const TIMER_LETTER = 'T';

export function tokenize(raw: string): Result<Token[]> {
  const tokens: Token[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    if (SEPARATOR.test(ch)) {
      continue;
    }
    if (ch === '+' || ch === '-') {
      tokens.push({ type: 'sign', value: ch, position: i });
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(', position: i });
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')', position: i });
      continue;
    }
    if (LETTER.test(ch)) {
      const upper = ch.toUpperCase();
      if (upper === TIMER_LETTER) {
        tokens.push({ type: 'timer', value: 'T', position: i });
      } else {
        tokens.push({ type: 'actuator', value: upper, position: i });
      }
      continue;
    }
    return err(
      ParseErrorCode.INVALID_CHARACTER,
      `Invalid character ${JSON.stringify(ch)} at position ${i}. ` +
        `A sequence may only contain actuator letters (A-Z), the signs '+'/'-', ` +
        `the timer marker 'T', parentheses '()', and separators (space or ';').`,
      i,
    );
  }
  return ok(tokens);
}
