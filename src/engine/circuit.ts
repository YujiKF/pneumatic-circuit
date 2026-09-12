/**
 * Projection of a {@link CircuitLogicalModel} to the flat domain
 * {@link Circuit} (components + connections) consumed by the CircuitValidator
 * and, later, the layout engine and SVG renderer.
 *
 * The projection is purely structural: it never re-derives logic. It emits:
 *  - pneumatic components: cylinders + 5/2 double-solenoid valves, with the
 *    port-labelled pilot connections from each solenoid to its valve pilot;
 *  - electropneumatic components: relays (control/timer), coils, contacts,
 *    sensors (as sensor components) and the rung connections (rail -> contacts
 *    -> coil).
 *
 * Port labels follow RULES.md §4.1: valve P=1, A=2, B=4, R=3, S=5, pilots
 * 12/14. Rails are "+24V"/"0V"; rung nodes are named "R<n>".
 */

import type {
  Circuit,
  CircuitComponent,
  Connection,
  Relay,
  Sensor,
  ActuatorId,
} from '../domain/index.ts';
import type { CircuitLogicalModel, PneumaticValve } from './model.ts';
import { advancedSensorId, retractedSensorId } from './naming.ts';

const RAIL_TOP = '+24V';
const RAIL_BOTTOM = '0V';

/** Build the flat {@link Circuit} from the logical model. */
export function toCircuit(model: CircuitLogicalModel): Circuit {
  const components: CircuitComponent[] = [];
  const connections: Connection[] = [];

  // --- pneumatic components ---
  for (const cyl of model.pneumatic.cylinders) {
    components.push({ kind: 'cylinder', id: cyl.id, actuator: cyl.actuator });
  }
  for (const valve of model.pneumatic.valves) {
    components.push({
      kind: 'directional-valve',
      id: valve.id,
      valveType: '5/2',
      actuation: 'double-pilot',
      actuator: valve.actuator,
    });
  }

  // --- sensors (both ends of every actuator that has a sensor referenced) ---
  for (const sensor of buildSensors(model)) {
    components.push(sensor);
  }

  // --- relays + their coils ---
  for (const step of model.steps) {
    const relay: Relay = step.hasTimer
      ? {
          kind: 'relay',
          id: step.relayId,
          relayKind: 'timer',
          delaySeconds: step.delaySeconds ?? 0.3,
        }
      : { kind: 'relay', id: step.relayId, relayKind: 'control' };
    components.push(relay);
  }

  // --- ladder rungs -> contacts, coils, connections ---
  let contactSeq = 0;
  const solenoidComponentIds = new Set<string>();
  for (const rung of model.ladder.rungs) {
    const rungNode = `R${rung.number}`;
    // Coil component. Relay coils carry an id tied to the relay; solenoid
    // coils use the solenoid id itself so pneumatic pilot connections can
    // reference them as an existing component.
    if (rung.coil.kind === 'relay') {
      components.push({
        kind: 'coil',
        id: `coil-${rung.coil.id}-r${rung.number}`,
        relayId: rung.coil.id,
      });
    } else {
      // solenoid coil: id === solenoid id (e.g. "1Y1").
      if (!solenoidComponentIds.has(rung.coil.id)) {
        solenoidComponentIds.add(rung.coil.id);
        components.push({
          kind: 'coil',
          id: rung.coil.id,
          relayId: rung.coil.id,
        });
      }
    }
    // Set-branch contacts (parallel branches).
    for (const branch of rung.setBranches) {
      for (const c of branch.contacts) {
        const id = `C${++contactSeq}`;
        components.push({
          kind: 'contact',
          id,
          contactType: c.type,
          ownerId: c.driverId,
        });
        // Contact wired from the top rail into the rung node (electric).
        connections.push({
          sourceComponent: RAIL_TOP,
          sourcePort: 'L',
          targetComponent: id,
          targetPort: 'in',
          signalType: 'electric',
        });
        connections.push({
          sourceComponent: id,
          sourcePort: 'out',
          targetComponent: rungNode,
          targetPort: 'node',
          signalType: 'electric',
        });
      }
    }
    for (const c of rung.resetContacts) {
      const id = `C${++contactSeq}`;
      components.push({
        kind: 'contact',
        id,
        contactType: c.type,
        ownerId: c.driverId,
      });
      connections.push({
        sourceComponent: rungNode,
        sourcePort: 'node',
        targetComponent: id,
        targetPort: 'in',
        signalType: 'electric',
      });
    }
  }

  // --- solenoid coil components: every double-solenoid valve physically has
  // BOTH solenoids, even if a given sequence never energizes one of them. Emit
  // any not already created by a power rung so pilot connections are valid. ---
  for (const valve of model.pneumatic.valves) {
    for (const solId of [valve.advanceSolenoidId, valve.retractSolenoidId]) {
      if (!solenoidComponentIds.has(solId)) {
        solenoidComponentIds.add(solId);
        components.push({ kind: 'coil', id: solId, relayId: solId });
      }
    }
  }

  // --- pneumatic pilot connections: solenoid -> valve pilot port ---
  for (const valve of model.pneumatic.valves) {
    pushPilotConnections(connections, valve);
  }

  return {
    domain: 'electropneumatic',
    method: model.method,
    components,
    connections,
    groups: [],
    explanation: [],
  };
}

/** Emit both stroke-end sensors for every actuator referenced by the model. */
function buildSensors(model: CircuitLogicalModel): Sensor[] {
  const referenced = new Set(model.sensorIds);
  const sensors: Sensor[] = [];
  const seen = new Set<string>();
  for (const actuator of model.actuators) {
    const s1 = retractedSensorId(actuator);
    const s2 = advancedSensorId(actuator);
    for (const [id, position] of [
      [s1, 'retracted'],
      [s2, 'extended'],
    ] as const) {
      // Only emit a sensor that is actually referenced OR is one of the two
      // canonical ends. We emit referenced ones (validator requires existence).
      if (referenced.has(id) && !seen.has(id)) {
        seen.add(id);
        sensors.push({ kind: 'sensor', id, actuator: actuator as ActuatorId, position });
      }
    }
  }
  return sensors;
}

/** advance solenoid -> pilot 14; retract solenoid -> pilot 12. */
function pushPilotConnections(connections: Connection[], valve: PneumaticValve): void {
  connections.push({
    sourceComponent: valve.advanceSolenoidId,
    sourcePort: 'out',
    targetComponent: valve.id,
    targetPort: '14',
    signalType: 'pneumatic',
  });
  connections.push({
    sourceComponent: valve.retractSolenoidId,
    sourcePort: 'out',
    targetComponent: valve.id,
    targetPort: '12',
    signalType: 'pneumatic',
  });
}
