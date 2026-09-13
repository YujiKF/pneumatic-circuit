import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveCascade, toCascadeCircuit } from '../../src/engine/index.ts';
import type { CascadeLogicalModel } from '../../src/engine/index.ts';
import { validateCircuit, ValidationCode } from '../../src/validator/index.ts';

function solve(raw: string): CascadeLogicalModel {
  const parsed = parseSequence(raw);
  assert.ok(parsed.ok);
  return solveCascade(parsed.value);
}

test('cascade validator: valid golden models pass with zero issues', () => {
  for (const seq of ['A+B+A-B-', 'A+B+B-A-', 'B-C+A+B+C-A-', 'A+B-B+T(A-B-)B+', 'A+B+D-A-B-C+C-D+']) {
    const model = solve(seq);
    const circuit = toCascadeCircuit(model);
    const report = validateCircuit(circuit, model);
    assert.equal(report.ok, true, `Sequence ${seq} should validate with zero issues`);
    assert.equal(report.issues.length, 0);
  }
});

test('cascade validator: detects incoherent memory count (Nm != NG - 1)', () => {
  const model = solve('A+B+B-A-');
  const mutated: CascadeLogicalModel = {
    ...model,
    numberOfMemories: 99, // Incoherent with 2 groups
  };
  const circuit = toCascadeCircuit(model);
  const report = validateCircuit(circuit, mutated);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === ValidationCode.LOGICAL_CONFLICT && i.message.includes('incoherent')));
});

test('cascade validator: detects memory activating and deactivating the same line (violates mutual exclusivity)', () => {
  const model = solve('A+B+B-A-');
  const mutated: CascadeLogicalModel = {
    ...model,
    memories: [
      {
        ...model.memories[0]!,
        activatesLineId: 'L1',
        deactivatesLineId: 'L1', // Same line!
      },
    ],
  };
  const circuit = toCascadeCircuit(model);
  const report = validateCircuit(circuit, mutated);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === ValidationCode.LOGICAL_CONFLICT && i.message.includes('mutual exclusivity')));
});

test('cascade validator: detects duplicate line id across groups', () => {
  const model = solve('A+B+B-A-');
  const mutated: CascadeLogicalModel = {
    ...model,
    groups: [
      { ...model.groups[0]!, lineId: 'L1' },
      { ...model.groups[1]!, lineId: 'L1' }, // Duplicate L1
    ],
  };
  const circuit = toCascadeCircuit(model);
  const report = validateCircuit(circuit, mutated);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === ValidationCode.LOGICAL_CONFLICT && i.message.includes('Duplicate pressure line')));
});

test('cascade validator: detects transition waiting on non-producible sensor (IMPOSSIBLE_TRANSITION)', () => {
  const model = solve('A+B+B-A-');
  const mutated: CascadeLogicalModel = {
    ...model,
    transitions: [
      {
        fromGroup: 1,
        toGroup: 2,
        memoryId: 'M1',
        conditionSensorIds: ['9S9'], // Impossible sensor, not produced by group 1
      },
    ],
  };
  const circuit = toCascadeCircuit(model);
  const report = validateCircuit(circuit, mutated);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === ValidationCode.IMPOSSIBLE_TRANSITION && i.message.includes('9S9')));
});
