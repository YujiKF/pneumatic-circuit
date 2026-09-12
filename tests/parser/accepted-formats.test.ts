/**
 * The parser must accept every documented dialect and normalize them to the
 * SAME canonical SequenceModel. See docs/PMR3407_RULES.md, "Sequence notation"
 * and requirements REQ-PARSE-*.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import type { SequenceModel } from '../../src/domain/index.ts';

function expectOk(raw: string): SequenceModel {
  const result = parseSequence(raw);
  assert.ok(result.ok, `expected "${raw}" to parse, got error: ${result.ok ? '' : result.error.message}`);
  return result.value;
}

test('all four A+B+A-B- dialects produce an identical canonical model', () => {
  const compact = expectOk('A+B+A-B-');
  const spaced = expectOk('A+ B+ A- B-');
  const semicolon = expectOk('A+;B+;A-;B-');
  const lower = expectOk('a+b+a-b-');

  assert.equal(compact.canonical, 'A+B+A-B-');
  assert.equal(spaced.canonical, compact.canonical);
  assert.equal(semicolon.canonical, compact.canonical);
  assert.equal(lower.canonical, compact.canonical);

  assert.deepEqual(spaced, compact);
  assert.deepEqual(semicolon, compact);
  assert.deepEqual(lower, compact);
});

test('lowercase input is normalized to uppercase actuators', () => {
  const model = expectOk('a+b-c+');
  assert.deepEqual(model.actuators, ['A', 'B', 'C']);
  assert.equal(model.canonical, 'A+B-C+');
});

test('one movement per step by default', () => {
  const model = expectOk('A+B+A-B-');
  assert.equal(model.steps.length, 4);
  for (const step of model.steps) {
    assert.equal(step.movements.length, 1);
    assert.equal(step.hasTimer, false);
  }
  assert.deepEqual(model.steps[0]?.movements[0], { actuator: 'A', direction: '+' });
  assert.deepEqual(model.steps[3]?.movements[0], { actuator: 'B', direction: '-' });
});

test('mixed separators in one string are tolerated', () => {
  const model = expectOk('A+ ;B+; A-  B-');
  assert.equal(model.canonical, 'A+B+A-B-');
});

test('example course sequences parse', () => {
  const examples = [
    'A+B+A-B-',
    'B-C+A+B+C-A-',
    'A+B+B-A-',
    'A+B+C+C-D+D-B-A-',
  ];
  for (const seq of examples) {
    const model = expectOk(seq);
    assert.ok(model.steps.length > 0, `no steps for ${seq}`);
  }
});
