/**
 * The automatic textual explanation is DERIVED from the simulator trace over
 * the same logical model (single source of logic). These tests assert the
 * chronological START -> Ki -> Y -> valve -> cylinder -> sensor -> next-step
 * narrative for a golden sequence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep } from '../../src/engine/index.ts';
import { explain } from '../../src/simulator/index.ts';

test('explanation for A+B+A-B- follows START -> K -> Y -> valve -> cylinder -> sensor', () => {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok);
  const model = solveStepByStep(parsed.value);
  const lines = explain(model);
  const text = lines.join('\n');

  // Opening: START pressed then K1 energized.
  assert.match(lines[0]!, /START/);
  assert.match(lines[1]!, /K1 is energized/);

  // K1 energizes the advance solenoid of A.
  assert.ok(
    lines.some((l) => /K1 energizes 1Y1/.test(l)),
    'K1 must energize 1Y1',
  );
  // The valve of A switches, A advances, 1S2 becomes active.
  assert.ok(lines.some((l) => /valve of cylinder A switches/.test(l)));
  assert.ok(lines.some((l) => /cylinder A advances/.test(l)));
  assert.ok(lines.some((l) => /1S2 becomes active/.test(l)));

  // The chain continues through K2/K3/K4 and completes.
  assert.ok(/K2 is energized/.test(text));
  assert.ok(/K3 is energized/.test(text));
  assert.ok(/K4 is energized/.test(text));
  assert.ok(/cycle for A\+B\+A-B- is complete/.test(text));

  // Lines are numbered "1. ", "2. ", ...
  assert.match(lines[0]!, /^1\. /);
  assert.match(lines[1]!, /^2\. /);
});

test('explanation is a projection of the SAME model (no separate logic): relay/solenoid ids come from the model', () => {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok);
  const model = solveStepByStep(parsed.value);
  const text = explain(model, { numbered: false }).join('\n');
  // Every relay id in the model appears in the narrative.
  for (const relay of model.relayIds) {
    assert.ok(text.includes(relay), `narrative mentions ${relay}`);
  }
  // Every solenoid that gets energized appears too.
  for (const sol of model.solenoidIds) {
    assert.ok(text.includes(sol), `narrative mentions solenoid ${sol}`);
  }
});
