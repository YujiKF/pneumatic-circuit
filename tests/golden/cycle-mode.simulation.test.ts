/**
 * CYCLE-MODE simulation tests (review issue 2).
 *
 * The step-by-step solver emits DIFFERENT arming/reset topology for `single`
 * vs `continuous`, but before this test only `single` was ever simulated, so
 * the continuous wrap-around (does the first line actually re-fire after the
 * last completes? does the first-relay reset actually drop the last line?) was
 * generated-but-unverified.
 *
 * These tests drive the SAME production simulator (`runCycle`) used everywhere
 * else -- no second logic -- and assert the wrap behavior directly from the
 * relay event trace.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep } from '../../src/engine/index.ts';
import type { CircuitLogicalModel } from '../../src/engine/index.ts';
import { runCycle } from '../../src/simulator/index.ts';
import type { SimEvent } from '../../src/simulator/index.ts';

function model(cycleMode: 'single' | 'continuous'): CircuitLogicalModel {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok);
  return solveStepByStep(parsed.value, { cycleMode });
}

/** Ordered relay on/off events as e.g. "+K1", "-K4". */
function relayTrace(events: readonly SimEvent[]): string[] {
  return events
    .filter((e) => e.kind === 'relay-on' || e.kind === 'relay-off')
    .map((e) => `${e.kind === 'relay-on' ? '+' : '-'}${e.id}`);
}

test('single cycle: the first line fires exactly once and the cycle stops (no wrap)', () => {
  const res = runCycle(model('single'), { pulseStart: true });
  const trace = relayTrace(res.events);

  // K1 energizes exactly once -- the last line does NOT re-arm the first.
  const k1Ons = trace.filter((t) => t === '+K1').length;
  assert.equal(k1Ons, 1, 'single mode energizes K1 exactly once');

  // The cycle completes and settles with the last relay latched, first off.
  assert.equal(res.completed, true, 'single cycle completes');
  assert.equal(res.state.relays.get('K4'), 'ON', 'last line latched at rest');
  assert.equal(res.state.relays.get('K1'), 'OFF', 'first line not re-armed');
});

test('continuous cycle: the last line re-arms the first (wrap) and the first-relay reset drops the last', () => {
  // Bound the otherwise-endless continuous run to one full cycle (4 movements)
  // plus enough events to observe the wrap re-fire and the last-line reset.
  const res = runCycle(model('continuous'), { pulseStart: true, maxPhysicalEvents: 5 });
  const trace = relayTrace(res.events);

  // WRAP: K1 must energize MORE THAN ONCE -- once from START, then again from
  // the last relay's NO wrap contact after the cycle completes.
  const k1Ons = trace.filter((t) => t === '+K1').length;
  assert.ok(k1Ons >= 2, `continuous mode re-fires K1 (wrap); saw ${k1Ons} +K1 events`);

  // The wrap ordering: the SECOND +K1 must come AFTER the first +K4 (the last
  // line completes, then re-arms the first).
  const firstK4On = trace.indexOf('+K4');
  const secondK1On = trace.indexOf('+K1', trace.indexOf('+K1') + 1);
  assert.ok(firstK4On >= 0, 'K4 (last line) energizes at least once');
  assert.ok(secondK1On > firstK4On, 'the wrap re-fires K1 only after the last line completes');

  // FIRST-RELAY RESET drops the last line: once K1 re-fires (wrap), K4 must be
  // reset via its NC K1 reset contact. So a "-K4" must appear at/after the wrap.
  const k4OffAfterWrap = trace.slice(secondK1On).includes('-K4');
  assert.ok(k4OffAfterWrap, 'the first-relay reset drops the last line after the wrap');
});
