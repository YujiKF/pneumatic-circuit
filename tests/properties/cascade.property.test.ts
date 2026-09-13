/**
 * Property-based test suite for the pneumatic cascade solver (PMR3407 Milestone 2).
 *
 * Implements properties P1 through P6 as specified in golden-tests.md §3 and tasks.md 2.9:
 *  - P1: No conflicting same-actuator movement in any group (REQ-CAS-PROP-NOCONFLICT, §C2.1).
 *  - P2: Every movement appears exactly once across groups (REQ-CAS-PROP-COVER, §C2).
 *  - P3: Movement order preserved under cascadeExecutionOrder (REQ-CAS-PROP-ORDER, §C4.2).
 *  - P4: Every group transition has a valid, producible condition (REQ-CAS-PROP-TRANSITION, §C5).
 *  - P5: Memory count coherent with group count (REQ-CAS-PROP-MEMCOHERENT, §C3).
 *  - P6: No two group lines permanently co-active / forward memory chain (REQ-CAS-PROP-EXCLUSIVE, §C7).
 *
 * Uses hand-rolled PRNG / forAll (fast-check not installable, zero npm dependencies).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import {
  divideIntoGroups,
  cascadeExecutionOrder,
  solveCascade,
  toCascadeCircuit,
} from '../../src/engine/index.ts';
import { validateCircuit } from '../../src/validator/index.ts';
import { forAll, type Arbitrary, type Rng } from './_arbitrary.ts';

const ACTUATORS = ['A', 'B', 'C', 'D'] as const;

interface GenCascadeSeq {
  readonly steps: ReadonlyArray<{ readonly actuator: string; readonly direction: '+' | '-' }>;
}

function toSeqString(seq: GenCascadeSeq): string {
  return seq.steps.map((s) => `${s.actuator}${s.direction}`).join('');
}

const cascadeSequenceArbitrary: Arbitrary<GenCascadeSeq> = {
  generate(rng: Rng): GenCascadeSeq {
    const actuatorCount = rng.intBetween(2, 4);
    const actuators = ACTUATORS.slice(0, actuatorCount);
    // position: false = retracted, true = extended
    const pos = new Map<string, boolean>();
    for (const a of actuators) pos.set(a, false);

    const moveCount = rng.intBetween(actuators.length, actuators.length * 3);
    const steps: Array<{ actuator: string; direction: '+' | '-' }> = [];
    for (let i = 0; i < moveCount; i++) {
      const actuator = rng.pick(actuators);
      const extended = pos.get(actuator) === true;
      const direction: '+' | '-' = extended ? '-' : '+';
      pos.set(actuator, !extended);
      steps.push({ actuator, direction });
    }

    // Balance the cycle: return every extended cylinder home
    for (const a of actuators) {
      if (pos.get(a) === true) {
        steps.push({ actuator: a, direction: '-' });
        pos.set(a, false);
      }
    }

    return { steps };
  },

  shrink(value: GenCascadeSeq): GenCascadeSeq[] {
    const out: GenCascadeSeq[] = [];
    if (value.steps.length > 2) {
      out.push({ steps: value.steps.slice(0, -2) });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// P1: No conflicting movement of same actuator in any group
// ---------------------------------------------------------------------------
test('P1: no conflicting movement of same actuator in any group (CASCADE §C2.1)', () => {
  forAll(
    cascadeSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toSeqString(seq));
      assert.ok(parsed.ok);
      for (const merge of [true, false]) {
        const division = divideIntoGroups(parsed.value, { mergeLastIntoFirst: merge });
        for (const group of division.groups) {
          const seen = new Map<string, Set<string>>();
          for (const mv of group.movements) {
            let set = seen.get(mv.actuator);
            if (set === undefined) {
              set = new Set();
              seen.set(mv.actuator, set);
            }
            set.add(mv.direction);
          }
          for (const [actuator, signs] of seen) {
            assert.ok(
              !(signs.has('+') && signs.has('-')),
              `Group ${group.number} contains conflicting directions (+ and -) for actuator ${actuator}`,
            );
          }
        }
      }
    },
    { runs: 120, seed: 0xca5ca },
  );
});

// ---------------------------------------------------------------------------
// P2: Every movement appears exactly once across groups
// ---------------------------------------------------------------------------
test('P2: every movement appears exactly once across groups (CASCADE §C2)', () => {
  forAll(
    cascadeSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toSeqString(seq));
      assert.ok(parsed.ok);
      const originalMovements = parsed.value.steps.flatMap((s) => s.movements);

      for (const merge of [true, false]) {
        const division = divideIntoGroups(parsed.value, { mergeLastIntoFirst: merge });
        const allGroupMovements = division.groups.flatMap((g) => g.movements);

        assert.equal(
          allGroupMovements.length,
          originalMovements.length,
          'total movement count must match sequence',
        );

        const origSorted = originalMovements
          .map((m) => `${m.actuator}${m.direction}`)
          .sort();
        const grpSorted = allGroupMovements
          .map((m) => `${m.actuator}${m.direction}`)
          .sort();

        assert.deepEqual(grpSorted, origSorted, 'multiset of movements matches sequence');
      }
    },
    { runs: 120, seed: 0xb00b },
  );
});

// ---------------------------------------------------------------------------
// P3: Movement order preserved
// ---------------------------------------------------------------------------
test('P3: cascadeExecutionOrder equals original movement order (CASCADE §C4.2)', () => {
  forAll(
    cascadeSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toSeqString(seq));
      assert.ok(parsed.ok);
      const originalMovements = parsed.value.steps.flatMap((s) => s.movements);

      for (const merge of [true, false]) {
        const division = divideIntoGroups(parsed.value, { mergeLastIntoFirst: merge });
        const execOrder = cascadeExecutionOrder(division);

        assert.deepEqual(
          execOrder.map((m) => `${m.actuator}${m.direction}`),
          originalMovements.map((m) => `${m.actuator}${m.direction}`),
          'reconstructed execution order must strictly preserve sequence order',
        );
      }
    },
    { runs: 120, seed: 0x07de },
  );
});

// ---------------------------------------------------------------------------
// P4: Every group transition has a valid, producible condition
// ---------------------------------------------------------------------------
test('P4: every group transition has a valid, producible condition (CASCADE §C5)', () => {
  forAll(
    cascadeSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toSeqString(seq));
      assert.ok(parsed.ok);
      const model = solveCascade(parsed.value);

      if (model.numberOfGroups > 1) {
        assert.equal(
          model.transitions.length,
          model.numberOfGroups - 1,
          'number of transitions equals NG - 1',
        );
        for (const tr of model.transitions) {
          assert.ok(tr.conditionSensorIds.length > 0, 'transition condition must not be empty');
          for (const sensorId of tr.conditionSensorIds) {
            assert.ok(
              model.sensorIds.includes(sensorId),
              `sensor ${sensorId} in transition condition must exist in model`,
            );
          }
        }
      }
    },
    { runs: 120, seed: 0x5e450 },
  );
});

// ---------------------------------------------------------------------------
// P5: Memory count coherent with group count
// ---------------------------------------------------------------------------
test('P5: memory count coherent with group count (CASCADE §C3)', () => {
  forAll(
    cascadeSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toSeqString(seq));
      assert.ok(parsed.ok);
      const model = solveCascade(parsed.value);

      const expectedMemories = Math.max(0, model.numberOfGroups - 1);
      assert.equal(model.numberOfMemories, expectedMemories, 'Nm == max(0, NG - 1)');
      assert.equal(model.memories.length, expectedMemories, 'memories.length == Nm');

      const circuit = toCascadeCircuit(model);
      const report = validateCircuit(circuit, model);
      assert.ok(
        report.ok,
        `circuit validation must pass: ${report.issues.map((i) => i.code).join(', ')}`,
      );
    },
    { runs: 120, seed: 0x900d },
  );
});

// ---------------------------------------------------------------------------
// P6: Mutual exclusivity / forward memory chain
// ---------------------------------------------------------------------------
test('P6: no two group lines permanently co-active / forward memory chain (CASCADE §C7)', () => {
  forAll(
    cascadeSequenceArbitrary,
    (seq) => {
      const parsed = parseSequence(toSeqString(seq));
      assert.ok(parsed.ok);
      const model = solveCascade(parsed.value);

      // Verify the forward memory chain: M(k) activates L(k+1) and deactivates L(k)
      for (let k = 0; k < model.memories.length; k++) {
        const mem = model.memories[k]!;
        assert.equal(mem.activatesLineId, `L${k + 2}`);
        assert.equal(mem.deactivatesLineId, `L${k + 1}`);
      }

      // No line is both activated and never deactivated
      const activatedLines = new Set(model.memories.map((m) => m.activatesLineId));
      const deactivatedLines = new Set(model.memories.map((m) => m.deactivatesLineId));

      // L1 is deactivated by M1 (when NG > 1)
      if (model.numberOfGroups > 1) {
        assert.ok(deactivatedLines.has('L1'), 'L1 must be deactivated by M1');
      }

      // Every intermediate line L2..L(NG-1) is both activated and deactivated
      for (let g = 2; g < model.numberOfGroups; g++) {
        const line = `L${g}`;
        assert.ok(activatedLines.has(line), `${line} must be activated`);
        assert.ok(deactivatedLines.has(line), `${line} must be deactivated`);
      }
    },
    { runs: 120, seed: 0xfa57 },
  );
});
