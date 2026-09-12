/**
 * Property-based invariants for the step-by-step solver, over physically
 * consistent random sequences (see step-sequence-arbitrary.ts). Uses the
 * hand-rolled forAll (fast-check is not installable).
 *
 * Invariants (user spec):
 *  P1. Every movement maps to some actuator's action (its solenoid exists in
 *      the model and its pneumatic valve drives that cylinder).
 *  P2. Every referenced sensor exists (is one of the actuator's two ends).
 *  P3. Every connection ends at a valid port (validator NONEXISTENT_PORT = 0).
 *  P4. Every step is reachable (the simulator energizes each Ki exactly once
 *      during a cycle) and no step points to a nonexistent step.
 *  P5. No identifier exists without a corresponding component: every relay /
 *      solenoid / sensor referenced has a backing component in the projection.
 *  P6. The CircuitValidator reports ZERO issues over generated circuits.
 *  P7. For balanced sequences (return to initial), the simulator ends with
 *      every cylinder RETRACTED (back to the initial state).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep, toCircuit } from '../../src/engine/index.ts';
import { validateCircuit, ValidationCode } from '../../src/validator/index.ts';
import { runCycle } from '../../src/simulator/index.ts';
import { forAll } from './_arbitrary.ts';
import {
  stepSequenceArbitrary,
  toCanonical,
} from './step-sequence-arbitrary.ts';

test('P1: every movement maps to a solenoid + valve of its actuator', () => {
  forAll(
    stepSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toCanonical(seq));
      assert.ok(parsed.ok);
      const model = solveStepByStep(parsed.value);
      for (const step of model.steps) {
        for (const mv of step.movements) {
          assert.ok(model.solenoidIds.includes(mv.solenoidId));
          const valve = model.pneumatic.valves.find((v) => v.actuator === mv.actuator);
          assert.ok(valve, `valve for ${mv.actuator} exists`);
          const expected = mv.direction === '+' ? valve.advanceSolenoidId : valve.retractSolenoidId;
          assert.equal(mv.solenoidId, expected);
        }
      }
    },
    { runs: 150, seed: 0xa11ce },
  );
});

test('P2 + P5: every referenced sensor/relay/solenoid has a backing component', () => {
  forAll(
    stepSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toCanonical(seq));
      assert.ok(parsed.ok);
      const model = solveStepByStep(parsed.value);
      const circuit = toCircuit(model);
      const relayIds = new Set(circuit.components.filter((c) => c.kind === 'relay').map((c) => c.id));
      const sensorIds = new Set(circuit.components.filter((c) => c.kind === 'sensor').map((c) => c.id));
      const coilIds = new Set(circuit.components.filter((c) => c.kind === 'coil').map((c) => c.id));
      for (const id of model.relayIds) assert.ok(relayIds.has(id), `relay ${id} has a component`);
      for (const id of model.sensorIds) assert.ok(sensorIds.has(id), `sensor ${id} has a component`);
      for (const id of model.solenoidIds) assert.ok(coilIds.has(id), `solenoid ${id} has a coil`);
    },
    { runs: 150, seed: 0xb0b },
  );
});

test('P3 + P6: the CircuitValidator reports zero issues (all ports/refs valid)', () => {
  forAll(
    stepSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toCanonical(seq));
      assert.ok(parsed.ok);
      const model = solveStepByStep(parsed.value);
      const report = validateCircuit(toCircuit(model), model);
      assert.ok(
        report.ok,
        `sequence ${toCanonical(seq)} produced issues: ${report.issues.map((i) => i.code).join(',')}`,
      );
      // No NONEXISTENT_PORT specifically.
      assert.ok(!report.issues.some((i) => i.code === ValidationCode.NONEXISTENT_PORT));
    },
    { runs: 150, seed: 0xc0de },
  );
});

test('P4: every step is reachable (each Ki energizes during the cycle) and step indices are contiguous', () => {
  forAll(
    stepSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toCanonical(seq));
      assert.ok(parsed.ok);
      const model = solveStepByStep(parsed.value);

      // Step indices are 0..n-1 and relay ids are K1..Kn -> no dangling refs.
      model.steps.forEach((s, i) => {
        assert.equal(s.index, i);
        assert.equal(s.relayId, `K${i + 1}`);
      });

      // Simulate; every relay must have been energized at least once.
      const { events } = runCycle(model);
      const energized = new Set(
        events.filter((e) => e.kind === 'relay-on').map((e) => e.id),
      );
      for (const id of model.relayIds) {
        assert.ok(energized.has(id), `relay ${id} was reachable/energized`);
      }
    },
    { runs: 120, seed: 0xd00d },
  );
});

test('P7: balanced sequences return every cylinder to RETRACTED (initial state)', () => {
  forAll(
    stepSequenceArbitrary,
    (seq) => {
      if (!seq.balanced) return; // only assert for balanced cases
      const parsed = parseSequence(toCanonical(seq));
      assert.ok(parsed.ok);
      const model = solveStepByStep(parsed.value);
      const { state, completed } = runCycle(model);
      assert.ok(completed, `cycle for ${toCanonical(seq)} completed`);
      for (const actuator of model.actuators) {
        assert.equal(
          state.cylinders.get(actuator),
          'RETRACTED',
          `cylinder ${actuator} returns home for ${toCanonical(seq)}`,
        );
      }
    },
    { runs: 200, seed: 0xfeed },
  );
});
