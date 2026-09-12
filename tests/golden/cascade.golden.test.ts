/**
 * GOLDEN TESTS for the cascade (método cascata) PNEUMATIC method.
 *
 * Each entry encodes a worked PMR3407 exercise as a regression fixture:
 *   - input sequence + method (cascade) + type (pneumatic)
 *   - expected LOGICAL result: group contents, number of groups/lines, number
 *     of memory valves Nm = groups - 1, memory-valve set/reset sensors, and the
 *     intra-group vs group-activation sensor placement.
 *   - the produced pneumatic circuit passes the CircuitValidator with ZERO
 *     issues.
 *
 * The GROUP CONTENTS + Nm are asserted INDEPENDENTLY of any drawing (from the
 * logical model), per the user requirement. If any assertion breaks, a change
 * altered the meaning of a solved cascade circuit and must be reviewed.
 *
 * GOLDEN EXERCISE REGISTER
 * ------------------------
 * | input             | method  | type      | expected groups          | Nm |
 * |-------------------|---------|-----------|--------------------------|----|
 * | A+B+B-A-          | cascade | pneumatic | [A+ B+] [B- A-]          | 1  |
 * | A+B+/B-A-         | cascade | pneumatic | [A+ B+] [B- A-]          | 1  |
 * | B-C+A+B+C-A-      | cascade | pneumatic | [B- C+ A+] [B+ C- A-]    | 1  |
 * | A+B-B+T(A-B-)B+   | cascade | pneumatic | [A+ B-][B+][A- B-][B+]   | 3  |
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveCascade, toCascadeCircuit } from '../../src/engine/index.ts';
import type { CascadeLogicalModel } from '../../src/engine/index.ts';
import { validateCircuit } from '../../src/validator/index.ts';

function solve(
  raw: string,
  opts?: Parameters<typeof parseSequence>[1],
): CascadeLogicalModel {
  const parsed = parseSequence(raw, opts);
  assert.ok(parsed.ok, `sequence "${raw}" must parse`);
  return solveCascade(parsed.value);
}

/** Group contents as "A+B+" strings. */
function groupShape(model: CascadeLogicalModel): string[] {
  return model.groups.map((g) =>
    g.movements.map((m) => `${m.actuator}${m.direction}`).join(''),
  );
}

/** Every cascade circuit MUST validate with zero issues. */
function assertClean(model: CascadeLogicalModel): void {
  const report = validateCircuit(toCascadeCircuit(model));
  assert.ok(
    report.ok,
    `cascade circuit for "${model.sequence}" has issues: ${report.issues
      .map((i) => `${i.code}:${i.subject}`)
      .join(',')}`,
  );
}

// ---------------------------------------------------------------------------
// Golden: A+B+B-A-  -> Group I [A+ B+], Group II [B- A-], Nm=1
// ---------------------------------------------------------------------------
test("golden cascade A+B+B-A-: 2 groups, Nm=1, one memory valve M1", () => {
  const model = solve('A+B+B-A-');
  assert.equal(model.method, 'cascade');
  assert.deepEqual(groupShape(model), ['A+B+', 'B-A-']);
  assert.equal(model.numberOfGroups, 2);
  assert.equal(model.numberOfMemories, 1);

  // Group II is activated by the LAST event of group I (B reaches advanced).
  assert.equal(model.groups[0]!.activationSensorId, undefined);
  assert.equal(model.groups[1]!.activationSensorId, '2S2'); // B+ arrival

  // Exactly one bistable memory valve M1, set by group II's activation sensor.
  assert.equal(model.memories.length, 1);
  const m1 = model.memories[0]!;
  assert.equal(m1.id, 'M1');
  assert.equal(m1.setSensorId, '2S2');
  assert.equal(m1.activatesLineId, 'L2');
  assert.equal(m1.deactivatesLineId, 'L1');

  // Intra-group sensor placement: within group I, A+ starts on the line (no
  // gating sensor) and B+ is gated by A's arrival sensor 1S2.
  const g1 = model.groups[0]!;
  assert.equal(g1.movements[0]!.startSensorId, undefined); // A+ starts on line
  assert.equal(g1.movements[1]!.startSensorId, '1S2'); // B+ gated by A+ arrival

  assertClean(model);
});

test("golden cascade A+B+/B-A- (slash) equals A+B+B-A-", () => {
  const slash = solve('A+B+/B-A-');
  const plain = solve('A+B+B-A-');
  assert.deepEqual(groupShape(slash), groupShape(plain));
  assert.equal(slash.numberOfMemories, 1);
  assertClean(slash);
});

// ---------------------------------------------------------------------------
// Golden: B-C+A+B+C-A-  -> [B- C+ A+] [B+ C- A-], Nm=1
// ---------------------------------------------------------------------------
test("golden cascade B-C+A+B+C-A-: generic groups, Nm=1", () => {
  const model = solve('B-C+A+B+C-A-', { initialState: { B: 'extended' } });
  assert.deepEqual(groupShape(model), ['B-C+A+', 'B+C-A-']);
  assert.equal(model.numberOfGroups, 2);
  assert.equal(model.numberOfMemories, 1);

  // Group II activated by the last event of group I (A reaches advanced -> 1S2).
  assert.equal(model.groups[1]!.activationSensorId, '1S2');
  assert.equal(model.memories[0]!.setSensorId, '1S2');

  assertClean(model);
});

// ---------------------------------------------------------------------------
// Golden: A+B-B+T(A-B-)B+  -> [A+ B-][B+][A- B-][B+], Nm=3
// ---------------------------------------------------------------------------
test("golden cascade A+B-B+T(A-B-)B+: 4 groups, Nm=3, three memory valves", () => {
  const model = solve('A+B-B+T(A-B-)B+');
  assert.deepEqual(groupShape(model), ['A+B-', 'B+', 'A-B-', 'B+']);
  assert.equal(model.numberOfGroups, 4);
  assert.equal(model.numberOfMemories, 3);

  // Three bistable memory valves M1..M3, one per group transition.
  assert.deepEqual(
    model.memories.map((m) => m.id),
    ['M1', 'M2', 'M3'],
  );
  // Each memory hands control from line k to line k+1.
  assert.deepEqual(
    model.memories.map((m) => `${m.deactivatesLineId}->${m.activatesLineId}`),
    ['L1->L2', 'L2->L3', 'L3->L4'],
  );

  // Group activation sensors = last event of previous group:
  //   G2 <- last of G1 (B-) -> 2S1
  //   G3 <- last of G2 (B+) -> 2S2
  //   G4 <- last of G3 (A-B- simultaneous, last listed B-) -> 2S1
  assert.equal(model.groups[1]!.activationSensorId, '2S1');
  assert.equal(model.groups[2]!.activationSensorId, '2S2');
  assert.equal(model.groups[3]!.activationSensorId, '2S1');

  assertClean(model);
});

// ---------------------------------------------------------------------------
// Explanation projection (Grupo I / Grupo II / ...) matches the group model.
// ---------------------------------------------------------------------------
test("cascade explanation lists Grupo I/II with movements and Nm", () => {
  const model = solve('A+B+B-A-');
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
