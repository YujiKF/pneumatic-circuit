/**
 * SIMULTANEOUS-GROUP transition gating (review issue 5).
 *
 * When a step follows a parenthesized SIMULTANEOUS group, it must wait on the
 * arrival sensors of ALL members of that group, not just the last-listed one.
 * Otherwise, for a group whose members finish at different times, the next step
 * could be enabled early (before every cylinder has arrived).
 *
 * The solver now records the full `enableSensorIds` set and the activation rung
 * gates on ALL of them in series (AND). These tests pin that: the model exposes
 * every member sensor, the activation rung has a prev-sensor contact per member,
 * and the REAL simulator only advances past the group once all members arrive.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep, toCircuit } from '../../src/engine/index.ts';
import type { CircuitLogicalModel } from '../../src/engine/index.ts';
import { validateCircuit } from '../../src/validator/index.ts';
import { runCycle, settleLadder, relayOn } from '../../src/simulator/index.ts';

function solve(raw: string): CircuitLogicalModel {
  const parsed = parseSequence(raw);
  assert.ok(parsed.ok, `sequence "${raw}" parses`);
  return solveStepByStep(parsed.value);
}

// Sequence: A and B advance simultaneously, THEN both retract simultaneously.
// Step 0 = (A+B+); step 1 = (A-B-). Step 1 must wait on BOTH 1S2 and 2S2.
const SEQ = '(A+B+)(A-B-)';

test('a step after a simultaneous group records ALL predecessor arrival sensors', () => {
  const model = solve(SEQ);
  assert.equal(model.steps.length, 2, 'two simultaneous steps');

  const step1 = model.steps[1]!;
  // enableSensorIds holds BOTH members' arrival sensors (A+ -> 1S2, B+ -> 2S2).
  assert.deepEqual(
    [...(step1.enableSensorIds ?? [])].sort(),
    ['1S2', '2S2'],
    'step 1 waits on both members of the (A+B+) group',
  );
});

test('the activation rung gates on a prev-sensor contact for EVERY member', () => {
  const model = solve(SEQ);
  const rung2 = model.ladder.rungs.find((r) => r.coil.kind === 'relay' && r.coil.id === 'K2');
  assert.ok(rung2, 'K2 control rung exists');

  const activation = rung2.setBranches.find((b) =>
    b.contacts.some((c) => c.role === 'prev-line'),
  );
  assert.ok(activation, 'K2 has an activation branch');

  const prevSensorContacts = activation.contacts.filter((c) => c.role === 'prev-sensor');
  const drivers = prevSensorContacts.map((c) => c.driverId).sort();
  assert.deepEqual(drivers, ['1S2', '2S2'], 'both member sensors gate K2 in series');
  // All in series (AND) within the SAME branch -> both must be active.
  for (const c of prevSensorContacts) assert.equal(c.type, 'NO');

  // The circuit still validates cleanly.
  const report = validateCircuit(toCircuit(model), model);
  assert.ok(report.ok, report.issues.map((i) => i.code).join(','));
});

test('REAL settleLadder: the next step waits until ALL group members arrive', () => {
  const model = solve(SEQ);
  // Reach the post-START state with K1 latched and no cylinder moved yet.
  const { state } = runCycle(model, { pulseStart: true, maxPhysicalEvents: 0 });
  assert.equal(relayOn(state, 'K1'), true, 'K1 latched after START');
  assert.equal(relayOn(state, 'K2'), false, 'K2 not yet enabled');

  // Simulate ONLY the FIRST member (A) arriving: 1S1 opens, 1S2 closes. B is
  // still in transit, so 2S2 is NOT yet active. Drive the REAL settle function.
  state.sensors.set('1S1', 'INACTIVE');
  state.sensors.set('1S2', 'ACTIVE');
  settleLadder(model, state, []);
  assert.equal(
    relayOn(state, 'K2'),
    false,
    'K2 must NOT fire while member B is still in transit (2S2 inactive)',
  );

  // Now the SECOND member (B) arrives too. With BOTH member sensors active the
  // series-gated activation branch closes and K2 fires.
  state.sensors.set('2S1', 'INACTIVE');
  state.sensors.set('2S2', 'ACTIVE');
  settleLadder(model, state, []);
  assert.equal(relayOn(state, 'K2'), true, 'K2 fires once ALL members have arrived');
});
