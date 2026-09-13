/**
 * ADVERSARIAL AUDIT SUITE — Cascade Pneumatic (Milestone 2).
 *
 * Written during the Milestone-2 adversarial audit. Unlike the golden/property
 * suites (which assert group STRUCTURE and STRUCTURAL validation), these tests
 * probe BEHAVIORAL correctness and known gaps. Some assertions PIN correct
 * sub-behavior; others call `t.todo(...)` to DOCUMENT a defect the current
 * implementation does not yet satisfy (the audit classifies each as
 * CRITICAL/MEDIUM/LOW). A `todo` test is reported by `node --test` as a known
 * pending item, not a silent pass — it is the regression hook for the fix.
 *
 * See docs/AUDIT_MILESTONE_2.md for the full findings and classifications.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveCascade, toCascadeCircuit } from '../../src/engine/index.ts';
import type { CascadeLogicalModel } from '../../src/engine/index.ts';
import type { Connection } from '../../src/domain/index.ts';
import { runCascadeCycle } from '../../src/simulator/index.ts';

function solve(raw: string, opts?: Parameters<typeof parseSequence>[1]): CascadeLogicalModel {
  const parsed = parseSequence(raw, opts);
  assert.ok(parsed.ok, `sequence "${raw}" must parse`);
  return solveCascade(parsed.value, {});
}

// ---------------------------------------------------------------------------
// FINDING A (MEDIUM) — duplicate stroke-end sensor within a group.
// When the same actuator moves twice in the SAME direction inside one group
// (e.g. B+ then B+), both movements carry the SAME arrival sensor id, and the
// second is "gated" by the first's arrival sensor which is its OWN advanced
// sensor. This violates RULES §4 ("não usar dois sensores na mesma posição")
// at the logic level and produces a degenerate gate. The solver currently
// emits it without complaint.
// ---------------------------------------------------------------------------
test('FINDING A: duplicate same-direction movement in a group avoids a self-referential gate', () => {
  const model = solve('A+B+B+A-B-B-');
  const g1 = model.groups[0]!;
  const bMoves = g1.movements.filter((m) => m.actuator === 'B');
  assert.equal(bMoves.length, 2);
  assert.equal(bMoves[0]!.arrivalSensorId, '2S2');
  assert.equal(bMoves[1]!.arrivalSensorId, '2S2');
  // Resolved: the 2nd B+ is gated by the previous distinct arrival sensor in the group (1S2)
  assert.equal(bMoves[1]!.startSensorId, '1S2', 'gated by previous distinct sensor, avoiding self-referential gate');
});

test('FINDING A (fix target): solver should flag or resolve a repeated same-position sensor in a group', () => {
  const model = solve('A+B+B+A-B-B-');
  const g1 = model.groups[0]!;
  const bMoves = g1.movements.filter((m) => m.actuator === 'B');
  // A correct treatment must NOT gate a movement on the very sensor it trips.
  assert.notEqual(
    bMoves[1]!.startSensorId,
    bMoves[1]!.arrivalSensorId,
    'a movement must not be gated by its own arrival sensor',
  );
});

// ---------------------------------------------------------------------------
// FINDING B (CRITICAL) — behavioral verification that the cascade circuit
// reproduces the sequence and returns to the initial state.
// ---------------------------------------------------------------------------
test('FINDING B (fix target): a cascade simulator must reproduce the sequence and return home', () => {
  for (const seq of ['A+B+A-B-', 'A+B+B-A-', 'B-C+A+B+C-A-', 'A+B-B+T(A-B-)B+']) {
    const model = solve(seq);
    const result = runCascadeCycle(model);
    assert.equal(result.completed, true, `sequence "${seq}" must complete cycle`);
    assert.equal(result.balanced, true, `sequence "${seq}" must return home`);
    assert.ok(result.executedMovements.length > 0);
  }
});

// ---------------------------------------------------------------------------
// FINDING D (CRITICAL) — activation sensors reused across the memory chain are
// wired with group line gating.
// ---------------------------------------------------------------------------
test('FINDING D: activation sensor is reused across multiple memory pilots', () => {
  const model = solve('A+B-B+T(A-B-)B+');
  const setBy2S1 = model.memories.filter((m) => m.setSensorId === '2S1').map((m) => m.id);
  assert.deepEqual(setBy2S1, ['M1', 'M3'], 'documents 2S1 reused as SET for M1 and M3');
  const m1 = model.memories.find((m) => m.id === 'M1')!;
  const m2 = model.memories.find((m) => m.id === 'M2')!;
  assert.equal(m1.setSensorId, '2S1');
  assert.equal(m1.resetSensorId, '2S2');
  assert.equal(m2.setSensorId, '2S2');
  assert.equal(m2.resetSensorId, '2S1');
});

test('FINDING D (fix target): reused activation sensors must be gated by their group line', () => {
  const model = solve('A+B-B+T(A-B-)B+');
  const circuit = toCascadeCircuit(model);
  const pilotDrivers = new Map<string, string[]>();
  for (const c of circuit.connections as Connection[]) {
    if (/^0\.\d+$/.test(c.targetComponent) && (c.targetPort === '12' || c.targetPort === '14')) {
      const arr = pilotDrivers.get(c.sourceComponent) ?? [];
      arr.push(`${c.targetComponent}:${c.targetPort}`);
      pilotDrivers.set(c.sourceComponent, arr);
    }
  }
  for (const [sensor, targets] of pilotDrivers) {
    assert.ok(
      targets.length <= 1,
      `sensor ${sensor} drives ${targets.length} memory pilots (${targets.join(',')}) without line gating`,
    );
  }
});

// ---------------------------------------------------------------------------
// FINDING C (MEDIUM) — memory-chain reset for cycle return is unproven. The
// last memory has resetSensorId undefined and is reset via the supply line in
// the projection, but nothing verifies the whole chain returns to rest so a
// second cycle can run. Pin the current shape; a simulator (Finding B) is the
// real fix.
// ---------------------------------------------------------------------------
test('FINDING C: last memory has no downstream reset sensor (relies on supply line)', () => {
  const model = solve('A+B-B+T(A-B-)B+');
  const last = model.memories[model.memories.length - 1]!;
  assert.equal(last.id, 'M3');
  assert.equal(last.resetSensorId, undefined, 'documents the last memory has no sensor reset');
});

// ---------------------------------------------------------------------------
// SANITY (passes) — division correctness the audit CONFIRMS is right, kept as
// positive regression anchors alongside the defect markers.
// ---------------------------------------------------------------------------
test('SANITY: group division and Nm are correct for the canonical deck example', () => {
  const model = solve('A+B+B-A-');
  assert.deepEqual(
    model.groups.map((g) => g.movements.map((m) => `${m.actuator}${m.direction}`).join('')),
    ['A+B+', 'B-A-'],
  );
  assert.equal(model.numberOfMemories, 1);
  assert.equal(model.groups[1]!.activationSensorId, '2S2');
});

test('SANITY: no hardcoded grouping — a novel sequence divides by the rule', () => {
  const model = solve('C+A+C-A-C+A-');
  for (const g of model.groups) {
    const dirs = new Map<string, Set<string>>();
    for (const m of g.movements) {
      const s = dirs.get(m.actuator) ?? new Set<string>();
      s.add(m.direction);
      dirs.set(m.actuator, s);
    }
    for (const [act, signs] of dirs) {
      assert.ok(!(signs.has('+') && signs.has('-')), `group ${g.number} conflicts on ${act}`);
    }
  }
});
