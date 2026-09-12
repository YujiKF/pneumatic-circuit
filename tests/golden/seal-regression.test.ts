/**
 * SEAL / SELO regression test (mandatory).
 *
 * The step-by-step memory MUST hold via the relay's OWN seal contact, NOT the
 * transient enabling sensor. This test:
 *
 *   1. Builds the step-by-step circuit for A+B+A-B-.
 *   2. Simulates and asserts that relay K2 remains ON AFTER cylinder B leaves
 *      the sensor (2S2) that step K2 produced (i.e. after K3 advances B off its
 *      end -- but before K2 is legitimately reset). More directly: it asserts
 *      that a step's relay does NOT drop the instant its own triggering sensor
 *      opens. We demonstrate this on K1: after START is released (momentary
 *      push) and cylinder A leaves the home sensor 1S1, K1 must stay ON purely
 *      because of its seal.
 *   3. MUTATION: rebuild the same model with the seal contact removed and show
 *      the property FAILS -- proving the test catches a missing/mis-placed seal.
 *
 * The CircuitValidator also flags the mutated model as a LOGICAL_CONFLICT.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep } from '../../src/engine/index.ts';
import type { CircuitLogicalModel, Rung } from '../../src/engine/index.ts';
import { toCircuit } from '../../src/engine/index.ts';
import { validateCircuit, ValidationCode } from '../../src/validator/index.ts';
import { initialSimState, runCycle, settleLadder } from '../../src/simulator/index.ts';
import { relayOn, sensorActive } from '../../src/simulator/index.ts';

// The POSITIVE proof (K1 holds after its triggering sensor opens) runs against
// the PRODUCTION simulator `runCycle` so a regression in `settleLadder` is
// caught (review issue 1). The MUTATION proof (removing the seal drops K1) uses
// a small local ladder evaluator so we can drive the mutated model through the
// exact same START-pulse-then-sensor-opens scenario without wiring a mutated
// model through the whole physical engine; the positive half of that same test
// is ALSO checked through runCycle, so the two evaluators are pinned together.

function solveModel(): CircuitLogicalModel {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok);
  return solveStepByStep(parsed.value);
}

/**
 * Remove the seal branch from every control rung, simulating the classic bug
 * where the memory hold path is forgotten (or wired to the transient sensor
 * instead of the relay's own contact).
 */
function mutateRemoveSeal(model: CircuitLogicalModel): CircuitLogicalModel {
  const rungs: Rung[] = model.ladder.rungs.map((rung) => {
    if (rung.coil.kind !== 'relay') return rung;
    const setBranches = rung.setBranches.filter(
      (b) => !b.contacts.some((c) => c.role === 'seal'),
    );
    return { ...rung, setBranches };
  });
  return { ...model, ladder: { rungs } };
}

// ---------------------------------------------------------------------------
// A local, minimal ladder evaluator matching src/simulator/simulator.ts so the
// test can drive an explicit "START pulse then sensor opens" scenario.
// ---------------------------------------------------------------------------
function evalLadderToFixedPoint(
  model: CircuitLogicalModel,
  state: ReturnType<typeof initialSimState>,
): void {
  const driverActive = (id: string): boolean => {
    if (state.relays.has(id)) return state.relays.get(id) === 'ON';
    if (state.sensors.has(id)) return state.sensors.get(id) === 'ACTIVE';
    if (id === model.startButtonId) return state.startPressed;
    return false;
  };
  const closed = (driverId: string, type: 'NO' | 'NC'): boolean => {
    const on = driverActive(driverId);
    return type === 'NO' ? on : !on;
  };
  let changed = true;
  let guard = 0;
  while (changed && guard < 1000) {
    changed = false;
    guard++;
    for (const rung of model.ladder.rungs) {
      const setClosed = rung.setBranches.some((b) =>
        b.contacts.every((c) => closed(c.driverId, c.type)),
      );
      const resetClosed = rung.resetContacts.every((c) => closed(c.driverId, c.type));
      const target = setClosed && resetClosed ? 'ON' : 'OFF';
      if (rung.coil.kind === 'relay') {
        if (state.relays.get(rung.coil.id) !== target) {
          state.relays.set(rung.coil.id, target);
          changed = true;
        }
      } else {
        if (state.solenoids.get(rung.coil.id) !== target) {
          state.solenoids.set(rung.coil.id, target);
          changed = true;
        }
      }
    }
  }
}

/**
 * Property under test: after START is pressed then RELEASED (momentary push),
 * and cylinder A leaves its home sensor 1S1 (which opens), K1 must remain ON
 * because of its seal. Returns whether K1 stayed ON.
 */
function k1HoldsAfterSensorOpens(model: CircuitLogicalModel): boolean {
  const state = initialSimState(model);
  // 1) press START and settle -> K1 sets.
  state.startPressed = true;
  evalLadderToFixedPoint(model, state);
  // 2) release START (momentary) -> seal must hold K1.
  state.startPressed = false;
  evalLadderToFixedPoint(model, state);
  // 3) cylinder A physically leaves home: 1S1 opens (INACTIVE). This is the
  //    transient the seal must survive.
  state.sensors.set('1S1', 'INACTIVE');
  evalLadderToFixedPoint(model, state);
  return relayOn(state, 'K1');
}

test('seal (local evaluator): K1 stays ON after START is released and the home sensor opens', () => {
  const model = solveModel();
  assert.equal(
    k1HoldsAfterSensorOpens(model),
    true,
    'K1 must latch via its seal contact once set',
  );
});

test('seal (REAL simulator): K1 holds after START released and 1S1 opens, via settleLadder', () => {
  // Drive the PRODUCTION engine directly (review issue 1). Steps:
  //   1. runCycle with maxPhysicalEvents: 0 presses START, then releases it
  //      (momentary pulse) and re-settles through the real `settleLadder`. At
  //      this point K1 is held ONLY by its seal (START is open) and no cylinder
  //      has moved yet, so 1S1 is still ACTIVE.
  //   2. Simulate cylinder A physically leaving home: open its home sensor 1S1
  //      (the transient the seal must survive), then re-settle the ladder with
  //      the SAME production `settleLadder`.
  //   3. K1 must still be ON. A regression in settleLadder (dropped fixed-point
  //      iteration, perturbed latching) that let the seal stop holding would
  //      make K1 fall to OFF here and fail the test.
  const model = solveModel();
  const { state } = runCycle(model, { pulseStart: true, maxPhysicalEvents: 0 });

  assert.equal(state.startPressed, false, 'START was released (momentary push)');
  assert.equal(relayOn(state, 'K1'), true, 'K1 latched by its seal after START release');
  assert.equal(sensorActive(state, '1S1'), true, 'A has not moved yet: 1S1 still active');

  // Cylinder A leaves home: 1S1 opens. K2 cannot set yet (it needs 1S2, which A
  // has NOT reached), so K1 is proven to hold on its seal alone, not because a
  // later relay is masking the drop.
  state.sensors.set('1S1', 'INACTIVE');
  settleLadder(model, state, []);

  assert.equal(
    relayOn(state, 'K1'),
    true,
    'K1 must stay ON via its seal after its triggering sensor opens (real settleLadder)',
  );
  assert.equal(relayOn(state, 'K2'), false, 'K2 not yet reached (1S2 not active)');
});

test('seal MUTATION: removing the seal makes K1 drop -> the test catches the bug', () => {
  const good = solveModel();
  const broken = mutateRemoveSeal(good);

  // The correct model holds; the mutated one does not.
  assert.equal(k1HoldsAfterSensorOpens(good), true, 'correct model holds K1');
  assert.equal(
    k1HoldsAfterSensorOpens(broken),
    false,
    'mutated model MUST drop K1 (proving the regression test detects a missing seal)',
  );
});

test('validator flags a seal-less model as a LOGICAL_CONFLICT', () => {
  const good = solveModel();
  const broken = mutateRemoveSeal(good);

  const goodReport = validateCircuit(toCircuit(good), good);
  assert.ok(goodReport.ok, 'correct model validates clean');

  const brokenReport = validateCircuit(toCircuit(broken), broken);
  assert.equal(brokenReport.ok, false);
  assert.ok(
    brokenReport.issues.some((i) => i.code === ValidationCode.LOGICAL_CONFLICT),
    'missing seal is reported as LOGICAL_CONFLICT',
  );
});
