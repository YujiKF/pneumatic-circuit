/**
 * Behavioral suite for the STATE-DRIVEN cascade simulator (Milestone 2,
 * AUDIT_MILESTONE_2_ROUND2 acceptance criteria 1-4).
 *
 *  - the four mutations from the re-audit must each FAIL the cycle;
 *  - the three deck exercises execute in the exact physical order, visiting
 *    the lines in order and returning the memory chain to rest;
 *  - only one line is live at any stable point;
 *  - simultaneous predecessors gate on ALL members (BAIXO-2);
 *  - non-returning sequences are flagged (BAIXO-1).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveCascade, toCascadeCircuit } from '../../src/engine/index.ts';
import type { CascadeLogicalModel } from '../../src/engine/index.ts';
import { runCascadeCycle } from '../../src/simulator/index.ts';
import { nonReturningActuators } from '../../src/domain/index.ts';
import { generate } from '../../src/pipeline.ts';

function solve(raw: string): CascadeLogicalModel {
  const parsed = parseSequence(raw);
  assert.ok(parsed.ok, `sequence "${raw}" must parse`);
  return solveCascade(parsed.value, {});
}

function mutate(raw: string, fn: (m: CascadeLogicalModel) => void): CascadeLogicalModel {
  const m = structuredClone(solve(raw)) as CascadeLogicalModel;
  fn(m);
  return m;
}

// --- Audit mutation table: every corruption must break the cycle report ---
const MUTATIONS: ReadonlyArray<[string, (m: CascadeLogicalModel) => void, string]> = [
  ['M1.setSensorId -> ZZZ (broken handoff)', (m) => {
    (m.memories[0] as { setSensorId: string }).setSensorId = 'ZZZ';
  }, 'UNKNOWN_SENSOR'],
  ['group 2 activationSensorId -> BOGUS', (m) => {
    (m.groups[1] as { activationSensorId: string }).activationSensorId = 'BOGUS';
  }, 'INCONSISTENT_MODEL'],
  ['movement mainValveId -> 9.9 (nonexistent valve)', (m) => {
    (m.groups[0]!.movements[1] as { mainValveId: string }).mainValveId = '9.9';
  }, 'UNKNOWN_VALVE'],
  ['intra-group gate -> NEVER_ACTIVE', (m) => {
    (m.groups[0]!.movements[1] as { startSensorId: string }).startSensorId = 'NEVER_ACTIVE';
  }, 'DEADLOCK'],
];

for (const [label, fn, code] of MUTATIONS) {
  test(`mutation "${label}" fails the simulated cycle`, () => {
    const result = runCascadeCycle(mutate('A+B+A-B-', fn));
    assert.equal(result.completed, false);
    assert.ok(result.faults.length > 0);
    assert.ok(result.faults.some((f) => f.code === code), `expected a ${code} fault, got ${result.faults.map((f) => f.code).join(',')}`);
  });
}

test('a self-referential gate on a REAL sensor deadlocks behaviorally (Finding A shape)', () => {
  // B+ gated by its own arrival sensor 2S2: a real sensor, so no preflight
  // fault — only the behavioral simulation can catch that B+ is never piloted.
  const result = runCascadeCycle(mutate('A+B+A-B-', (m) => {
    const mv = m.groups[0]!.movements[1] as unknown as { startSensorId: string; startSensorIds: string[] };
    mv.startSensorId = '2S2';
    mv.startSensorIds = ['2S2'];
  }));
  assert.equal(result.completed, false);
  assert.ok(result.faults.every((f) => f.cycle > 0), 'caught by simulation, not preflight');
  assert.ok(result.faults.some((f) => f.code === 'DEADLOCK'));
  assert.deepEqual([...result.executedMovements], ['A+']);
});

test('a memory set by a REAL but wrong sensor never hands control to line 2', () => {
  const result = runCascadeCycle(mutate('A+B+B-A-', (m) => {
    (m.memories[0] as { setSensorId: string }).setSensorId = '1S1';
    (m.transitions[0] as unknown as { conditionSensorIds: string[] }).conditionSensorIds = ['1S1'];
    (m.groups[1] as { activationSensorId: string }).activationSensorId = '1S1';
  }));
  assert.equal(result.completed, false);
});

test('removing the wrap (last memory reset) leaves the chain off rest', () => {
  const result = runCascadeCycle(mutate('A+B+A-B-', (m) => {
    delete (m.memories[0] as { resetSensorId?: string }).resetSensorId;
    delete (m as { returnTransition?: unknown }).returnTransition;
  }));
  assert.equal(result.completed, false);
  assert.equal(result.restored, false);
});

// --- Deck exercises: physical order, lines visited, chain returns to rest ---
const DECK: ReadonlyArray<[string, string[], string[]]> = [
  ['B-C+A+B+C-A-', ['B-', 'C+', 'A+', 'B+', 'C-', 'A-'], ['L1', 'L2']], // deck 1 Ex3a
  ['A+B+/B-A-', ['A+', 'B+', 'B-', 'A-'], ['L1', 'L2']], // deck 4 p.63
  ['A+B-B+T(A-B-)B+', ['A+', 'B-', 'B+', 'A-', 'B-', 'B+'], ['L1', 'L2', 'L3', 'L4']], // deck 5
];

for (const [seq, order, lines] of DECK) {
  test(`deck golden "${seq}" executes in physical order and returns to rest`, () => {
    const result = runCascadeCycle(solve(seq), { cycles: 2 });
    assert.deepEqual(result.faults, []);
    assert.equal(result.completed, true);
    assert.deepEqual([...result.executedMovements], [...order, ...order]);
    assert.deepEqual([...result.visitedLines], lines);
    assert.equal(result.restored, true);
    assert.equal(result.balanced, true);
  });
}

test('merged last-into-first: tail runs after the wrap, on line 1', () => {
  const model = solve('A+B-A-C+B+C-');
  assert.equal(model.merged, true);
  const result = runCascadeCycle(model, { cycles: 2 });
  assert.deepEqual(result.faults, []);
  assert.deepEqual([...result.expectedMovements], ['A+', 'B-', 'A-', 'C+', 'B+', 'C-']);
  // Hand-off to L2 is at the end of the HEAD (B- -> 2S1), not the tail.
  assert.equal(model.memories[0]!.setSensorId, '2S1');
});

test('only one line is live at any stable point (C7 exclusivity)', () => {
  for (const seq of ['A+B+A-B-', 'A+B-B+T(A-B-)B+', 'A+B+D-A-B-C+C-D+']) {
    const result = runCascadeCycle(solve(seq), { cycles: 2 });
    assert.ok(!result.faults.some((f) => f.code === 'LINE_EXCLUSIVITY'), seq);
  }
});

test('START gates the first step: one press runs exactly one cycle, then rest', () => {
  const model = solve('A+B+A-B-');
  assert.equal(model.groups[0]!.movements[0]!.gatedByStart, true);
  // After the wrap back to line 1 the released START keeps A+ un-piloted, so
  // the circuit is quiescent (single cycle, RULES §9).
  const result = runCascadeCycle(model, { cycles: 1 });
  assert.equal(result.events.filter((e) => e.kind === 'start').length, 1);
  assert.equal(result.executedMovements.length, 4);
});

// --- BAIXO-2: simultaneous predecessor gates on ALL members ---
test('BAIXO-2: memory SET after a simultaneous step waits on every member', () => {
  const model = solve('A+(B+C+)A-(B-C-)');
  assert.deepEqual([...model.transitions[0]!.conditionSensorIds].sort(), ['2S2', '3S2']);
  // Both simultaneous members share the gate of the previous step.
  const g1 = model.groups[0]!.movements;
  assert.deepEqual(g1[1]!.startSensorIds, ['1S2']);
  assert.deepEqual(g1[2]!.startSensorIds, ['1S2']);
  // Projection: the SET pilot is fed through BOTH sensors in series.
  const circuit = toCascadeCircuit(model);
  const into = (comp: string, port: string) =>
    circuit.connections.filter((c) => c.targetComponent === comp && c.targetPort === port).map((c) => c.sourceComponent);
  const firstInChain = into('0.1', '14');
  assert.equal(firstInChain.length, 1);
  assert.ok(['2S2', '3S2'].includes(firstInChain[0]!));
  // Behavior: 0.1 is SET only after both 2S2 and 3S2 are active.
  const events = runCascadeCycle(model).events;
  const setAt = events.findIndex((e) => e.id === '0.1' && e.detail === 'SET');
  const s2 = events.findIndex((e) => e.kind === 'sensor-active' && e.id === '2S2');
  const s3 = events.findIndex((e) => e.kind === 'sensor-active' && e.id === '3S2');
  assert.ok(setAt > s2 && setAt > s3, 'memory set before all simultaneous members arrived');
});

test('BAIXO-2 (mutation): if one simultaneous member never arrives, line 2 never activates', () => {
  const result = runCascadeCycle(mutate('A+(B+C+)A-(B-C-)', (m) => {
    // C+ commanded on the retract pilot by mistake -> 3S2 never activates.
    (m.groups[0]!.movements[2] as { pilotPort: string }).pilotPort = '12';
  }));
  assert.equal(result.completed, false);
  assert.ok(!result.visitedLines.includes('L2'));
});

// --- BAIXO-1: non-returning sequences ---
test('BAIXO-1: nonReturningActuators flags sequences that do not return home', () => {
  const p = (s: string) => {
    const r = parseSequence(s);
    assert.ok(r.ok);
    return r.value;
  };
  assert.deepEqual(nonReturningActuators(p('A+B+')), ['A', 'B']);
  assert.deepEqual(nonReturningActuators(p('A+A+')), ['A']);
  assert.deepEqual(nonReturningActuators(p('A+B+B-A-')), []);
  assert.deepEqual(nonReturningActuators(p('B-C+A+B+C-A-')), []);
});

test('BAIXO-1: pipeline warns on a non-returning sequence and reports simulation', () => {
  const warned = generate({ sequence: 'A+B+', type: 'pneumatic', method: 'cascade', mode: 'single' });
  assert.ok((warned.warnings ?? []).some((w) => /nao retorna/.test(w)));
  const ok = generate({ sequence: 'A+B+B-A-', type: 'pneumatic', method: 'cascade', mode: 'single' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.warnings, []);
  assert.equal(ok.simulation?.completed, true);
  assert.equal(ok.simulation?.cyclesCompleted, 2);
  assert.deepEqual(ok.simulation?.executedMovements, ['A+', 'B+', 'B-', 'A-']);
});

test('pipeline refuses a cascade circuit that fails the behavioral simulation', () => {
  const r = generate({ sequence: 'C+A+C-A-C+A-', type: 'pneumatic', method: 'cascade', mode: 'single' });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /simulacao/);
  assert.equal(r.simulation?.completed, false);
});
