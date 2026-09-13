/**
 * Renderer tests (pneumatic + electrical ladder) + the refusal path.
 *
 * Golden circuit: the milestone A+B+A-B- step-by-step electropneumatic
 * solution. Tests assert STRUCTURAL SVG facts (contains <svg>, expected symbol
 * groups, rung count, rails) - NOT pixel comparisons - and that the renderer
 * REFUSES an invalid/unvalidated circuit.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep, toCircuit } from '../../src/engine/index.ts';
import type { CircuitLogicalModel } from '../../src/engine/index.ts';
import type { Circuit } from '../../src/domain/index.ts';
import {
  renderPneumatic,
  renderLadder,
  RenderRefusedError,
  assertRenderable,
} from '../../src/renderer/index.ts';

function golden(): { model: CircuitLogicalModel; circuit: Circuit } {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok, 'golden sequence parses');
  const model = solveStepByStep(parsed.value, {});
  return { model, circuit: toCircuit(model) };
}

// ---------------------------------------------------------------------------
// Pneumatic
// ---------------------------------------------------------------------------

test('pneumatic renderer produces a valid <svg> with cylinder and valve symbols', () => {
  const { circuit, model } = golden();
  const svg = renderPneumatic(circuit, { model });
  assert.ok(svg.includes('<svg'), 'has an <svg> root');
  assert.ok(svg.includes('class="pneumatic-diagram"'), 'is the pneumatic diagram');
  // Two cylinders (A=1.0, B=2.0) and two 5/2 valves (1.1, 2.1).
  const cylinders = svg.match(/class="CylinderSymbol/g) ?? [];
  const valves = svg.match(/class="Valve52Symbol/g) ?? [];
  assert.equal(cylinders.length, 2, 'two cylinders drawn');
  assert.equal(valves.length, 2, 'two 5/2 valves drawn');
  // Solenoids (1Y1,1Y2,2Y1,2Y2) drawn as pilot symbols.
  const solenoids = svg.match(/class="SolenoidSymbol/g) ?? [];
  assert.equal(solenoids.length, 4, 'four solenoids drawn');
});

test('pneumatic renderer draws pneumatic pipes for pilot connections', () => {
  const { circuit, model } = golden();
  const svg = renderPneumatic(circuit, { model });
  assert.ok(svg.includes('class="pipe'), 'draws pipe polylines');
});

// ---------------------------------------------------------------------------
// Ladder (electrical)
// ---------------------------------------------------------------------------

test('ladder renderer draws +24V/0V rails and one rung per ladder rung', () => {
  const { circuit, model } = golden();
  const svg = renderLadder(circuit, model);
  assert.ok(svg.includes('<svg'), 'has an <svg> root');
  assert.ok(svg.includes('class="ladder-diagram"'), 'is the ladder diagram');
  assert.ok(svg.includes('rail-plus24'), 'has the +24V rail label');
  assert.ok(svg.includes('rail-0v'), 'has the 0V rail label');

  const rungGroups = svg.match(/class="ladder-rung"/g) ?? [];
  assert.equal(rungGroups.length, model.ladder.rungs.length, 'one group per rung');
  // The A+B+A-B- ladder has at least the 4 control rungs.
  assert.ok(model.ladder.rungs.length >= 4, 'at least 4 rungs');
});

test('ladder renderer numbers the rungs 1..N', () => {
  const { circuit, model } = golden();
  const svg = renderLadder(circuit, model);
  for (const rung of model.ladder.rungs) {
    assert.ok(svg.includes(`rung-number rung-${rung.number}`), `rung ${rung.number} numbered`);
  }
});

test('ladder renderer draws coils and contacts', () => {
  const { circuit, model } = golden();
  const svg = renderLadder(circuit, model);
  assert.ok(/class="(RelayCoilSymbol|SolenoidSymbol)/.test(svg), 'draws coils');
  assert.ok(/class="(NOContactSymbol|NCContactSymbol)/.test(svg), 'draws contacts');
});

test('ladder renderer has clean wire geometry with zero duplicate overlapping lines', () => {
  const { circuit, model } = golden();
  const svg = renderLadder(circuit, model);

  // Extract all <line> coordinates
  const lineRegex = /<line\s+[^>]*x1="([^"]+)"\s+y1="([^"]+)"\s+x2="([^"]+)"\s+y2="([^"]+)"/g;
  const lineSet = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(svg)) !== null) {
    const p1 = `${match[1]},${match[2]}`;
    const p2 = `${match[3]},${match[4]}`;
    const key = p1 < p2 ? `${p1}->${p2}` : `${p2}->${p1}`;
    assert.ok(!lineSet.has(key), `Duplicate line detected at ${key}`);
    lineSet.add(key);
  }
});

test('ladder renderer maintains clean clearance between contact labels and horizontal wires', () => {
  const { circuit, model } = golden();
  const svg = renderLadder(circuit, model);

  // Extract contact symbol labels and verify no horizontal wire runs through them
  // Label text is at (cx, y - 6) with font-size 12 (extending roughly from y-16 to y-4)
  const labelRegex = /<text[^>]*y="([^"]+)"[^>]*class="symbol-label">([^<]+)<\/text>/g;
  const labelYs: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = labelRegex.exec(svg)) !== null) {
    labelYs.push(Number(match[1]));
  }

  // Extract horizontal wires
  const wireRegex = /<line[^>]*y1="([^"]+)"[^>]*y2="([^"]+)"[^>]*stroke-width="1.5"/g;
  const wireYs: number[] = [];
  while ((match = wireRegex.exec(svg)) !== null) {
    if (match[1] === match[2]) {
      wireYs.push(Number(match[1]));
    }
  }

  // Ensure no horizontal wire falls within [labelY - 12, labelY + 2]
  for (const ly of labelYs) {
    for (const wy of wireYs) {
      assert.ok(
        wy < ly - 12 || wy > ly + 2,
        `Wire at y=${wy} intersects contact label at y=${ly}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Refusal path
// ---------------------------------------------------------------------------

test('renderer REFUSES an invalid circuit (throws RenderRefusedError)', () => {
  // Break the golden circuit: reference a non-existent component in a wire.
  const { circuit, model } = golden();
  const broken: Circuit = {
    ...circuit,
    connections: [
      ...circuit.connections,
      {
        sourceComponent: 'GHOST',
        sourcePort: 'out',
        targetComponent: '1.1',
        targetPort: '14',
        signalType: 'pneumatic',
      },
    ],
  };
  assert.throws(() => renderPneumatic(broken, { model }), RenderRefusedError);
  assert.throws(() => renderLadder(broken, model), RenderRefusedError);
});

test('a MALFORMED circuit is refused via the validator (no fabricated code) - issue 6', () => {
  // A structurally malformed circuit (no component array) must be refused, and
  // the refusal reason must come from validateCircuit itself (a real
  // LOGICAL_CONFLICT issue), NOT a code hand-built by the guard.
  const malformed = { domain: 'pneumatic', method: 'intuitive' } as unknown as Circuit;
  try {
    assertRenderable(malformed);
    assert.fail('should have refused a malformed circuit');
  } catch (e) {
    assert.ok(e instanceof RenderRefusedError);
    assert.ok(e.issues.length > 0, 'issues attached');
    assert.ok(
      e.issues.some((i) => i.code === 'VAL_LOGICAL_CONFLICT'),
      'malformed circuit reported as LOGICAL_CONFLICT by the validator',
    );
  }
});

test('RenderRefusedError carries the validation issue codes', () => {
  const broken: Circuit = {
    domain: 'pneumatic',
    method: 'intuitive',
    components: [{ kind: 'cylinder', id: '1.0', actuator: 'A' }],
    connections: [
      {
        sourceComponent: 'MISSING',
        sourcePort: 'out',
        targetComponent: '1.0',
        targetPort: '+',
        signalType: 'pneumatic',
      },
    ],
    groups: [],
    explanation: [],
  };
  try {
    renderPneumatic(broken);
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof RenderRefusedError);
    assert.ok(e.issues.length > 0, 'issues are attached');
    assert.ok(
      e.issues.some((i) => i.code === 'VAL_NONEXISTENT_COMPONENT'),
      'reports the missing component',
    );
  }
});
