/**
 * TIMER-DELAY behavior test (review issue 4).
 *
 * DECISION (documented in docs/PMR3407_RULES.md §A4): the PMR3407 textual
 * sequence notation records only the PRESENCE of a timer (the `T` marker); it
 * carries no numeric delay (there is no `[0.x]` token in the grammar, see
 * src/parser/tokenizer.ts). The delay is therefore NOT invented at parse time.
 * The electropneumatic step-by-step layer assigns the timer relay a delay from
 * its `defaultDelaySeconds` option (default 0.3 s), which is CONFIGURABLE.
 *
 * This test pins that behavior so it cannot silently change:
 *   - a timer step gets the default delay when none is configured;
 *   - a caller-supplied `defaultDelaySeconds` is threaded through to the model;
 *   - non-timer steps carry no delay.
 *
 * If a future feature threads a parsed per-step delay through, this test should
 * be updated alongside the grammar and §A4.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep } from '../../src/engine/index.ts';

test('timer step gets the DEFAULT delay (0.3 s) when none is configured', () => {
  const parsed = parseSequence('A-B+B-B+B-TA+', { initialState: { A: 'extended' } });
  assert.ok(parsed.ok);
  const model = solveStepByStep(parsed.value);

  const timerSteps = model.steps.filter((s) => s.hasTimer);
  assert.equal(timerSteps.length, 1, 'exactly one timer step (the T-prefixed A+)');
  assert.equal(timerSteps[0]!.delaySeconds, 0.3, 'default delay is 0.3 s');

  // Non-timer steps carry no delay value.
  for (const s of model.steps) {
    if (!s.hasTimer) assert.equal(s.delaySeconds, undefined, `${s.relayId} has no delay`);
  }
});

test('a caller-supplied defaultDelaySeconds is threaded into the timer relay', () => {
  const parsed = parseSequence('A-B+B-B+B-TA+', { initialState: { A: 'extended' } });
  assert.ok(parsed.ok);
  const model = solveStepByStep(parsed.value, { defaultDelaySeconds: 1.5 });

  const timerSteps = model.steps.filter((s) => s.hasTimer);
  assert.equal(timerSteps.length, 1);
  assert.equal(
    timerSteps[0]!.delaySeconds,
    1.5,
    'the configured default delay is used for the timer relay',
  );
});
