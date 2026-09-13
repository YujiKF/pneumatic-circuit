/**
 * GOLDEN TESTS for the step-by-step (passo a passo) electropneumatic method.
 *
 * These encode worked PMR3407 exercises as regression fixtures. For each:
 *   - input sequence + method (step-by-step) + type (electropneumatic)
 *   - expected LOGICAL result: step/relay count, per-step solenoid + sensor
 *     mapping, timer relays, seal-contact topology, extra arming rung.
 *
 * If any of these assertions break, a downstream change altered the meaning of
 * a solved circuit and must be reviewed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep } from '../../src/engine/index.ts';
import type { CircuitLogicalModel } from '../../src/engine/index.ts';
import { toCircuit } from '../../src/engine/index.ts';
import { validateCircuit } from '../../src/validator/index.ts';
import { runCycle, explain } from '../../src/simulator/index.ts';

function solve(
  raw: string,
  opts?: Parameters<typeof parseSequence>[1],
  cycleMode?: 'single' | 'continuous',
): CircuitLogicalModel {
  const parsed = parseSequence(raw, opts);
  assert.ok(parsed.ok, `sequence "${raw}" must parse`);
  return solveStepByStep(parsed.value, cycleMode ? { cycleMode } : {});
}

/** Find the control rung (relay coil) for a relay id. */
function controlRung(model: CircuitLogicalModel, relayId: string) {
  return model.ladder.rungs.find(
    (r) => r.coil.kind === 'relay' && r.coil.id === relayId,
  );
}

/** Assert the seal is the relay's OWN NO contact in its own branch. */
function assertSealTopology(model: CircuitLogicalModel, relayId: string): void {
  const rung = controlRung(model, relayId);
  assert.ok(rung, `rung for ${relayId} exists`);
  const sealBranch = rung.setBranches.find((b) =>
    b.contacts.some((c) => c.role === 'seal'),
  );
  assert.ok(sealBranch, `${relayId} has a seal branch`);
  assert.equal(sealBranch.contacts.length, 1, `${relayId} seal branch is a single contact`);
  const seal = sealBranch.contacts[0];
  assert.equal(seal?.driverId, relayId, `${relayId} seal is its OWN contact`);
  assert.equal(seal?.type, 'NO', `${relayId} seal is normally-open`);
}

// ---------------------------------------------------------------------------
// Golden (c): A+B+A-B-  (4 steps, the milestone acceptance example)
// ---------------------------------------------------------------------------
test("golden A+B+A-B-: 4 steps K1..K4 with correct solenoid + sensor mapping", () => {
  const model = solve('A+B+A-B-');
  assert.equal(model.method, 'step-by-step');
  assert.equal(model.steps.length, 4);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4']);

  // Per-step movement -> solenoid + arrival sensor.
  const expected = [
    { relay: 'K1', act: 'A', dir: '+', sol: '1Y1', sens: '1S2', enable: 'START' },
    { relay: 'K2', act: 'B', dir: '+', sol: '2Y1', sens: '2S2', enable: '1S2' },
    { relay: 'K3', act: 'A', dir: '-', sol: '1Y2', sens: '1S1', enable: '2S2' },
    { relay: 'K4', act: 'B', dir: '-', sol: '2Y2', sens: '2S1', enable: '1S1' },
  ];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const step = model.steps[i]!;
    assert.equal(step.relayId, e.relay);
    const mv = step.movements[0]!;
    assert.equal(mv.actuator, e.act);
    assert.equal(mv.direction, e.dir);
    assert.equal(mv.solenoidId, e.sol);
    assert.equal(mv.arrivalSensorId, e.sens);
    if (e.enable === 'START') {
      assert.equal(step.enabledByStart, true);
    } else {
      assert.equal(step.enableSensorId, e.enable);
    }
    assertSealTopology(model, e.relay);
  }

  // No timers.
  assert.ok(model.steps.every((s) => !s.hasTimer));

  // The circuit projection validates cleanly.
  const report = validateCircuit(toCircuit(model), model);
  assert.ok(report.ok, `issues: ${report.issues.map((i) => i.code).join(',')}`);
});

// ---------------------------------------------------------------------------
// Golden (b): A+B+B-A-  (deck 2, 4 steps K1..K4)
// ---------------------------------------------------------------------------
test("golden A+B+B-A-: 4 steps K1..K4 mapped to 1Y/2Y solenoids", () => {
  const model = solve('A+B+B-A-');
  assert.equal(model.steps.length, 4);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4']);

  const expected = [
    { sol: '1Y1', sens: '1S2' }, // A+
    { sol: '2Y1', sens: '2S2' }, // B+
    { sol: '2Y2', sens: '2S1' }, // B-
    { sol: '1Y2', sens: '1S1' }, // A-
  ];
  for (let i = 0; i < expected.length; i++) {
    const mv = model.steps[i]!.movements[0]!;
    assert.equal(mv.solenoidId, expected[i]!.sol);
    assert.equal(mv.arrivalSensorId, expected[i]!.sens);
    assertSealTopology(model, `K${i + 1}`);
  }
  // Solenoids drawn only from the A/B set.
  assert.deepEqual([...model.solenoidIds].sort(), ['1Y1', '1Y2', '2Y1', '2Y2']);

  const report = validateCircuit(toCircuit(model), model);
  assert.ok(report.ok, report.issues.map((i) => i.code).join(','));
});

// ---------------------------------------------------------------------------
// Golden (a): A-B+B-B+B-TA+  (deck 2 Ex4a, 6 steps, timer on the T step)
// ---------------------------------------------------------------------------
test("golden A-B+B-B+B-TA+: 6 steps K1..K6 with a TIME relay on the T step and parallel solenoids", () => {
  // A starts extended: auto-inferred by parser because opening movement is A-.
  const model = solve('A-B+B-B+B-TA+');
  assert.equal(model.steps.length, 6);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
  assert.equal(model.initialState?.positions['A'], 'extended');
  assert.equal(model.initialState?.positions['B'], 'retracted');

  const expected = [
    { sol: '1Y2', sens: '1S1', timer: false }, // A-
    { sol: '2Y1', sens: '2S2', timer: false }, // B+
    { sol: '2Y2', sens: '2S1', timer: false }, // B-
    { sol: '2Y1', sens: '2S2', timer: false }, // B+
    { sol: '2Y2', sens: '2S1', timer: false }, // B-
    { sol: '1Y1', sens: '1S2', timer: true }, // TA+
  ];
  for (let i = 0; i < expected.length; i++) {
    const step = model.steps[i]!;
    const mv = step.movements[0]!;
    assert.equal(mv.solenoidId, expected[i]!.sol, `step ${i} solenoid`);
    assert.equal(mv.arrivalSensorId, expected[i]!.sens, `step ${i} sensor`);
    assert.equal(step.hasTimer, expected[i]!.timer, `step ${i} timer`);
    assertSealTopology(model, `K${i + 1}`);
  }

  // Exactly the last step (K6) is a timer relay with a delay value.
  const k6 = model.steps[5]!;
  assert.equal(k6.hasTimer, true);
  assert.ok(typeof k6.delaySeconds === 'number' && k6.delaySeconds > 0);

  // The timer relay is projected as a 'timer' relay component with delay.
  const circuit = toCircuit(model);
  const k6Relay = circuit.components.find((c) => c.kind === 'relay' && c.id === 'K6');
  assert.ok(k6Relay && k6Relay.kind === 'relay');
  assert.equal(k6Relay.relayKind, 'timer');

  // Solenoids drawn from {1Y1,1Y2,2Y1,2Y2}.
  const solSet = new Set(model.solenoidIds);
  for (const s of solSet) assert.ok(['1Y1', '1Y2', '2Y1', '2Y2'].includes(s));

  // Power rung paralleling check:
  // 6 control rungs + 4 power rungs (1Y2, 2Y1, 2Y2, 1Y1) = 10 rungs
  assert.equal(model.ladder.rungs.length, 10, '6 control rungs + 4 power rungs (parallel 2Y1 & 2Y2)');
  const rung2Y1 = model.ladder.rungs.find((r) => r.coil.id === '2Y1');
  assert.ok(rung2Y1, 'rung for 2Y1 exists');
  assert.equal(rung2Y1.setBranches.length, 2, '2Y1 has 2 parallel set branches');
  assert.deepEqual(
    rung2Y1.setBranches.map((b) => b.contacts[0]?.driverId),
    ['K2', 'K4'],
    '2Y1 driven by K2 and K4 in parallel',
  );
  const rung2Y2 = model.ladder.rungs.find((r) => r.coil.id === '2Y2');
  assert.ok(rung2Y2, 'rung for 2Y2 exists');
  assert.equal(rung2Y2.setBranches.length, 2, '2Y2 has 2 parallel set branches');
  assert.deepEqual(
    rung2Y2.setBranches.map((b) => b.contacts[0]?.driverId),
    ['K3', 'K5'],
    '2Y2 driven by K3 and K5 in parallel',
  );

  const report = validateCircuit(circuit, model);
  assert.ok(report.ok, report.issues.map((i) => i.code).join(','));

  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true, 'A-B+B-B+B-TA+ cycle completes');
  assert.equal(sim.state.cylinders.get('A'), 'EXTENDED');
  assert.equal(sim.state.cylinders.get('B'), 'RETRACTED');
});

// ---------------------------------------------------------------------------
// Golden: A+B+C+A-B-C-  (3 cylinders, 6 steps K1..K6)
// ---------------------------------------------------------------------------
test("golden A+B+C+A-B-C-: 6 steps K1..K6 mapped to 1Y/2Y/3Y solenoids", () => {
  const model = solve('A+B+C+A-B-C-');
  assert.equal(model.method, 'step-by-step');
  assert.equal(model.steps.length, 6);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
  assert.deepEqual(model.actuators, ['A', 'B', 'C']);

  const expected = [
    { relay: 'K1', act: 'A', dir: '+', sol: '1Y1', sens: '1S2', enable: 'START' },
    { relay: 'K2', act: 'B', dir: '+', sol: '2Y1', sens: '2S2', enable: '1S2' },
    { relay: 'K3', act: 'C', dir: '+', sol: '3Y1', sens: '3S2', enable: '2S2' },
    { relay: 'K4', act: 'A', dir: '-', sol: '1Y2', sens: '1S1', enable: '3S2' },
    { relay: 'K5', act: 'B', dir: '-', sol: '2Y2', sens: '2S1', enable: '1S1' },
    { relay: 'K6', act: 'C', dir: '-', sol: '3Y2', sens: '3S1', enable: '2S1' },
  ];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const step = model.steps[i]!;
    assert.equal(step.relayId, e.relay);
    const mv = step.movements[0]!;
    assert.equal(mv.actuator, e.act);
    assert.equal(mv.direction, e.dir);
    assert.equal(mv.solenoidId, e.sol);
    assert.equal(mv.arrivalSensorId, e.sens);
    if (e.enable === 'START') {
      assert.equal(step.enabledByStart, true);
    } else {
      assert.equal(step.enableSensorId, e.enable);
    }
    assertSealTopology(model, e.relay);
  }

  assert.deepEqual(
    [...model.solenoidIds].sort(),
    ['1Y1', '1Y2', '2Y1', '2Y2', '3Y1', '3Y2'],
  );

  // 6 control rungs + 6 power rungs = 12 rungs
  assert.equal(model.ladder.rungs.length, 12, '6 control rungs + 6 power rungs');
  assert.equal(model.pneumatic.cylinders.length, 3, '3 pneumatic cylinders');
  assert.equal(model.pneumatic.valves.length, 3, '3 5/2 directional valves');

  const report = validateCircuit(toCircuit(model), model);
  assert.ok(report.ok, report.issues.map((i) => i.code).join(','));

  // Simulation verification
  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true, 'A+B+C+A-B-C- cycle completes');
  assert.equal(sim.state.cylinders.get('A'), 'RETRACTED');
  assert.equal(sim.state.cylinders.get('B'), 'RETRACTED');
  assert.equal(sim.state.cylinders.get('C'), 'RETRACTED');
});

// ---------------------------------------------------------------------------
// Golden: B-C+A+B+C-A-  (3 cylinders, 6 steps K1..K6, B starts extended)
// ---------------------------------------------------------------------------
test("golden B-C+A+B+C-A-: 6 steps K1..K6 with cylinder B starting extended", () => {
  // Cylinder B starts extended: auto-inferred because first motion is B-
  const model = solve('B-C+A+B+C-A-');
  assert.equal(model.method, 'step-by-step');
  assert.equal(model.steps.length, 6);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
  assert.equal(model.initialState?.positions['B'], 'extended');
  assert.equal(model.initialState?.positions['A'], 'retracted');
  assert.equal(model.initialState?.positions['C'], 'retracted');

  const expected = [
    { relay: 'K1', act: 'B', dir: '-', sol: '2Y2', sens: '2S1', enable: 'START' },
    { relay: 'K2', act: 'C', dir: '+', sol: '3Y1', sens: '3S2', enable: '2S1' },
    { relay: 'K3', act: 'A', dir: '+', sol: '1Y1', sens: '1S2', enable: '3S2' },
    { relay: 'K4', act: 'B', dir: '+', sol: '2Y1', sens: '2S2', enable: '1S2' },
    { relay: 'K5', act: 'C', dir: '-', sol: '3Y2', sens: '3S1', enable: '2S2' },
    { relay: 'K6', act: 'A', dir: '-', sol: '1Y2', sens: '1S1', enable: '3S1' },
  ];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const step = model.steps[i]!;
    assert.equal(step.relayId, e.relay);
    const mv = step.movements[0]!;
    assert.equal(mv.actuator, e.act);
    assert.equal(mv.direction, e.dir);
    assert.equal(mv.solenoidId, e.sol);
    assert.equal(mv.arrivalSensorId, e.sens);
    if (e.enable === 'START') {
      assert.equal(step.enabledByStart, true);
    } else {
      assert.equal(step.enableSensorId, e.enable);
    }
    assertSealTopology(model, e.relay);
  }

  assert.deepEqual(
    [...model.solenoidIds].sort(),
    ['1Y1', '1Y2', '2Y1', '2Y2', '3Y1', '3Y2'],
  );

  // 6 control rungs + 6 power rungs = 12 rungs
  assert.equal(model.ladder.rungs.length, 12, '6 control rungs + 6 power rungs');
  assert.equal(model.pneumatic.cylinders.length, 3, '3 pneumatic cylinders');
  assert.equal(model.pneumatic.valves.length, 3, '3 5/2 directional valves');

  const report = validateCircuit(toCircuit(model), model);
  assert.ok(report.ok, report.issues.map((i) => i.code).join(','));

  // Simulation verification: starts with B extended, and cycle returns home
  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true, 'B-C+A+B+C-A- cycle completes');
  assert.equal(sim.state.cylinders.get('A'), 'RETRACTED');
  assert.equal(sim.state.cylinders.get('B'), 'EXTENDED');
  assert.equal(sim.state.cylinders.get('C'), 'RETRACTED');

  // Chronological explanation verification
  const lines = explain(model);
  assert.ok(lines.length > 10, 'generates chronological explanation without stall');
  assert.ok(lines[0]?.includes('START'), 'explanation starts with START');
  assert.ok(lines.some((l) => l.includes('2Y2')), 'mentions retract solenoid 2Y2');
  assert.ok(lines.some((l) => l.includes('cycle for B-C+A+B+C-A- is complete')), 'completes full narrative');
});

// ---------------------------------------------------------------------------
// Extra arming rung + cycle mode
// ---------------------------------------------------------------------------
test("extra arming contact primes the last line on rung 1", () => {
  const model = solve('A+B+A-B-');
  const rung1 = model.ladder.rungs.find((r) => r.number === 1);
  assert.ok(rung1);
  // The activation branch of rung 1 contains a start contact AND an arming
  // contact driven by the LAST relay (K4).
  const activation = rung1.setBranches.find((b) =>
    b.contacts.some((c) => c.role === 'start'),
  );
  assert.ok(activation, 'rung 1 has a start branch');
  const arming = activation.contacts.find((c) => c.role === 'arming');
  assert.ok(arming, 'rung 1 has an arming contact');
  assert.equal(arming.driverId, 'K4', 'arming contact is driven by the last relay');
});

test("cycle mode: single does NOT re-arm first from last; continuous DOES", () => {
  const single = solve('A+B+A-B-', undefined, 'single');
  const cont = solve('A+B+A-B-', undefined, 'continuous');

  const armSingle = single.ladder.rungs
    .find((r) => r.number === 1)!
    .setBranches.flatMap((b) => b.contacts)
    .find((c) => c.role === 'arming')!;
  const armCont = cont.ladder.rungs
    .find((r) => r.number === 1)!
    .setBranches.flatMap((b) => b.contacts)
    .find((c) => c.role === 'arming')!;

  // single: arming is a NC contact of the last relay (armed while last is off);
  // continuous: arming is a NO contact (last line re-arms the first -> wrap).
  assert.equal(armSingle.type, 'NC');
  assert.equal(armCont.type, 'NO');

  // Continuous also resets the last line from the first (wrap reset), single
  // does not.
  const lastSingle = single.ladder.rungs.find(
    (r) => r.coil.kind === 'relay' && r.coil.id === 'K4',
  )!;
  const lastCont = cont.ladder.rungs.find(
    (r) => r.coil.kind === 'relay' && r.coil.id === 'K4',
  )!;
  assert.equal(lastSingle.resetContacts.length, 0);
  assert.equal(lastCont.resetContacts.length, 1);
  assert.equal(lastCont.resetContacts[0]!.driverId, 'K1');
});
