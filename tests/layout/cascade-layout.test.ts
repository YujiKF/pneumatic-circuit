import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveCascade, toCascadeCircuit } from '../../src/engine/index.ts';
import { layoutCircuit } from '../../src/layout/index.ts';
import type { PlacedComponent } from '../../src/layout/index.ts';

function overlaps(a: PlacedComponent, b: PlacedComponent): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

test('cascade layout: is deterministic across runs', () => {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok);
  const circuit = toCascadeCircuit(solveCascade(parsed.value));
  const l1 = layoutCircuit(circuit);
  const l2 = layoutCircuit(circuit);

  assert.equal(l1.width, l2.width);
  assert.equal(l1.height, l2.height);
  assert.deepEqual(
    l1.components.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    l2.components.map((p) => ({ id: p.id, x: p.x, y: p.y })),
  );
});

test('cascade layout: every component is placed and no two overlap', () => {
  for (const seq of ['A+B+A-B-', 'A+B+B-A-', 'B-C+A+B+C-A-', 'A+B-B+T(A-B-)B+', 'A+B+D-A-B-C+C-D+']) {
    const parsed = parseSequence(seq);
    assert.ok(parsed.ok);
    const circuit = toCascadeCircuit(solveCascade(parsed.value));
    const layout = layoutCircuit(circuit);

    assert.equal(layout.components.length, circuit.components.length);

    for (let i = 0; i < layout.components.length; i++) {
      const a = layout.components[i]!;
      assert.ok(a.x >= 0 && a.y >= 0);
      assert.ok(a.x + a.width <= layout.width, `${a.id} exceeds width`);
      assert.ok(a.y + a.height <= layout.height, `${a.id} exceeds height`);

      for (let j = i + 1; j < layout.components.length; j++) {
        const b = layout.components[j]!;
        assert.ok(!overlaps(a, b), `Components ${a.id} and ${b.id} overlap in sequence ${seq}`);
      }
    }
  }
});

test('cascade layout: group pressure lines (buses) are generated with correct bounds', () => {
  const parsed = parseSequence('A+B-B+T(A-B-)B+');
  assert.ok(parsed.ok);
  const circuit = toCascadeCircuit(solveCascade(parsed.value));
  const layout = layoutCircuit(circuit);

  assert.ok(layout.buses);
  assert.equal(layout.buses.length, 4); // 4 groups -> L1, L2, L3, L4

  layout.buses.forEach((bus, i) => {
    assert.equal(bus.id, `L${i + 1}`);
    assert.ok(bus.x2 > bus.x1);
    assert.ok(bus.y > 0 && bus.y < layout.height);
  });
});
