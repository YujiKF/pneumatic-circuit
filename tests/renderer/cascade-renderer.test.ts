/**
 * Cascade Pneumatic SVG Renderer Tests.
 *
 * Asserts structural facts about the generated SVG for cascade circuits:
 *  - SVG root and viewBox;
 *  - group pressure line buses (L1..Ln) with group labels (Grupo I..);
 *  - cylinders, main valves, memory valves (5/2), supply valve (3/2 NC);
 *  - no NaN, undefined, or null in output;
 *  - refusal path: throws RenderRefusedError when circuit fails validation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveCascade, toCascadeCircuit } from '../../src/engine/index.ts';
import { renderPneumatic, RenderRefusedError } from '../../src/renderer/index.ts';
import type { Circuit } from '../../src/domain/index.ts';

test('cascade renderer: renders G1 (A+B+A-B-) with buses, cylinders, and memory valve', () => {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok);
  const model = solveCascade(parsed.value);
  const circuit = toCascadeCircuit(model);

  const svg = renderPneumatic(circuit, { model });
  assert.ok(svg.includes('<svg'), 'contains svg tag');
  assert.ok(svg.includes('class="pneumatic-diagram"'), 'has pneumatic-diagram class');

  // No NaN, undefined, or null
  assert.ok(!svg.includes('NaN'), 'no NaN in SVG');
  assert.ok(!svg.includes('undefined'), 'no undefined in SVG');
  assert.ok(!svg.includes('null'), 'no null in SVG');

  // Cylinders: 2
  const cylinders = svg.match(/class="CylinderSymbol/g) ?? [];
  assert.equal(cylinders.length, 2, '2 cylinders rendered');

  // 5/2 valves: 2 main valves (1.1, 2.1) + 1 memory valve (0.1) = 3
  const valves52 = svg.match(/class="Valve52Symbol/g) ?? [];
  assert.equal(valves52.length, 3, '3 5/2 valves rendered (2 main + 1 memory)');

  // 3/2 supply valve (E)
  const valves32 = svg.match(/class="Valve32NCSymbol/g) ?? [];
  assert.equal(valves32.length, 1, '1 3/2 supply valve rendered');

  // Pressure buses: L1 and L2
  const buses = svg.match(/class="pressure-bus"/g) ?? [];
  assert.equal(buses.length, 2, '2 pressure buses rendered');
  assert.ok(svg.includes('data-bus="L1"'), 'L1 bus element present');
  assert.ok(svg.includes('data-bus="L2"'), 'L2 bus element present');
  assert.ok(svg.includes('Grupo I'), 'Grupo I label rendered');
  assert.ok(svg.includes('Grupo II'), 'Grupo II label rendered');

  // Sensors: 4
  const sensors = svg.match(/class="MechanicalSensorSymbol/g) ?? [];
  assert.equal(sensors.length, 4, '4 sensors rendered');
});

test('cascade renderer: renders G4 (A+B-B+T(A-B-)B+) with 4 buses and 3 memory valves', () => {
  const parsed = parseSequence('A+B-B+T(A-B-)B+');
  assert.ok(parsed.ok);
  const model = solveCascade(parsed.value);
  const circuit = toCascadeCircuit(model);

  const svg = renderPneumatic(circuit, { model });
  assert.ok(svg.includes('<svg'));
  assert.ok(!svg.includes('NaN'));
  assert.ok(!svg.includes('undefined'));

  // Buses: 4
  const buses = svg.match(/class="pressure-bus"/g) ?? [];
  assert.equal(buses.length, 4, '4 pressure buses');
  assert.ok(svg.includes('data-bus="L1"'));
  assert.ok(svg.includes('data-bus="L2"'));
  assert.ok(svg.includes('data-bus="L3"'));
  assert.ok(svg.includes('data-bus="L4"'));

  // 5/2 valves: 2 main valves + 3 memory valves = 5
  const valves52 = svg.match(/class="Valve52Symbol/g) ?? [];
  assert.equal(valves52.length, 5, '2 main valves + 3 memory valves = 5');
});

test('cascade renderer: renders G5 (A+B+D-A-B-C+C-D+) with 3 buses and 2 memory valves', () => {
  const parsed = parseSequence('A+B+D-A-B-C+C-D+');
  assert.ok(parsed.ok);
  const model = solveCascade(parsed.value);
  const circuit = toCascadeCircuit(model);

  const svg = renderPneumatic(circuit, { model });
  assert.ok(svg.includes('<svg'));
  assert.ok(!svg.includes('NaN'));

  const cylinders = svg.match(/class="CylinderSymbol/g) ?? [];
  assert.equal(cylinders.length, 4, '4 cylinders');

  const buses = svg.match(/class="pressure-bus"/g) ?? [];
  assert.equal(buses.length, 3, '3 pressure buses');

  const valves52 = svg.match(/class="Valve52Symbol/g) ?? [];
  assert.equal(valves52.length, 6, '4 main + 2 memory = 6');
});

test('cascade renderer: refuses an invalid circuit (throws RenderRefusedError)', () => {
  const brokenCircuit: Circuit = {
    domain: 'pneumatic',
    method: 'cascade',
    components: [
      { kind: 'cylinder', id: '1.0', actuator: 'A' },
      // Valve with missing required port connections
      { kind: 'directional-valve', id: '1.1', valveType: '5/2', actuation: 'double-pilot', actuator: 'A' },
    ],
    connections: [],
    groups: [],
    explanation: [],
  };

  assert.throws(
    () => renderPneumatic(brokenCircuit),
    (err: unknown) => {
      assert.ok(err instanceof RenderRefusedError);
      assert.ok(err.issues.length > 0);
      return true;
    },
  );
});
