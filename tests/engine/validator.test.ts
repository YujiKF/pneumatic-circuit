/**
 * CircuitValidator unit tests: one bad circuit per error class, asserting the
 * corresponding issue code is reported. The pipeline must REFUSE invalid
 * circuits (ok === false).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Circuit,
  CircuitComponent,
  Connection,
} from '../../src/domain/index.ts';
import { validateCircuit, ValidationCode } from '../../src/validator/index.ts';
import { parseSequence } from '../../src/parser/index.ts';
import { solveStepByStep, toCircuit as toCircuitProjection } from '../../src/engine/index.ts';
import type { CircuitLogicalModel } from '../../src/engine/index.ts';

function circuit(
  components: CircuitComponent[],
  connections: Connection[] = [],
): Circuit {
  return {
    domain: 'electropneumatic',
    method: 'step-by-step',
    components,
    connections,
    groups: [],
    explanation: [],
  };
}

function hasCode(
  report: { issues: readonly { code: string }[] },
  code: string,
): boolean {
  return report.issues.some((i) => i.code === code);
}

test('detects NONEXISTENT_COMPONENT (connection to a missing component)', () => {
  const c = circuit(
    [{ kind: 'cylinder', id: '1.0', actuator: 'A' }],
    [
      {
        sourceComponent: '1.0',
        sourcePort: '+',
        targetComponent: 'GHOST',
        targetPort: '2',
        signalType: 'pneumatic',
      },
    ],
  );
  const report = validateCircuit(c);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.NONEXISTENT_COMPONENT));
});

test('detects NONEXISTENT_PORT (connection to a port the component lacks)', () => {
  const c = circuit(
    [
      { kind: 'directional-valve', id: '1.1', valveType: '5/2', actuation: 'double-pilot', actuator: 'A' },
      { kind: 'cylinder', id: '1.0', actuator: 'A' },
    ],
    [
      {
        sourceComponent: '1.1',
        sourcePort: '99', // not a valid valve port
        targetComponent: '1.0',
        targetPort: '+',
        signalType: 'pneumatic',
      },
    ],
  );
  const report = validateCircuit(c);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.NONEXISTENT_PORT));
});

test('detects REQUIRED_PORT_UNCONNECTED (double-pilot valve pilot not wired)', () => {
  // A double-pilot valve with only port 14 connected (12 missing).
  const c = circuit(
    [
      { kind: 'directional-valve', id: '1.1', valveType: '5/2', actuation: 'double-pilot', actuator: 'A' },
      { kind: 'coil', id: '1Y1', relayId: '1Y1' },
    ],
    [
      {
        sourceComponent: '1Y1',
        sourcePort: 'out',
        targetComponent: '1.1',
        targetPort: '14',
        signalType: 'pneumatic',
      },
    ],
  );
  const report = validateCircuit(c);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.REQUIRED_PORT_UNCONNECTED));
});

test('detects DUPLICATE_COMPONENT (two components share an id)', () => {
  const c = circuit([
    { kind: 'relay', id: 'K1', relayKind: 'control' },
    { kind: 'relay', id: 'K1', relayKind: 'control' },
  ]);
  const report = validateCircuit(c);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.DUPLICATE_COMPONENT));
});

test('detects NONEXISTENT_SENSOR (contact driven by a missing sensor)', () => {
  const c = circuit([
    { kind: 'contact', id: 'C1', contactType: 'NO', ownerId: '1S2' },
    // no sensor 1S2 declared
  ]);
  const report = validateCircuit(c);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.NONEXISTENT_SENSOR));
});

test('detects NONEXISTENT_RELAY (contact driven by a missing relay)', () => {
  const c = circuit([
    { kind: 'contact', id: 'C1', contactType: 'NO', ownerId: 'K9' },
    // no relay K9 declared
  ]);
  const report = validateCircuit(c);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.NONEXISTENT_RELAY));
});

test('detects COIL_WITHOUT_COMPONENT (relay coil with no backing relay)', () => {
  const c = circuit([
    { kind: 'coil', id: 'coil-K1', relayId: 'K1' },
    // no relay K1 declared
  ]);
  const report = validateCircuit(c);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.COIL_WITHOUT_COMPONENT));
});

test('detects NONEXISTENT_SOLENOID (solenoid coil does not match declared actuators)', () => {
  const c = circuit([
    { kind: 'cylinder', id: '1.0', actuator: 'A' },
    { kind: 'directional-valve', id: '1.1', valveType: '5/2', actuation: 'double-pilot', actuator: 'A' },
    { kind: 'coil', id: '9Y9', relayId: '9Y9' },
  ]);
  const report = validateCircuit(c);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.NONEXISTENT_SOLENOID));
});

test('detects NONEXISTENT_SOLENOID at model level (movement commands undeclared solenoid)', () => {
  const model = baseModel();
  const steps = model.steps.map((s) =>
    s.index === 0
      ? {
          ...s,
          movements: [
            { actuator: 'A', direction: '+' as const, solenoidId: '9Y9', arrivalSensorId: '1S2' },
          ],
        }
      : s,
  );
  const broken: CircuitLogicalModel = { ...model, steps };
  const report = validateCircuit(toEmpty(), broken);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.NONEXISTENT_SOLENOID));
});

test('detects UNREACHABLE_STEP (step 0 not enabled by start or step disconnected)', () => {
  const model = baseModel();
  const steps = model.steps.map((s) =>
    s.index === 0 ? { ...s, enabledByStart: false } : s,
  );
  const broken: CircuitLogicalModel = { ...model, steps };
  const report = validateCircuit(toEmpty(), broken);
  assert.equal(report.ok, false);
  assert.ok(hasCode(report, ValidationCode.UNREACHABLE_STEP));
});

// --- model-level logical checks ---

function baseModel(): CircuitLogicalModel {
  const parsed = parseSequence('A+B+A-B-');
  assert.ok(parsed.ok);
  return solveStepByStep(parsed.value);
}

test('detects IMPOSSIBLE_TRANSITION (step waits on a sensor never produced)', () => {
  const model = baseModel();
  // Corrupt K3 so it waits on a sensor that no earlier movement trips. The
  // validator gates on the full `enableSensorIds` set (issue 5), so corrupt
  // both the display id and the gating list.
  const steps = model.steps.map((s) =>
    s.index === 2
      ? { ...s, enableSensorId: '9S9', enableSensorIds: ['9S9'], enabledByStart: false }
      : s,
  );
  const broken: CircuitLogicalModel = { ...model, steps };
  const report = validateCircuit(toEmpty(), broken);
  assert.ok(hasCode(report, ValidationCode.IMPOSSIBLE_TRANSITION));
});

test('detects STEP_WITHOUT_EXIT (a non-final step has no exit condition)', () => {
  const model = baseModel();
  // Remove K2's enabling condition entirely (both the display id and the gating
  // list): K1 (step 0) then has no exit.
  const steps = model.steps.map((s) => {
    if (s.index === 1) {
      const { enableSensorId, enableSensorIds, ...rest } = s;
      void enableSensorId;
      void enableSensorIds;
      return { ...rest, enabledByStart: false } as typeof s;
    }
    return s;
  });
  const broken: CircuitLogicalModel = { ...model, steps };
  const report = validateCircuit(toEmpty(), broken);
  assert.ok(hasCode(report, ValidationCode.STEP_WITHOUT_EXIT));
});

test('detects LOGICAL_CONFLICT (a step commands advance and retract at once)', () => {
  const model = baseModel();
  const steps = model.steps.map((s) =>
    s.index === 0
      ? {
          ...s,
          movements: [
            ...s.movements,
            { actuator: 'A', direction: '-' as const, solenoidId: '1Y2', arrivalSensorId: '1S1' },
          ],
        }
      : s,
  );
  const broken: CircuitLogicalModel = { ...model, steps };
  const report = validateCircuit(toEmpty(), broken);
  assert.ok(hasCode(report, ValidationCode.LOGICAL_CONFLICT));
});

/** A trivially-valid empty circuit so model-level checks run in isolation. */
function toEmpty(): Circuit {
  return {
    domain: 'electropneumatic',
    method: 'step-by-step',
    components: [],
    connections: [],
    groups: [],
    explanation: [],
  };
}

test('a fully solved circuit validates cleanly (ok === true)', () => {
  const model = baseModel();
  const report = validateCircuit(toCircuitProjection(model), model);
  assert.ok(report.ok, report.issues.map((i) => i.code).join(','));
});
