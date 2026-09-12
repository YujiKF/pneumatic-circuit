/**
 * Timer prefix and simultaneous (parenthesized) group parsing.
 * See docs/PMR3407_RULES.md, "Timers" and "Simultaneous movements".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';

test('timer prefix on a single movement sets hasTimer on that step', () => {
  const result = parseSequence('A-B+B-B+B-TA+');
  assert.ok(result.ok);
  const model = result.value;
  const last = model.steps[model.steps.length - 1];
  assert.equal(last?.hasTimer, true);
  assert.deepEqual(last?.movements[0], { actuator: 'A', direction: '+' });
  // Only the timed step carries the flag.
  assert.equal(model.steps[0]?.hasTimer, false);
  assert.equal(model.canonical, 'A-B+B-B+B-TA+');
});

test('timer prefix on a group applies to the whole simultaneous step', () => {
  const result = parseSequence('A+B-T(B+C+)C-A-');
  assert.ok(result.ok);
  const model = result.value;
  assert.equal(model.steps.length, 5);
  const timedStep = model.steps[2];
  assert.equal(timedStep?.hasTimer, true);
  assert.equal(timedStep?.movements.length, 2);
  assert.deepEqual(model.actuators, ['A', 'B', 'C']);
  assert.equal(model.canonical, 'A+B-T(B+C+)C-A-');
});

test('simultaneous group holds multiple movements in one step', () => {
  const result = parseSequence('A+B-T(A-B-)B+');
  assert.ok(result.ok);
  const model = result.value;
  // Steps: A+, B-, T(A-B-), B+
  assert.equal(model.steps.length, 4);
  assert.equal(model.steps[2]?.movements.length, 2);
  assert.equal(model.steps[2]?.hasTimer, true);
  assert.equal(model.canonical, 'A+B-T(A-B-)B+');
});

test('group movements are canonicalized in alphabetical order', () => {
  const a = parseSequence('(B+A+)');
  const b = parseSequence('(A+B+)');
  assert.ok(a.ok && b.ok);
  assert.equal(a.value.canonical, '(A+B+)');
  assert.equal(a.value.canonical, b.value.canonical);
});
