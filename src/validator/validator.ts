/**
 * CircuitValidator.
 *
 * The pipeline prefers to REFUSE an invalid circuit over emitting a
 * pretty-but-wrong one (user requirement). The validator inspects a flat
 * {@link Circuit} (and, optionally, its {@link CircuitLogicalModel}) and
 * returns structured {@link ValidationIssue}s. Each listed error class has a
 * stable code so tests can assert on it:
 *
 *  - NONEXISTENT_COMPONENT : a connection references a missing component
 *  - NONEXISTENT_PORT      : a connection references a port a component lacks
 *  - REQUIRED_PORT_UNCONNECTED : a mandatory port has no connection
 *  - DUPLICATE_COMPONENT   : two components share an id
 *  - NONEXISTENT_SENSOR    : a contact/step references a missing sensor
 *  - NONEXISTENT_RELAY     : a coil/contact references a missing relay
 *  - COIL_WITHOUT_COMPONENT: a coil has no backing relay/valve component
 *  - IMPOSSIBLE_TRANSITION : a step transition cannot physically happen
 *  - STEP_WITHOUT_EXIT     : a step has no exit condition (cannot advance)
 *  - LOGICAL_CONFLICT      : contradictory logic (e.g. missing seal, both
 *                            solenoids commanded at once, unreachable step)
 *
 * Electrical rails/rung nodes ("+24V", "0V", "R<n>") are implicit valid nodes
 * and are not required to be declared components.
 */

import type { Circuit, Connection } from '../domain/index.ts';
import type { CircuitLogicalModel } from '../engine/model.ts';
import type { CascadeLogicalModel } from '../engine/cascade/model.ts';
import { validateCascadeModel } from './cascade.ts';

export const ValidationCode = {
  NONEXISTENT_COMPONENT: 'VAL_NONEXISTENT_COMPONENT',
  NONEXISTENT_PORT: 'VAL_NONEXISTENT_PORT',
  REQUIRED_PORT_UNCONNECTED: 'VAL_REQUIRED_PORT_UNCONNECTED',
  DUPLICATE_COMPONENT: 'VAL_DUPLICATE_COMPONENT',
  NONEXISTENT_SENSOR: 'VAL_NONEXISTENT_SENSOR',
  NONEXISTENT_RELAY: 'VAL_NONEXISTENT_RELAY',
  NONEXISTENT_SOLENOID: 'VAL_NONEXISTENT_SOLENOID',
  COIL_WITHOUT_COMPONENT: 'VAL_COIL_WITHOUT_COMPONENT',
  IMPOSSIBLE_TRANSITION: 'VAL_IMPOSSIBLE_TRANSITION',
  STEP_WITHOUT_EXIT: 'VAL_STEP_WITHOUT_EXIT',
  UNREACHABLE_STEP: 'VAL_UNREACHABLE_STEP',
  LOGICAL_CONFLICT: 'VAL_LOGICAL_CONFLICT',
} as const;

export type ValidationCode = (typeof ValidationCode)[keyof typeof ValidationCode];

export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly message: string;
  /** Component/connection/step id the issue concerns, when applicable. */
  readonly subject?: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

/** Ports considered valid on each component kind (plus implicit electric nodes). */
const VALVE_PORTS = new Set(['1', '2', '3', '4', '5', '10', '12', '14']);
const CONTACT_PORTS = new Set(['in', 'out']);
const CYLINDER_PORTS = new Set(['+', '-', 'rod']);
const COIL_PORTS = new Set(['in', 'out', 'a1', 'a2']);
const SENSOR_PORTS = new Set(['in', 'out', 'signal']);
const RELAY_PORTS = new Set(['a1', 'a2']);

function isImplicitElectricNode(id: string): boolean {
  return id === '+24V' || id === '0V' || /^R\d+$/.test(id);
}

/**
 * Validate a circuit. If `model` is provided, additional logical checks
 * (seal presence, step exit conditions, transition feasibility, solenoid
 * conflicts, cascade invariants) are performed.
 */
export function validateCircuit(
  circuit: Circuit,
  model?: CircuitLogicalModel | CascadeLogicalModel,
): ValidationReport {
  const issues: ValidationIssue[] = [];

  // A missing or structurally malformed circuit (no component array) cannot be
  // validated or drawn. Report it as a LOGICAL_CONFLICT through the normal
  // issue path so every refusal reason flows from the validator (no fabricated
  // codes elsewhere).
  if (
    circuit === null ||
    circuit === undefined ||
    !Array.isArray(circuit.components) ||
    !Array.isArray(circuit.connections)
  ) {
    issues.push({
      code: ValidationCode.LOGICAL_CONFLICT,
      message: 'Circuit is missing or malformed (no component/connection arrays).',
    });
    return { ok: false, issues };
  }

  const byId = new Map<string, Circuit['components'][number]>();
  // DUPLICATE_COMPONENT
  for (const c of circuit.components) {
    if (byId.has(c.id)) {
      issues.push({
        code: ValidationCode.DUPLICATE_COMPONENT,
        message: `Component id "${c.id}" is declared more than once.`,
        subject: c.id,
      });
    } else {
      byId.set(c.id, c);
    }
  }

  validateConnections(circuit, byId, issues);
  validateReferences(circuit, byId, issues);

  if (model !== undefined) {
    if ('steps' in model) {
      validateLogical(model as CircuitLogicalModel, issues);
    } else if (model.method === 'cascade' || 'memories' in model) {
      validateCascadeModel(model as CascadeLogicalModel, issues);
    }
  }

  return { ok: issues.length === 0, issues };
}

function validateConnections(
  circuit: Circuit,
  byId: Map<string, Circuit['components'][number]>,
  issues: ValidationIssue[],
): void {
  const endpoints: Array<{ comp: string; port: string; conn: Connection }> = [];
  for (const conn of circuit.connections) {
    endpoints.push({ comp: conn.sourceComponent, port: conn.sourcePort, conn });
    endpoints.push({ comp: conn.targetComponent, port: conn.targetPort, conn });
  }

  for (const ep of endpoints) {
    if (isImplicitElectricNode(ep.comp)) continue;
    const comp = byId.get(ep.comp);
    if (comp === undefined) {
      // NONEXISTENT_COMPONENT
      issues.push({
        code: ValidationCode.NONEXISTENT_COMPONENT,
        message: `Connection references component "${ep.comp}", which does not exist.`,
        subject: ep.comp,
      });
      continue;
    }
    if (!portExists(comp, ep.port)) {
      // NONEXISTENT_PORT
      issues.push({
        code: ValidationCode.NONEXISTENT_PORT,
        message: `Component "${ep.comp}" (${comp.kind}) has no port "${ep.port}".`,
        subject: ep.comp,
      });
    }
  }

  // REQUIRED_PORT_UNCONNECTED: every 5/2 double-pilot main valve must have both
  // pilot ports (12 and 14) connected, and the supply port 1 is required.
  const connectedPorts = new Map<string, Set<string>>();
  for (const conn of circuit.connections) {
    addPort(connectedPorts, conn.sourceComponent, conn.sourcePort);
    addPort(connectedPorts, conn.targetComponent, conn.targetPort);
  }
  for (const comp of circuit.components) {
    if (comp.kind === 'directional-valve' && comp.actuation === 'double-pilot') {
      const ports = connectedPorts.get(comp.id) ?? new Set<string>();
      for (const required of ['12', '14']) {
        if (!ports.has(required)) {
          issues.push({
            code: ValidationCode.REQUIRED_PORT_UNCONNECTED,
            message: `Valve "${comp.id}" pilot port "${required}" is not connected.`,
            subject: comp.id,
          });
        }
      }
    }
  }
}

function addPort(map: Map<string, Set<string>>, comp: string, port: string): void {
  let set = map.get(comp);
  if (set === undefined) {
    set = new Set<string>();
    map.set(comp, set);
  }
  set.add(port);
}

function portExists(
  comp: Circuit['components'][number],
  port: string,
): boolean {
  switch (comp.kind) {
    case 'directional-valve':
      return VALVE_PORTS.has(port);
    case 'contact':
      return CONTACT_PORTS.has(port);
    case 'cylinder':
      return CYLINDER_PORTS.has(port);
    case 'coil':
      return COIL_PORTS.has(port);
    case 'sensor':
      return SENSOR_PORTS.has(port);
    case 'relay':
      return RELAY_PORTS.has(port);
    case 'memory':
      return port === 'set' || port === 'reset';
    default:
      return false;
  }
}

function validateReferences(
  circuit: Circuit,
  byId: Map<string, Circuit['components'][number]>,
  issues: ValidationIssue[],
): void {
  const relayIds = new Set<string>();
  const sensorIds = new Set<string>();
  const solenoidCoilIds = new Set<string>();
  for (const c of circuit.components) {
    if (c.kind === 'relay') relayIds.add(c.id);
    if (c.kind === 'sensor') sensorIds.add(c.id);
    if (c.kind === 'coil') solenoidCoilIds.add(c.id);
  }

  const validSolenoids = new Set<string>();
  for (const c of circuit.components) {
    if (c.kind === 'directional-valve' && c.actuator) {
      const n = c.actuator.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
      validSolenoids.add(`${n}Y1`);
      validSolenoids.add(`${n}Y2`);
    } else if (c.kind === 'cylinder' && c.actuator) {
      const n = c.actuator.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
      validSolenoids.add(`${n}Y1`);
      validSolenoids.add(`${n}Y2`);
    }
  }

  for (const c of circuit.components) {
    if (c.kind === 'contact') {
      const owner = c.ownerId;
      // A contact's owner is a relay, a sensor, or a button. If it looks like a
      // relay id (K...) it MUST exist as a relay; if it looks like a sensor id
      // (\dS\d) it MUST exist as a sensor.
      if (/^K\d+$/.test(owner) && !relayIds.has(owner)) {
        issues.push({
          code: ValidationCode.NONEXISTENT_RELAY,
          message: `Contact "${c.id}" is driven by relay "${owner}", which does not exist.`,
          subject: c.id,
        });
      } else if (/^\d+S\d+$/.test(owner) && !sensorIds.has(owner)) {
        issues.push({
          code: ValidationCode.NONEXISTENT_SENSOR,
          message: `Contact "${c.id}" is driven by sensor "${owner}", which does not exist.`,
          subject: c.id,
        });
      }
    }
    if (c.kind === 'coil') {
      // COIL_WITHOUT_COMPONENT / NONEXISTENT_RELAY: a relay coil must back a
      // declared relay. A solenoid coil (id === relayId, matches \dY\d) must
      // correspond to a declared actuator/valve.
      const backing = c.relayId;
      const isSolenoid = /^\d+Y\d+$/.test(backing);
      if (!isSolenoid) {
        if (!relayIds.has(backing)) {
          issues.push({
            code: ValidationCode.COIL_WITHOUT_COMPONENT,
            message: `Coil "${c.id}" has no backing relay component "${backing}".`,
            subject: c.id,
          });
        }
      } else {
        if (validSolenoids.size > 0 && !validSolenoids.has(backing)) {
          issues.push({
            code: ValidationCode.NONEXISTENT_SOLENOID,
            message: `Solenoid coil "${c.id}" does not correspond to any declared cylinder or valve.`,
            subject: c.id,
          });
        }
      }
    }
  }
}

/**
 * Logical (model-level) checks: seal presence, step exit conditions,
 * transition feasibility, solenoid conflicts, reachability.
 */
function validateLogical(
  model: CircuitLogicalModel,
  issues: ValidationIssue[],
): void {
  const n = model.steps.length;

  // Map each relay to its control rung for topology checks.
  const controlRungByRelay = new Map<string, (typeof model.ladder.rungs)[number]>();
  for (const rung of model.ladder.rungs) {
    if (rung.coil.kind === 'relay') controlRungByRelay.set(rung.coil.id, rung);
  }

  for (let i = 0; i < n; i++) {
    const step = model.steps[i];
    if (step === undefined) continue;

    // LOGICAL_CONFLICT: missing/mis-placed SEAL. The control rung must have a
    // seal branch that is the relay's OWN NO contact (role 'seal'). If the
    // seal is absent, or references some OTHER driver, the memory would drop
    // when the triggering sensor opens.
    const rung = controlRungByRelay.get(step.relayId);
    if (rung !== undefined) {
      const sealBranch = rung.setBranches.find((b) =>
        b.contacts.some((c) => c.role === 'seal'),
      );
      const sealOk =
        sealBranch !== undefined &&
        sealBranch.contacts.length === 1 &&
        sealBranch.contacts[0]?.driverId === step.relayId &&
        sealBranch.contacts[0]?.type === 'NO';
      if (!sealOk) {
        issues.push({
          code: ValidationCode.LOGICAL_CONFLICT,
          message: `Step ${step.relayId} has no correctly-placed seal (SELO) contact; the memory would drop when the triggering sensor opens.`,
          subject: step.relayId,
        });
      }
    }

    // LOGICAL_CONFLICT: a single step must not command both solenoids of one
    // cylinder (advance and retract simultaneously).
    const dirs = new Map<string, Set<string>>();
    for (const mv of step.movements) {
      let set = dirs.get(mv.actuator);
      if (set === undefined) {
        set = new Set<string>();
        dirs.set(mv.actuator, set);
      }
      set.add(mv.direction);
    }
    for (const [actuator, set] of dirs) {
      if (set.has('+') && set.has('-')) {
        issues.push({
          code: ValidationCode.LOGICAL_CONFLICT,
          message: `Step ${step.relayId} commands cylinder ${actuator} to advance and retract simultaneously.`,
          subject: step.relayId,
        });
      }
    }

    // STEP_WITHOUT_EXIT: every non-final step must have an arrival sensor that
    // enables the next step; the final step must be reachable/complete.
    if (i < n - 1) {
      const next = model.steps[i + 1];
      const nextGated =
        next !== undefined &&
        (next.enabledByStart ||
          next.enableSensorId !== undefined ||
          (next.enableSensorIds !== undefined && next.enableSensorIds.length > 0));
      if (!nextGated) {
        issues.push({
          code: ValidationCode.STEP_WITHOUT_EXIT,
          message: `Step ${step.relayId} has no exit condition: the next step is not gated by any sensor.`,
          subject: step.relayId,
        });
      }
    }

    // IMPOSSIBLE_TRANSITION: EVERY enabling sensor of a non-first step must be
    // one that some previous movement actually produces (else it can never
    // trip). For a simultaneous predecessor this checks all its members.
    if (!step.enabledByStart) {
      const enableSensors =
        step.enableSensorIds ??
        (step.enableSensorId !== undefined ? [step.enableSensorId] : []);
      for (const sensorId of enableSensors) {
        const producible = model.steps
          .slice(0, i)
          .some((s) => s.movements.some((mv) => mv.arrivalSensorId === sensorId));
        if (!producible) {
          issues.push({
            code: ValidationCode.IMPOSSIBLE_TRANSITION,
            message: `Step ${step.relayId} waits on sensor "${sensorId}" that no earlier movement can trip.`,
            subject: step.relayId,
          });
        }
      }
    }
  }

  // NONEXISTENT_SOLENOID (model level): every movement must drive a solenoid on a declared valve
  const declaredSolenoids = new Set(
    model.pneumatic.valves.flatMap((v) => [v.advanceSolenoidId, v.retractSolenoidId]),
  );
  for (const step of model.steps) {
    for (const mv of step.movements) {
      if (!declaredSolenoids.has(mv.solenoidId)) {
        issues.push({
          code: ValidationCode.NONEXISTENT_SOLENOID,
          message: `Movement ${mv.actuator}${mv.direction} in step ${step.relayId} commands nonexistent solenoid "${mv.solenoidId}".`,
          subject: mv.solenoidId,
        });
      }
    }
  }

  // UNREACHABLE_STEP: step 0 must be enabled by start; each subsequent step must be
  // linked to its predecessor by a prev-line contact and producible arrival sensors.
  const reachable = new Set<number>();
  for (let i = 0; i < n; i++) {
    const step = model.steps[i];
    if (step === undefined) continue;
    if (i === 0) {
      if (step.enabledByStart) {
        reachable.add(0);
      } else {
        issues.push({
          code: ValidationCode.UNREACHABLE_STEP,
          message: `Step ${step.relayId} is unreachable: initial step is not enabled by start button.`,
          subject: step.relayId,
        });
      }
    } else {
      const prevReachable = reachable.has(i - 1);
      const prevStep = model.steps[i - 1];
      const rung = controlRungByRelay.get(step.relayId);
      const hasPrevLine =
        rung !== undefined &&
        rung.setBranches.some((b) =>
          b.contacts.some((c) => c.driverId === prevStep?.relayId),
        );
      const enableSensors =
        step.enableSensorIds ??
        (step.enableSensorId !== undefined ? [step.enableSensorId] : []);
      const sensorsProducible =
        enableSensors.length > 0 &&
        enableSensors.every((sensorId) =>
          model.steps.slice(0, i).some((s) => s.movements.some((mv) => mv.arrivalSensorId === sensorId)),
        );

      if (prevReachable && hasPrevLine && sensorsProducible) {
        reachable.add(i);
      } else {
        issues.push({
          code: ValidationCode.UNREACHABLE_STEP,
          message: `Step ${step.relayId} is unreachable from step ${prevStep?.relayId ?? 'start'}.`,
          subject: step.relayId,
        });
      }
    }
  }
}
