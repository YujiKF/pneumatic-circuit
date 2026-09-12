/**
 * Actuator auto-detection and explicit initial-state handling.
 * See requirements REQ-PARSE-ACTUATORS and REQ-INITIAL-STATE.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';

test('actuators are auto-detected, de-duplicated and sorted', () => {
  const result = parseSequence('B-C+A+B+C-A-');
  assert.ok(result.ok);
  assert.deepEqual(result.value.actuators, ['A', 'B', 'C']);
});

test('default initial state is all retracted', () => {
  const result = parseSequence('A+B+A-B-');
  assert.ok(result.ok);
  assert.deepEqual(result.value.initialState.positions, {
    A: 'retracted',
    B: 'retracted',
  });
});

test('initial state can be overridden per actuator', () => {
  const result = parseSequence('A-B+A+B-', {
    initialState: { A: 'extended' },
  });
  assert.ok(result.ok);
  assert.equal(result.value.initialState.positions['A'], 'extended');
  assert.equal(result.value.initialState.positions['B'], 'retracted');
});

test('actuators inside simultaneous groups are detected', () => {
  const result = parseSequence('A+B-T(B+C+)C-A-');
  assert.ok(result.ok);
  assert.deepEqual(result.value.actuators, ['A', 'B', 'C']);
});
