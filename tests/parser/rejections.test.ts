/**
 * Invalid sequences must be rejected with a specific, useful message and a
 * stable error code. The four canonical rejection examples (A++, AB+, A+X,
 * ++B) are mandated by the feature acceptance criteria.
 * See docs/PMR3407_RULES.md and requirements REQ-PARSE-REJECT-*.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence, ParseErrorCode } from '../../src/parser/index.ts';

function expectErr(raw: string): { code: string; message: string } {
  const result = parseSequence(raw);
  assert.ok(!result.ok, `expected "${raw}" to be rejected but it parsed`);
  return { code: result.error.code, message: result.error.message };
}

test('A++ is rejected (double sign) with a helpful message', () => {
  const e = expectErr('A++');
  assert.equal(e.code, ParseErrorCode.DOUBLE_SIGN);
  assert.match(e.message, /one direction|A\+\+/);
});

test('AB+ is rejected (actuator without direction) with a helpful message', () => {
  const e = expectErr('AB+');
  assert.equal(e.code, ParseErrorCode.DOUBLE_ACTUATOR);
  assert.match(e.message, /direction|AB\+/);
});

test('A+X is rejected (X has no direction / dangling actuator)', () => {
  const e = expectErr('A+X');
  assert.equal(e.code, ParseErrorCode.MISSING_DIRECTION);
  assert.match(e.message, /direction/);
});

test('++B is rejected (dangling sign) with a helpful message', () => {
  const e = expectErr('++B');
  assert.equal(e.code, ParseErrorCode.DANGLING_SIGN);
  assert.match(e.message, /not attached to an actuator|\+\+B/);
});

test('empty input is rejected', () => {
  const e = expectErr('   ');
  assert.equal(e.code, ParseErrorCode.EMPTY);
});

test('illegal characters are rejected with position', () => {
  const result = parseSequence('A+@B-');
  assert.ok(!result.ok);
  assert.equal(result.error.code, ParseErrorCode.INVALID_CHARACTER);
  assert.equal(result.error.position, 2);
});

test('unbalanced parentheses are rejected', () => {
  assert.equal(expectErr('(A+B+').code, ParseErrorCode.UNBALANCED_PARENS);
  assert.equal(expectErr('A+)B-').code, ParseErrorCode.UNBALANCED_PARENS);
});

test('empty group is rejected', () => {
  assert.equal(expectErr('A+()B-').code, ParseErrorCode.EMPTY_GROUP);
});

test('nested groups are rejected', () => {
  assert.equal(expectErr('((A+))').code, ParseErrorCode.NESTED_GROUP);
});

test('a dangling timer at end of sequence is rejected', () => {
  assert.equal(expectErr('A+T').code, ParseErrorCode.DANGLING_TIMER);
});

test('duplicate actuator in one simultaneous group is rejected', () => {
  assert.equal(expectErr('(A+A-)').code, ParseErrorCode.DUPLICATE_IN_GROUP);
});
