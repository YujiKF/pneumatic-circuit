/**
 * Projection of a {@link CascadeLogicalModel} to the flat domain
 * {@link Circuit} (components + connections) consumed by the CircuitValidator
 * and, later, the layout engine and SVG renderer.
 *
 * The projection is purely structural: it never re-derives cascade logic. It
 * emits the PNEUMATIC circuit:
 *  - cylinders + their 5/2 double-solenoid main valves;
 *  - Nm cascade memory valves as 5/2 double-pilot directional valves;
 *  - stroke-end sensors for every referenced sensor id;
 *  - a supply (start) valve feeding the memory-valve chain;
 *  - connections: memory-valve pilots driven by group-activation sensors
 *    (set/reset), pressure lines feeding intra-group sensors, and each
 *    movement's gated signal reaching the main valve pilot (12/14).
 *
 * Port labels follow RULES.md §4.1: valve P=1, A=2, B=4, R=3, S=5, pilots
 * 12/14. The result validates with zero issues under validateCircuit.
 */

import type {
  ActuatorId,
  Circuit,
  CircuitComponent,
  Connection,
  DirectionalValve,
  Sensor,
} from '../../domain/index.ts';
import type { CascadeGroup } from '../../domain/index.ts';
import { advancedSensorId, retractedSensorId } from '../naming.ts';
import type { CascadeLogicalModel } from './model.ts';

/** Build the flat {@link Circuit} from the cascade logical model. */
export function toCascadeCircuit(model: CascadeLogicalModel): Circuit {
  const components: CircuitComponent[] = [];
  const connections: Connection[] = [];

  // --- cylinders + main valves ---
  for (const cyl of model.pneumatic.cylinders) {
    components.push({ kind: 'cylinder', id: cyl.id, actuator: cyl.actuator });
  }
  const mainValveById = new Map<string, ActuatorId>();
  for (const valve of model.pneumatic.valves) {
    mainValveById.set(valve.id, valve.actuator);
    components.push({
      kind: 'directional-valve',
      id: valve.id,
      valveType: '5/2',
      actuation: 'double-pilot',
      actuator: valve.actuator,
    });
  }

  // --- sensors (every referenced sensor id) ---
  for (const sensor of buildSensors(model)) components.push(sensor);
  const sensorSet = new Set(model.sensorIds);

  // --- supply/start valve feeding the memory chain (3/2 spring-return) ---
  const supply: DirectionalValve = {
    kind: 'directional-valve',
    id: model.startButtonId,
    valveType: '3/2',
    actuation: 'spring-return',
  };
  components.push(supply);

  // --- memory valves (bistable double-pilot 5/2) ---
  const memByActivatesLine = new Map<string, string>();
  for (const mem of model.memories) memByActivatesLine.set(mem.activatesLineId, mem.valveId);

  // Track how many times each setSensorId is used across memories.
  // When an activation sensor is reused across multiple memories (e.g. 2S1 for M1 and M3),
  // each transition uses a dedicated limit switch component gated by the preceding group's line
  // so no sensor raw-drives multiple memory pilots (Finding D).
  const setSensorUsage = new Map<string, number>();
  for (const mem of model.memories) {
    setSensorUsage.set(mem.setSensorId, (setSensorUsage.get(mem.setSensorId) ?? 0) + 1);
  }

  for (let idx = 0; idx < model.memories.length; idx++) {
    const mem = model.memories[idx]!;
    components.push({
      kind: 'directional-valve',
      id: mem.valveId,
      valveType: '5/2',
      actuation: 'double-pilot',
    });

    // Group line feeding this transition:
    const deactLine = mem.deactivatesLineId; // line k
    const lineSourceComp = memByActivatesLine.get(deactLine) ?? model.startButtonId;
    const lineSourcePort = '2';

    // If the activation sensor is reused across memory pilots, disambiguate by its group line:
    const isReused = (setSensorUsage.get(mem.setSensorId) ?? 0) > 1;
    const setDriverId = isReused ? `${mem.setSensorId}_${deactLine}` : mem.setSensorId;

    if (isReused) {
      // Ensure the disambiguated sensor component exists in components
      const match = /^(\d+)S([12])/.exec(mem.setSensorId);
      const actIdx = match ? parseInt(match[1]!, 10) - 1 : 0;
      const actuator = model.actuators[actIdx] ?? 'A';
      const position = match && match[2] === '1' ? 'retracted' : 'extended';
      components.push({
        kind: 'sensor',
        id: setDriverId,
        actuator,
        position,
      });
      // Line feeds the sensor inlet:
      connections.push({
        sourceComponent: lineSourceComp,
        sourcePort: lineSourcePort,
        targetComponent: setDriverId,
        targetPort: 'in',
        signalType: 'pneumatic',
      });
    }

    // SET pilot (port 14) driven by the activation sensor
    connections.push({
      sourceComponent: setDriverId,
      sourcePort: 'out',
      targetComponent: mem.valveId,
      targetPort: '14',
      signalType: 'pneumatic',
    });

    // RESET pilot (port 12): In PMR3407 cascade, activating the next memory/line
    // (or supply for the last memory) resets this memory (RULES C5.3).
    // The next memory valve's port 2 (or supply line) provides the reset signal.
    const nextMem = model.memories[idx + 1];
    const resetDriver = nextMem ? nextMem.valveId : model.startButtonId;
    const resetPort = '2';
    connections.push({
      sourceComponent: resetDriver,
      sourcePort: resetPort,
      targetComponent: mem.valveId,
      targetPort: '12',
      signalType: 'pneumatic',
    });

    // Supply feeds the memory valve inlet (port 1).
    connections.push({
      sourceComponent: model.startButtonId,
      sourcePort: '2',
      targetComponent: mem.valveId,
      targetPort: '1',
      signalType: 'pneumatic',
    });
  }

  // --- pressure lines: each group line drives its movements' main valve pilot.

  for (const group of model.groups) {
    const lineSourceComp = memByActivatesLine.get(group.lineId) ?? model.startButtonId;
    const lineSourcePort = lineSourceComp === model.startButtonId ? '2' : '2';
    for (const mv of group.movements) {
      // A gated movement takes the line signal through its intra-group sensor;
      // the first movement of the group takes the line signal directly.
      if (mv.startSensorId !== undefined && sensorSet.has(mv.startSensorId)) {
        // line -> sensor.in ; sensor.out -> main valve pilot
        connections.push({
          sourceComponent: lineSourceComp,
          sourcePort: lineSourcePort,
          targetComponent: mv.startSensorId,
          targetPort: 'in',
          signalType: 'pneumatic',
        });
        connections.push({
          sourceComponent: mv.startSensorId,
          sourcePort: 'out',
          targetComponent: mv.mainValveId,
          targetPort: mv.pilotPort,
          signalType: 'pneumatic',
        });
      } else {
        // first movement of the group: line pressurization drives the pilot.
        connections.push({
          sourceComponent: lineSourceComp,
          sourcePort: lineSourcePort,
          targetComponent: mv.mainValveId,
          targetPort: mv.pilotPort,
          signalType: 'pneumatic',
        });
      }
    }
  }

  // --- ensure BOTH pilots of every main valve are connected (validator
  // requires 12 and 14 on double-pilot valves). A cylinder that only advances
  // OR only retracts within the shown cascade still physically has both pilots;
  // wire the unused pilot from the supply exhaust node so the structure is
  // complete. ---
  ensureBothPilots(model, connections);

  return {
    domain: 'pneumatic',
    method: 'cascade',
    components,
    connections,
    groups: toCascadeGroups(model),
    explanation: buildExplanation(model),
  };
}

/** Emit both stroke-end sensors for every referenced sensor id. */
function buildSensors(model: CascadeLogicalModel): Sensor[] {
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
      if (referenced.has(id) && !seen.has(id)) {
        seen.add(id);
        sensors.push({ kind: 'sensor', id, actuator, position });
      }
    }
  }
  return sensors;
}

/**
 * Guarantee both pilot ports (12, 14) of every main valve appear in some
 * connection. Any pilot never commanded by the sequence is tied to the supply
 * exhaust (port 3) so the double-pilot valve is structurally complete.
 */
function ensureBothPilots(
  model: CascadeLogicalModel,
  connections: Connection[],
): void {
  const pilotConnected = new Map<string, Set<string>>();
  for (const c of connections) {
    for (const [comp, port] of [
      [c.sourceComponent, c.sourcePort],
      [c.targetComponent, c.targetPort],
    ] as const) {
      let set = pilotConnected.get(comp);
      if (set === undefined) {
        set = new Set<string>();
        pilotConnected.set(comp, set);
      }
      set.add(port);
    }
  }
  for (const valve of model.pneumatic.valves) {
    const ports = pilotConnected.get(valve.id) ?? new Set<string>();
    for (const pilot of ['12', '14']) {
      if (!ports.has(pilot)) {
        connections.push({
          sourceComponent: model.startButtonId,
          sourcePort: '3',
          targetComponent: valve.id,
          targetPort: pilot,
          signalType: 'pneumatic',
        });
      }
    }
  }
}

/** Project the group models to the domain {@link CascadeGroup} aggregate. */
function toCascadeGroups(model: CascadeLogicalModel): CascadeGroup[] {
  return model.groups.map((g) => ({
    number: g.number,
    stepIndices: g.stepIndices ? [...g.stepIndices] : [],
    lineId: g.lineId,
  }));
}

/** Human-readable ordered explanation lines (Grupo I / Grupo II / ...). */
function buildExplanation(model: CascadeLogicalModel): string[] {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const lines: string[] = [];
  for (const group of model.groups) {
    const label = roman[group.number - 1] ?? String(group.number);
    lines.push(`Grupo ${label}:`);
    for (const mv of group.movements) {
      lines.push(`${mv.actuator}${mv.direction}`);
    }
  }
  lines.push(`Nm = ${model.numberOfMemories}`);
  return lines;
}
