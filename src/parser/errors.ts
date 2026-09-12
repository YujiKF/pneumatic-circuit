/**
 * Parser error codes. Kept in one place so tests can assert on stable codes
 * while messages stay human-friendly.
 */

export const ParseErrorCode = {
  EMPTY: 'PARSE_EMPTY',
  INVALID_CHARACTER: 'PARSE_INVALID_CHARACTER',
  MISSING_DIRECTION: 'PARSE_MISSING_DIRECTION',
  DOUBLE_SIGN: 'PARSE_DOUBLE_SIGN',
  DANGLING_SIGN: 'PARSE_DANGLING_SIGN',
  DOUBLE_ACTUATOR: 'PARSE_DOUBLE_ACTUATOR',
  UNBALANCED_PARENS: 'PARSE_UNBALANCED_PARENS',
  EMPTY_GROUP: 'PARSE_EMPTY_GROUP',
  DANGLING_TIMER: 'PARSE_DANGLING_TIMER',
  NESTED_GROUP: 'PARSE_NESTED_GROUP',
  DUPLICATE_IN_GROUP: 'PARSE_DUPLICATE_IN_GROUP',
} as const;

export type ParseErrorCode =
  (typeof ParseErrorCode)[keyof typeof ParseErrorCode];
