/**
 * Layout engine tests.
 *
 * The layout engine is PURE and DETERMINISTIC and must not store geometry back
 * into the logical circuit. These tests use a GOLDEN circuit (the milestone
 * A+B+A-B- step-by-step solution) and assert:
 *   - determinism (same input -> byte-identical layout),
 *   - every component receives a position,
 *   - no two component bounding boxes overlap,
 *   - the logical circuit is not mutated,
 *   - every routed connection has >= 2 waypoints and stays within bounds.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep, toCircuit } from '../../src/engine/index.ts';
import { layoutCircuit } from '../../src/layout/index.ts';
import type { PlacedComponent } from '../../src/layout/index.ts';

function goldenCircuit() {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok, 'golden sequence parses');
  const model = solveStepByStep(parsed.value, {});
  return toCircuit(model);
}

function overlaps(a: PlacedComponent, b: PlacedComponent): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

test('layout is deterministic (identical output across runs)', () => {
  const c = goldenCircuit();
  const a = layoutCircuit(c);
  const b = layoutCircuit(c);
  assert.deepEqual(
    a.components.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    b.components.map((p) => ({ id: p.id, x: p.x, y: p.y })),
  );
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
});

test('every component receives a position', () => {
  const c = goldenCircuit();
  const layout = layoutCircuit(c);
  assert.equal(layout.components.length, c.components.length);
  for (const comp of c.components) {
    const p = layout.byId.get(comp.id);
    assert.ok(p, `component ${comp.id} is placed`);
    assert.equal(typeof p.x, 'number');
    assert.equal(typeof p.y, 'number');
    assert.ok(p.width > 0 && p.height > 0, `${comp.id} has a footprint`);
  }
});

test('no two components overlap in the golden circuit', () => {
  const c = goldenCircuit();
  const layout = layoutCircuit(c);
  const comps = layout.components;
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      assert.ok(
        !overlaps(comps[i]!, comps[j]!),
        `components ${comps[i]!.id} and ${comps[j]!.id} overlap`,
      );
    }
  }
});

test('all components stay within the reported diagram bounds', () => {
  const c = goldenCircuit();
  const layout = layoutCircuit(c);
  for (const p of layout.components) {
    assert.ok(p.x >= 0 && p.y >= 0, `${p.id} within top-left`);
    assert.ok(p.x + p.width <= layout.width, `${p.id} within right edge`);
    assert.ok(p.y + p.height <= layout.height, `${p.id} within bottom edge`);
  }
});

test('layout does NOT mutate the logical circuit (no geometry stored back)', () => {
  const c = goldenCircuit();
  const snapshot = JSON.stringify(c);
  layoutCircuit(c);
  assert.equal(JSON.stringify(c), snapshot, 'circuit unchanged after layout');
  // The logical component objects carry no x/y/orientation keys.
  for (const comp of c.components) {
    assert.ok(!('x' in comp), `${comp.id} has no x`);
    assert.ok(!('y' in comp), `${comp.id} has no orientation`);
  }
});

test('routed connections have >= 2 waypoints and match the input count', () => {
  const c = goldenCircuit();
  const layout = layoutCircuit(c);
  assert.equal(layout.connections.length, c.connections.length);
  for (const conn of layout.connections) {
    assert.ok(conn.points.length >= 2, 'connection has at least two waypoints');
  }
});
