/**
 * EMPIRICAL CHALLENGER VERIFICATION SUITE
 *
 * Exhaustive empirical verification of the 5 PMR3407 Step-by-Step golden sequences:
 * 1. A+B+A-B- (4 steps, direct)
 * 2. A+B+B-A- (4 steps, indirect / overlap)
 * 3. A+B+C+A-B-C- (6 steps, 3 cylinders)
 * 4. B-C+A+B+C-A- (6 steps, cylinder B initially extended)
 * 5. A-B+B-B+B-TA+ (6 steps, timer and repetitions)
 *
 * Verifies:
 * - Step plan & relay allocation (K1..Kn)
 * - Solenoid power rungs & paralleling
 * - Initial states (extended cylinders start at S2 / STATE_2)
 * - Full simulation completion without stalls
 * - Complete chronological explanation text generated
 * - Valid SVG rendering for both pneumatic and ladder diagrams without NaNs/undefineds
 * - Adversarial stress tests (multi-extended cylinders, continuity, seal verification)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep, toCircuit } from '../../src/engine/index.ts';
import type { CircuitLogicalModel } from '../../src/engine/index.ts';
import { validateCircuit } from '../../src/validator/index.ts';
import { runCycle, explain, initialSimState } from '../../src/simulator/index.ts';
import { renderPneumatic, renderLadder } from '../../src/renderer/index.ts';
import { generate } from '../../src/pipeline.ts';
import { mainValveId, cylinderId } from '../../src/engine/naming.ts';

function solve(seq: string, mode: 'single' | 'continuous' = 'single'): CircuitLogicalModel {
  const parsed = parseSequence(seq);
  assert.ok(parsed.ok, `Sequence "${seq}" failed to parse: ${parsed.ok ? '' : parsed.error.message}`);
  return solveStepByStep(parsed.value, { cycleMode: mode });
}

function verifySvgIntegrity(svg: string, label: string) {
  assert.ok(svg && svg.length > 100, `${label} SVG is non-empty`);
  assert.ok(svg.startsWith('<svg') || svg.includes('<svg'), `${label} contains <svg tag`);
  assert.ok(svg.includes('</svg>'), `${label} contains </svg> closing tag`);
  assert.ok(!svg.includes('NaN'), `${label} must not contain NaN`);
  assert.ok(!svg.includes('undefined'), `${label} must not contain undefined`);
  assert.ok(!svg.includes('null'), `${label} must not contain null`);
}

// ---------------------------------------------------------------------------
// 1. Golden: A+B+A-B-
// ---------------------------------------------------------------------------
test('Challenger verification: A+B+A-B- (4 steps, direct)', () => {
  const model = solve('A+B+A-B-');

  // Step plan & relay allocation
  assert.equal(model.steps.length, 4);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4']);
  assert.deepEqual(model.actuators, ['A', 'B']);

  // Initial state: both retracted
  assert.equal(model.initialState?.positions['A'], 'retracted');
  assert.equal(model.initialState?.positions['B'], 'retracted');

  const simInit = initialSimState(model);
  assert.equal(simInit.cylinders.get('A'), 'RETRACTED');
  assert.equal(simInit.cylinders.get('B'), 'RETRACTED');
  assert.equal(simInit.sensors.get('1S1'), 'ACTIVE');
  assert.equal(simInit.sensors.get('1S2'), 'INACTIVE');
  assert.equal(simInit.sensors.get('2S1'), 'ACTIVE');
  assert.equal(simInit.sensors.get('2S2'), 'INACTIVE');
  assert.equal(simInit.valves.get(mainValveId('A')), 'STATE_1');
  assert.equal(simInit.valves.get(mainValveId('B')), 'STATE_1');

  // Rungs: 4 control + 4 power = 8 rungs
  assert.equal(model.ladder.rungs.length, 8);
  const powerRungs = model.ladder.rungs.filter((r) => r.coil.kind === 'solenoid');
  assert.equal(powerRungs.length, 4);
  assert.deepEqual(powerRungs.map((r) => r.coil.id), ['1Y1', '2Y1', '1Y2', '2Y2']);

  // Validation
  const circuit = toCircuit(model);
  const report = validateCircuit(circuit, model);
  assert.ok(report.ok, `Validation failed: ${report.issues.map((i) => i.code).join(',')}`);

  // Simulation
  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true, 'Cycle must complete');
  assert.equal(sim.state.cylinders.get('A'), 'RETRACTED');
  assert.equal(sim.state.cylinders.get('B'), 'RETRACTED');

  // Explanation
  const lines = explain(model);
  assert.ok(lines.length >= 8);
  assert.ok(lines[0]?.includes('START'));
  assert.ok(lines.some((l) => l.includes('cycle for A+B+A-B- is complete')));

  // SVG rendering
  const pSvg = renderPneumatic(circuit, { model });
  const lSvg = renderLadder(circuit, model);
  verifySvgIntegrity(pSvg, 'A+B+A-B- pneumatic');
  verifySvgIntegrity(lSvg, 'A+B+A-B- ladder');
  assert.ok(lSvg.includes('+24V') && lSvg.includes('0V'));
  assert.ok(pSvg.includes(cylinderId('A')) && pSvg.includes(cylinderId('B')));

  // Pipeline facade
  const res = generate({ sequence: 'A+B+A-B-', type: 'electropneumatic', method: 'step-by-step', mode: 'single' });
  assert.ok(res.ok);
  assert.ok(res.pneumaticSvg && res.ladderSvg && res.funcionamento);
});

// ---------------------------------------------------------------------------
// 2. Golden: A+B+B-A-
// ---------------------------------------------------------------------------
test('Challenger verification: A+B+B-A- (4 steps, indirect / overlap)', () => {
  const model = solve('A+B+B-A-');

  // Step plan & relay allocation
  assert.equal(model.steps.length, 4);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4']);

  // Initial state
  assert.equal(model.initialState?.positions['A'], 'retracted');
  assert.equal(model.initialState?.positions['B'], 'retracted');

  const simInit = initialSimState(model);
  assert.equal(simInit.cylinders.get('A'), 'RETRACTED');
  assert.equal(simInit.cylinders.get('B'), 'RETRACTED');
  assert.equal(simInit.valves.get(mainValveId('A')), 'STATE_1');
  assert.equal(simInit.valves.get(mainValveId('B')), 'STATE_1');

  // Power rungs: 4 unique solenoids (1Y1, 2Y1, 2Y2, 1Y2)
  assert.equal(model.ladder.rungs.length, 8);
  const powerRungs = model.ladder.rungs.filter((r) => r.coil.kind === 'solenoid');
  assert.equal(powerRungs.length, 4);
  assert.deepEqual(powerRungs.map((r) => r.coil.id), ['1Y1', '2Y1', '2Y2', '1Y2']);

  // Validation
  const circuit = toCircuit(model);
  const report = validateCircuit(circuit, model);
  assert.ok(report.ok);

  // Simulation
  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true);
  assert.equal(sim.state.cylinders.get('A'), 'RETRACTED');
  assert.equal(sim.state.cylinders.get('B'), 'RETRACTED');

  // Explanation
  const lines = explain(model);
  assert.ok(lines.length >= 8);
  assert.ok(lines.some((l) => l.includes('cycle for A+B+B-A- is complete')));

  // SVG rendering
  const pSvg = renderPneumatic(circuit, { model });
  const lSvg = renderLadder(circuit, model);
  verifySvgIntegrity(pSvg, 'A+B+B-A- pneumatic');
  verifySvgIntegrity(lSvg, 'A+B+B-A- ladder');
  assert.ok(pSvg.includes(cylinderId('A')) && pSvg.includes(cylinderId('B')));
});

// ---------------------------------------------------------------------------
// 3. Golden: A+B+C+A-B-C-
// ---------------------------------------------------------------------------
test('Challenger verification: A+B+C+A-B-C- (6 steps, 3 cylinders)', () => {
  const model = solve('A+B+C+A-B-C-');

  // Step plan & relay allocation
  assert.equal(model.steps.length, 6);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
  assert.deepEqual(model.actuators, ['A', 'B', 'C']);

  // Initial state: all retracted
  assert.equal(model.initialState?.positions['A'], 'retracted');
  assert.equal(model.initialState?.positions['B'], 'retracted');
  assert.equal(model.initialState?.positions['C'], 'retracted');

  const simInit = initialSimState(model);
  assert.equal(simInit.cylinders.get('A'), 'RETRACTED');
  assert.equal(simInit.cylinders.get('B'), 'RETRACTED');
  assert.equal(simInit.cylinders.get('C'), 'RETRACTED');
  assert.equal(simInit.valves.get(mainValveId('A')), 'STATE_1');
  assert.equal(simInit.valves.get(mainValveId('B')), 'STATE_1');
  assert.equal(simInit.valves.get(mainValveId('C')), 'STATE_1');

  // Power rungs: 6 control + 6 power = 12 rungs
  assert.equal(model.ladder.rungs.length, 12);
  const powerRungs = model.ladder.rungs.filter((r) => r.coil.kind === 'solenoid');
  assert.equal(powerRungs.length, 6);
  assert.deepEqual(powerRungs.map((r) => r.coil.id), ['1Y1', '2Y1', '3Y1', '1Y2', '2Y2', '3Y2']);

  // Validation
  const circuit = toCircuit(model);
  const report = validateCircuit(circuit, model);
  assert.ok(report.ok);

  // Simulation
  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true);
  assert.equal(sim.state.cylinders.get('A'), 'RETRACTED');
  assert.equal(sim.state.cylinders.get('B'), 'RETRACTED');
  assert.equal(sim.state.cylinders.get('C'), 'RETRACTED');

  // Explanation
  const lines = explain(model);
  assert.ok(lines.length >= 12);
  assert.ok(lines.some((l) => l.includes('cycle for A+B+C+A-B-C- is complete')));

  // SVG rendering
  const pSvg = renderPneumatic(circuit, { model });
  const lSvg = renderLadder(circuit, model);
  verifySvgIntegrity(pSvg, 'A+B+C+A-B-C- pneumatic');
  verifySvgIntegrity(lSvg, 'A+B+C+A-B-C- ladder');
  assert.ok(pSvg.includes(cylinderId('A')) && pSvg.includes(cylinderId('B')) && pSvg.includes(cylinderId('C')));
});

// ---------------------------------------------------------------------------
// 4. Golden: B-C+A+B+C-A-
// ---------------------------------------------------------------------------
test('Challenger verification: B-C+A+B+C-A- (6 steps, cylinder B initially extended)', () => {
  const model = solve('B-C+A+B+C-A-');

  // Step plan & relay allocation
  assert.equal(model.steps.length, 6);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);

  // Initial state: B extended, A and C retracted
  assert.equal(model.initialState?.positions['B'], 'extended');
  assert.equal(model.initialState?.positions['A'], 'retracted');
  assert.equal(model.initialState?.positions['C'], 'retracted');

  const simInit = initialSimState(model);
  assert.equal(simInit.cylinders.get('B'), 'EXTENDED');
  assert.equal(simInit.cylinders.get('A'), 'RETRACTED');
  assert.equal(simInit.cylinders.get('C'), 'RETRACTED');
  assert.equal(simInit.sensors.get('2S2'), 'ACTIVE');
  assert.equal(simInit.sensors.get('2S1'), 'INACTIVE');
  assert.equal(simInit.valves.get(mainValveId('B')), 'STATE_2');
  assert.equal(simInit.valves.get(mainValveId('A')), 'STATE_1');
  assert.equal(simInit.valves.get(mainValveId('C')), 'STATE_1');

  // Power rungs: 6 unique solenoids (2Y2, 3Y1, 1Y1, 2Y1, 3Y2, 1Y2)
  assert.equal(model.ladder.rungs.length, 12);
  const powerRungs = model.ladder.rungs.filter((r) => r.coil.kind === 'solenoid');
  assert.equal(powerRungs.length, 6);
  assert.deepEqual(powerRungs.map((r) => r.coil.id), ['2Y2', '3Y1', '1Y1', '2Y1', '3Y2', '1Y2']);

  // Validation
  const circuit = toCircuit(model);
  const report = validateCircuit(circuit, model);
  assert.ok(report.ok);

  // Simulation: full completion, B returns to extended
  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true);
  assert.equal(sim.state.cylinders.get('A'), 'RETRACTED');
  assert.equal(sim.state.cylinders.get('B'), 'EXTENDED');
  assert.equal(sim.state.cylinders.get('C'), 'RETRACTED');

  // Explanation
  const lines = explain(model);
  assert.ok(lines.length >= 12);
  assert.ok(lines.some((l) => l.includes('cycle for B-C+A+B+C-A- is complete')));

  // SVG rendering
  const pSvg = renderPneumatic(circuit, { model });
  const lSvg = renderLadder(circuit, model);
  verifySvgIntegrity(pSvg, 'B-C+A+B+C-A- pneumatic');
  verifySvgIntegrity(lSvg, 'B-C+A+B+C-A- ladder');
  assert.ok(pSvg.includes(cylinderId('A')) && pSvg.includes(cylinderId('B')) && pSvg.includes(cylinderId('C')));
});

// ---------------------------------------------------------------------------
// 5. Golden: A-B+B-B+B-TA+
// ---------------------------------------------------------------------------
test('Challenger verification: A-B+B-B+B-TA+ (6 steps, timer and repetitions)', () => {
  const model = solve('A-B+B-B+B-TA+');

  // Step plan & relay allocation
  assert.equal(model.steps.length, 6);
  assert.deepEqual(model.relayIds, ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);

  // Initial state: A extended, B retracted
  assert.equal(model.initialState?.positions['A'], 'extended');
  assert.equal(model.initialState?.positions['B'], 'retracted');

  const simInit = initialSimState(model);
  assert.equal(simInit.cylinders.get('A'), 'EXTENDED');
  assert.equal(simInit.cylinders.get('B'), 'RETRACTED');
  assert.equal(simInit.sensors.get('1S2'), 'ACTIVE');
  assert.equal(simInit.sensors.get('1S1'), 'INACTIVE');
  assert.equal(simInit.sensors.get('2S1'), 'ACTIVE');
  assert.equal(simInit.sensors.get('2S2'), 'INACTIVE');
  assert.equal(simInit.valves.get(mainValveId('A')), 'STATE_2');
  assert.equal(simInit.valves.get(mainValveId('B')), 'STATE_1');

  // Timer check on step 5 (K6)
  assert.equal(model.steps[5]?.hasTimer, true);
  assert.ok((model.steps[5]?.delaySeconds ?? 0) > 0);

  // Solenoid power rungs: 6 control + 4 power rungs (1Y2, 2Y1, 2Y2, 1Y1) = 10 rungs
  assert.equal(model.ladder.rungs.length, 10, 'Must have 10 rungs due to paralleled solenoids');
  const powerRungs = model.ladder.rungs.filter((r) => r.coil.kind === 'solenoid');
  assert.equal(powerRungs.length, 4, 'Must have exactly 4 unique power rungs');

  // Verify paralleling on 2Y1 (driven by K2 and K4 in parallel)
  const rung2Y1 = powerRungs.find((r) => r.coil.id === '2Y1');
  assert.ok(rung2Y1);
  assert.equal(rung2Y1.setBranches.length, 2);
  const drivers2Y1 = rung2Y1.setBranches.map((b) => b.contacts[0]?.driverId);
  assert.deepEqual(drivers2Y1, ['K2', 'K4']);

  // Verify paralleling on 2Y2 (driven by K3 and K5 in parallel)
  const rung2Y2 = powerRungs.find((r) => r.coil.id === '2Y2');
  assert.ok(rung2Y2);
  assert.equal(rung2Y2.setBranches.length, 2);
  const drivers2Y2 = rung2Y2.setBranches.map((b) => b.contacts[0]?.driverId);
  assert.deepEqual(drivers2Y2, ['K3', 'K5']);

  // Validation
  const circuit = toCircuit(model);
  const report = validateCircuit(circuit, model);
  assert.ok(report.ok);

  // Simulation: full completion, A returns to extended, B returns to retracted
  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true);
  assert.equal(sim.state.cylinders.get('A'), 'EXTENDED');
  assert.equal(sim.state.cylinders.get('B'), 'RETRACTED');

  // Explanation
  const lines = explain(model);
  assert.ok(lines.length >= 12);
  assert.ok(lines.some((l) => l.includes('cycle for A-B+B-B+B-TA+ is complete')));

  // SVG rendering
  const pSvg = renderPneumatic(circuit, { model });
  const lSvg = renderLadder(circuit, model);
  verifySvgIntegrity(pSvg, 'A-B+B-B+B-TA+ pneumatic');
  verifySvgIntegrity(lSvg, 'A-B+B-B+B-TA+ ladder');
  assert.ok(pSvg.includes(cylinderId('A')) && pSvg.includes(cylinderId('B')));
});

// ---------------------------------------------------------------------------
// ADVERSARIAL CHALLENGES & STRESS TESTS
// ---------------------------------------------------------------------------
test('Adversarial Stress Test: Multiple initially extended cylinders A-B-C-A+B+C+', () => {
  const model = solve('A-B-C-A+B+C+');
  assert.equal(model.initialState?.positions['A'], 'extended');
  assert.equal(model.initialState?.positions['B'], 'extended');
  assert.equal(model.initialState?.positions['C'], 'extended');

  const simInit = initialSimState(model);
  assert.equal(simInit.cylinders.get('A'), 'EXTENDED');
  assert.equal(simInit.cylinders.get('B'), 'EXTENDED');
  assert.equal(simInit.cylinders.get('C'), 'EXTENDED');
  assert.equal(simInit.valves.get(mainValveId('A')), 'STATE_2');
  assert.equal(simInit.valves.get(mainValveId('B')), 'STATE_2');
  assert.equal(simInit.valves.get(mainValveId('C')), 'STATE_2');

  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true);
  assert.equal(sim.state.cylinders.get('A'), 'EXTENDED');
  assert.equal(sim.state.cylinders.get('B'), 'EXTENDED');
  assert.equal(sim.state.cylinders.get('C'), 'EXTENDED');
});

test('Adversarial Stress Test: Triple repeated solenoid paralleling A+B+B-B+B-B+B-A-', () => {
  // B+ occurs 3 times (steps 1, 3, 5), B- occurs 3 times (steps 2, 4, 6)
  const model = solve('A+B+B-B+B-B+B-A-');
  const power2Y1 = model.ladder.rungs.find((r) => r.coil.id === '2Y1');
  assert.ok(power2Y1);
  assert.equal(power2Y1.setBranches.length, 3, '3 parallel branches for 2Y1');
  assert.deepEqual(power2Y1.setBranches.map((b) => b.contacts[0]?.driverId), ['K2', 'K4', 'K6']);

  const power2Y2 = model.ladder.rungs.find((r) => r.coil.id === '2Y2');
  assert.ok(power2Y2);
  assert.equal(power2Y2.setBranches.length, 3, '3 parallel branches for 2Y2');
  assert.deepEqual(power2Y2.setBranches.map((b) => b.contacts[0]?.driverId), ['K3', 'K5', 'K7']);

  const circuit = toCircuit(model);
  const report = validateCircuit(circuit, model);
  assert.ok(report.ok);

  const sim = runCycle(model, { pulseStart: true });
  assert.equal(sim.completed, true);

  const lSvg = renderLadder(circuit, model);
  verifySvgIntegrity(lSvg, 'Triple repeat ladder');
});

test('Adversarial Stress Test: Continuous cycle wrap logic across all 5 sequences', () => {
  const sequences = [
    'A+B+A-B-',
    'A+B+B-A-',
    'A+B+C+A-B-C-',
    'B-C+A+B+C-A-',
    'A-B+B-B+B-TA+',
  ];

  for (const seq of sequences) {
    const contModel = solve(seq, 'continuous');
    const lastRelay = contModel.relayIds[contModel.relayIds.length - 1];

    // Rung 1 must have an arming contact driven by lastRelay of type NO
    const rung1 = contModel.ladder.rungs.find((r) => r.number === 1);
    const arming = rung1?.setBranches.flatMap((b) => b.contacts).find((c) => c.role === 'arming');
    assert.equal(arming?.type, 'NO', `${seq} continuous rung 1 arming must be NO`);
    assert.equal(arming?.driverId, lastRelay, `${seq} continuous rung 1 arming must be ${lastRelay}`);

    // Last relay rung must have reset contact driven by K1
    const lastRung = contModel.ladder.rungs.find((r) => r.coil.id === lastRelay);
    assert.equal(lastRung?.resetContacts.length, 1, `${seq} last rung must have reset contact in continuous mode`);
    assert.equal(lastRung?.resetContacts[0]?.driverId, 'K1', `${seq} last rung reset driven by K1`);

    const circuit = toCircuit(contModel);
    const report = validateCircuit(circuit, contModel);
    assert.ok(report.ok, `${seq} continuous circuit must validate cleanly`);
  }
});
