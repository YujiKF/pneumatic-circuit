/**
 * Cascade chronological explanation tests.
 *
 * Asserts that explainCascade:
 *  - produces cycle-ordered narrative matching cascadeExecutionOrder;
 *  - traces line 1 pressurization via start valve;
 *  - names memory set and reset operations in cycle order;
 *  - gates simultaneous group transitions on all member arrival sensors;
 *  - preserves original sequence order even with group merging.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveCascade, explainCascade, cascadeExecutionOrder, toCascadeCircuit } from '../../src/engine/index.ts';

test('cascade explanation for G1 (A+B+A-B-) follows line1 -> moves -> M1 set/reset -> line2 -> wrap', () => {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok);
  const model = solveCascade(parsed.value);
  const lines = explainCascade(model);
  const text = lines.join('\n');

  // Numbered lines
  assert.match(lines[0]!, /^1\. /);
  assert.match(lines[1]!, /^2\. /);

  // Line 1 pressurized at start
  assert.ok(text.includes('Start valve E is actuated, pressurizing line L1.'));

  // Memory M1 set and reset
  assert.ok(text.includes('Sensor 2S2 pilots SET (port 14) of memory valve M1 (0.1).'));
  assert.ok(text.includes('Memory valve M1 sets line L2 live.'));
  assert.ok(text.includes('Memory valve M1 resets previous line L1.'));

  // Cycle wrap
  assert.ok(text.includes('Control wraps to line L1'));
  assert.ok(text.includes('The cycle for A+B+A-B- is complete.'));

  // Movement order equals sequence
  const moveRegex = /\(([A-Z][+-])\)/g;
  const moves: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = moveRegex.exec(text)) !== null) {
    moves.push(m[1]!);
  }
  assert.deepEqual(moves, ['A+', 'B+', 'A-', 'B-']);
});

test('cascade explanation for G4 (A+B-B+T(A-B-)B+) names M1..M3 in cycle order and gates simultaneous sensors', () => {
  const parsed = parseSequence('A+B-B+T(A-B-)B+');
  assert.ok(parsed.ok);
  const model = solveCascade(parsed.value);
  const text = explainCascade(model, { numbered: false }).join('\n');

  // M1, M2, M3 set in cycle order
  const idxM1 = text.indexOf('memory valve M1');
  const idxM2 = text.indexOf('memory valve M2');
  const idxM3 = text.indexOf('memory valve M3');
  assert.ok(idxM1 !== -1 && idxM2 !== -1 && idxM3 !== -1, 'all 3 memories mentioned');
  assert.ok(idxM1 < idxM2, 'M1 appears before M2');
  assert.ok(idxM2 < idxM3, 'M2 appears before M3');

  // G3 -> G4 transition gates on both 1S1 and 2S1
  assert.ok(
    text.includes('1S1 and 2S1') || text.includes('2S1 and 1S1'),
    'mentions both arrival sensors for simultaneous transition',
  );

  // Movement order
  const moveRegex = /\(([A-Z][+-])\)/g;
  const moves: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = moveRegex.exec(text)) !== null) {
    moves.push(match[1]!);
  }
  assert.deepEqual(moves, ['A+', 'B-', 'B+', 'A-', 'B-', 'B+']);
});

test('cascade explanation preserves order for merged sequence A+A-A+', () => {
  const parsed = parseSequence('A+A-A+');
  assert.ok(parsed.ok);
  const model = solveCascade(parsed.value);
  assert.equal(model.merged, true);

  const text = explainCascade(model, { numbered: false }).join('\n');
  const moveRegex = /\(([A-Z][+-])\)/g;
  const moves: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = moveRegex.exec(text)) !== null) {
    moves.push(match[1]!);
  }
  assert.deepEqual(moves, ['A+', 'A-', 'A+']);
});

test('toCascadeCircuit retains static group listing explanation', () => {
  const parsed = parseSequence('A+B+B-A-');
  assert.ok(parsed.ok);
  const model = solveCascade(parsed.value);
  const circuit = toCascadeCircuit(model);
  assert.deepEqual(circuit.explanation, [
    'Grupo I:',
    'A+',
    'B+',
    'Grupo II:',
    'B-',
    'A-',
    'Nm = 1',
  ]);
});
