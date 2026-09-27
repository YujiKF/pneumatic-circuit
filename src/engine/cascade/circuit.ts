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

  // Memory pilots driven by sensors: every SET pilot, plus the RESET pilot of
  // the LAST memory (the wrap back to line 1, MÉDIO-2). The other RESET pilots
  // are driven by the next memory's output (activating line k+2 resets memory
  // k, RULES C5.3). A sensor that drives more than one memory pilot gets a
  // dedicated instance per line (`2S1_L1`, `2S1_L3`) fed by that line, so no
  // raw sensor pilots several memories (Finding D).
  const pilotUsage = new Map<string, number>();
  const bump = (id: string): void => {
    pilotUsage.set(id, (pilotUsage.get(id) ?? 0) + 1);
  };
  const setConditions = model.memories.map((mem, idx) =>
    conditionsOf(mem.setSensorId, model.transitions[idx]?.conditionSensorIds),
  );
  const lastMem = model.memories[model.memories.length - 1];
  const wrapConditions =
    lastMem !== undefined
      ? conditionsOf(lastMem.resetSensorId, model.returnTransition?.conditionSensorIds)
      : [];
  for (const conds of setConditions) for (const id of conds) bump(id);
  for (const id of wrapConditions) bump(id);

  const lineSource = (line: string): string => memByActivatesLine.get(line) ?? model.startButtonId;
  const addedSensorIds = new Set<string>(model.sensorIds);

  /** Wire line -> s1 -> s2 -> ... -> target:port (series AND of sensors). */
  const wireSeries = (
    line: string,
    sensors: readonly string[],
    target: string,
    port: string,
    dedicated: boolean,
  ): void => {
    let from = lineSource(line);
    let fromPort = '2';
    for (const raw of sensors) {
      const id = dedicated && (pilotUsage.get(raw) ?? 0) > 1 ? `${raw}_${line}` : raw;
      if (id !== raw && !addedSensorIds.has(id)) {
        addedSensorIds.add(id);
        components.push(sensorInstance(model, raw, id));
      }
      push({ sourceComponent: from, sourcePort: fromPort, targetComponent: id, targetPort: 'in', signalType: 'pneumatic' });
      from = id;
      fromPort = 'out';
    }
    push({ sourceComponent: from, sourcePort: fromPort, targetComponent: target, targetPort: port, signalType: 'pneumatic' });
  };

  const seen = new Set<string>();
  function push(c: Connection): void {
    const key = `${c.sourceComponent}:${c.sourcePort}>${c.targetComponent}:${c.targetPort}`;
    if (seen.has(key)) return;
    seen.add(key);
    connections.push(c);
  }

  for (let idx = 0; idx < model.memories.length; idx++) {
    const mem = model.memories[idx]!;
    components.push({
      kind: 'directional-valve',
      id: mem.valveId,
      valveType: '5/2',
      actuation: 'double-pilot',
    });

    // SET pilot (14): the activation sensor(s), live only while line k is.
    wireSeries(mem.deactivatesLineId, setConditions[idx]!, mem.valveId, '14', true);

    // RESET pilot (12): the next memory's output for k < Nm; for the last
    // memory the wrap sensor(s), live only while the last line is.
    const nextMem = model.memories[idx + 1];
    if (nextMem) {
      push({ sourceComponent: nextMem.valveId, sourcePort: '2', targetComponent: mem.valveId, targetPort: '12', signalType: 'pneumatic' });
    } else if (wrapConditions.length > 0) {
      wireSeries(mem.activatesLineId, wrapConditions, mem.valveId, '12', true);
    } else {
      push({ sourceComponent: model.startButtonId, sourcePort: '2', targetComponent: mem.valveId, targetPort: '12', signalType: 'pneumatic' });
    }

    // Supply feeds the memory valve inlet (port 1).
    push({ sourceComponent: model.startButtonId, sourcePort: '2', targetComponent: mem.valveId, targetPort: '1', signalType: 'pneumatic' });
  }

  // --- pressure lines: each group line drives its movements' main valve
  // pilot, through the movement's intra-group gate sensor(s) in series.
  for (const group of model.groups) {
    for (const mv of group.movements) {
      const gate = [...new Set([...(mv.startSensorIds ?? []), ...(mv.startSensorId !== undefined ? [mv.startSensorId] : [])])];
      wireSeries(group.lineId, gate, mv.mainValveId, mv.pilotPort, false);
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

/** Condition list for a memory pilot: all transition sensors, else the single id. */
function conditionsOf(single: string | undefined, all: readonly string[] | undefined): string[] {
  if (all !== undefined && all.length > 0) return [...all];
  return single !== undefined ? [single] : [];
}

/** A line-dedicated instance of a stroke-end sensor, e.g. "2S1_L3". */
function sensorInstance(model: CascadeLogicalModel, raw: string, id: string): Sensor {
  const match = /^(\d+)S([12])/.exec(raw);
  const actIdx = match ? parseInt(match[1]!, 10) - 1 : 0;
  const actuator = model.actuators[actIdx] ?? model.actuators[0] ?? 'A';
  const position = match && match[2] === '1' ? 'retracted' : 'extended';
  return { kind: 'sensor', id, actuator, position };
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
