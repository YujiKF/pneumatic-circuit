/**
 * Cascade (método cascata) solver, PMR3407 §7.
 *
 * Consumes a parsed {@link SequenceModel}, runs the generic group division
 * (groups.ts) and produces a {@link CascadeLogicalModel}: pressure lines (one
 * per group), Nm = groups - 1 bistable double-pilot memory valves, intra-group
 * sensors between the pressure line and the main valve, and group-activation
 * sensors driving the memory valves.
 *
 * CASCADE LINE-ACTIVATION LOGIC (RULES.md §7.5, deck 4 p.67 / deck 5):
 *  (a) the first line's pressurization passes through all memory valves in
 *      their rest state (it is the default live line);
 *  (b) a group activates only when the LAST event of the PREVIOUS group
 *      completes (its arrival sensor trips), which pilots the memory valve;
 *  (c) activating a group resets/de-pilots the memory valve that activated the
 *      previous group.
 *
 * Sensors for intra-group action changes sit BETWEEN the pressure line and the
 * cylinder's main valve; sensors that ACTIVATE a group drive the memory valves.
 *
 * This model is PNEUMATIC. If an electropneumatic cascade is later requested,
 * the electrical/ladder layer must be kept separate (as in FEAT-002); this
 * module does not conflate the two.
 *
 * No enums (Node strip-only): closed sets are string-literal unions.
 */

import type { Movement, SequenceModel } from '../../domain/index.ts';
import type { CycleMode, PneumaticModel } from '../model.ts';
import {
  cylinderId,
  mainValveId,
  sensorIdForArrival,
  solenoidId,
} from '../naming.ts';
import { divideIntoGroups } from './groups.ts';
import type { DividedGroup, GroupDivision } from './groups.ts';
import type {
  CascadeGroupModel,
  CascadeLogicalModel,
  CascadeMemoryValve,
  CascadeMovement,
  CascadeTransition,
} from './model.ts';

export interface CascadeOptions {
  /** single (default) or continuous. RULES.md §9. */
  readonly cycleMode?: CycleMode;
  /** Start button/valve id. Default "E". */
  readonly startButtonId?: string;
  /**
   * Apply the last-into-first merge optimization (RULES.md §7.4). Default true.
   */
  readonly mergeLastIntoFirst?: boolean;
}

/** Pressure line id for a 1-based group number, e.g. group 1 -> "L1". */
function lineId(groupNumber: number): string {
  return `L${groupNumber}`;
}

/** Memory valve id for a 1-based memory number, e.g. 1 -> "M1". */
function memoryId(memoryNumber: number): string {
  return `M${memoryNumber}`;
}

/** Cascade/supply valve course id for a 1-based memory number, e.g. "0.1". */
function memoryValveId(memoryNumber: number): string {
  return `0.${memoryNumber}`;
}

/** Pilot port for a direction: advance (+) = 14, retract (-) = 12. */
function pilotPort(direction: Movement['direction']): '12' | '14' {
  return direction === '+' ? '14' : '12';
}

/**
 * Solve a sequence with the cascade method into a {@link CascadeLogicalModel}.
 * Assumes the SequenceModel is valid (produced by the parser).
 */
export function solveCascade(
  sequence: SequenceModel,
  options: CascadeOptions = {},
): CascadeLogicalModel {
  const cycleMode: CycleMode = options.cycleMode ?? 'single';
  const startButtonId = options.startButtonId ?? 'E';

  const division: GroupDivision = divideIntoGroups(sequence, {
    mergeLastIntoFirst: options.mergeLastIntoFirst ?? true,
  });

  const groups = buildGroups(division);
  const memories = buildMemories(division, groups);
  const transitions = buildTransitions(sequence, division, memories);
  const pneumatic = buildPneumatic(sequence.actuators);
  const sensorIds = collectSensorIds(groups, memories);

  return {
    method: 'cascade',
    cycleMode,
    sequence: sequence.canonical,
    initialState: sequence.initialState,
    actuators: sequence.actuators,
    groups,
    memories,
    transitions,
    pneumatic,
    startButtonId,
    numberOfGroups: division.numberOfGroups,
    numberOfMemories: division.numberOfMemories,
    merged: division.merged,
    division,
    sensorIds,
  };
}

/**
 * Build the cascade group models with pressure lines, intra-group sensors and
 * activation sensors.
 *
 * Intra-group sensor placement: the FIRST movement of a group starts as soon as
 * the group line is pressurized (no gating sensor). Each SUBSEQUENT movement in
 * the same group is gated by the arrival sensor of the PREVIOUS movement in the
 * group (that sensor is only "live" while this group's line is pressurized).
 *
 * Activation sensor: a group (other than the first) is handed control by the
 * arrival sensor of the LAST movement of the PREVIOUS group.
 */
function buildGroups(division: GroupDivision): CascadeGroupModel[] {
  const result: CascadeGroupModel[] = [];
  const flatGroups = division.groups;

  for (let g = 0; g < flatGroups.length; g++) {
    const group = flatGroups[g] as DividedGroup;
    const movements = buildGroupMovements(group.movements);

    const activationSensorId =
      g === 0 ? undefined : lastArrivalSensor(flatGroups[g - 1] as DividedGroup);

    result.push({
      number: group.number,
      lineId: lineId(group.number),
      movements,
      stepIndices: group.stepIndices,
      ...(activationSensorId !== undefined ? { activationSensorId } : {}),
    });
  }

  return result;
}

/**
 * Build the transitions view: for every transition from group k to group k+1,
 * list the memory id and the arrival sensor(s) of all members of the previous
 * group's final event (including simultaneous members).
 */
function buildTransitions(
  sequence: SequenceModel,
  division: GroupDivision,
  memories: readonly CascadeMemoryValve[],
): CascadeTransition[] {
  const transitions: CascadeTransition[] = [];
  const nm = division.numberOfMemories;

  for (let k = 1; k <= nm; k++) {
    const fromGroup = k;
    const toGroup = k + 1;
    const memory = memories[k - 1];
    const prevGroup = division.groups[k - 1];

    const conditionSensorIds: string[] = [];
    if (prevGroup && prevGroup.stepIndices.length > 0) {
      const lastStepIndex = prevGroup.stepIndices[prevGroup.stepIndices.length - 1] as number;
      const step = sequence.steps[lastStepIndex];
      if (step) {
        for (const mv of step.movements) {
          conditionSensorIds.push(sensorIdForArrival(mv.actuator, mv.direction));
        }
      }
    }
    if (conditionSensorIds.length === 0 && memory) {
      conditionSensorIds.push(memory.setSensorId);
    }

    transitions.push({
      fromGroup,
      toGroup,
      memoryId: memory ? memory.id : memoryId(k),
      conditionSensorIds,
    });
  }

  return transitions;
}

/** Build a group's cascade movements with intra-group gating sensors. */
function buildGroupMovements(movements: readonly Movement[]): CascadeMovement[] {
  const out: CascadeMovement[] = [];
  let prevArrival: string | undefined;
  let lastDistinctArrival: string | undefined;

  for (const mv of movements) {
    const arrival = sensorIdForArrival(mv.actuator, mv.direction);
    // If a repeated movement in the same group trips the same arrival sensor,
    // gating it on that same sensor produces a degenerate self-referential gate
    // (startSensorId === arrivalSensorId). Fall back to the previous distinct
    // sensor in the group (or undefined if none, driven directly by line).
    let startSensorId = prevArrival;
    if (startSensorId !== undefined && startSensorId === arrival) {
      startSensorId = lastDistinctArrival;
    }

    out.push({
      actuator: mv.actuator,
      direction: mv.direction,
      pilotPort: pilotPort(mv.direction),
      mainValveId: mainValveId(mv.actuator),
      // The first movement of a group is started by line pressurization; later
      // movements are gated by the previous movement's arrival sensor.
      ...(startSensorId !== undefined ? { startSensorId } : {}),
      arrivalSensorId: arrival,
    });

    if (prevArrival !== undefined && prevArrival !== arrival) {
      lastDistinctArrival = prevArrival;
    }
    prevArrival = arrival;
  }

  return out;
}

/** Arrival sensor of the LAST movement of a group. */
function lastArrivalSensor(group: DividedGroup): string {
  const last = group.movements[group.movements.length - 1] as Movement;
  return sensorIdForArrival(last.actuator, last.direction);
}

/**
 * Build the Nm = groups - 1 bistable memory valves. Memory k (1-based) hands
 * control from line k to line k+1 when SET by group (k+1)'s activation sensor;
 * it is RESET by the activation sensor of the following group (k+2), i.e. when
 * the next memory takes over (RULES.md §7.5(c)).
 */
function buildMemories(
  division: GroupDivision,
  groups: readonly CascadeGroupModel[],
): CascadeMemoryValve[] {
  const memories: CascadeMemoryValve[] = [];
  const nm = division.numberOfMemories;

  for (let k = 1; k <= nm; k++) {
    // Memory k transitions line k -> line k+1; its SET pilot is group (k+1)'s
    // activation sensor.
    const targetGroup = groups[k] as CascadeGroupModel; // 0-based index k = group k+1
    const setSensorId = targetGroup.activationSensorId as string;

    // RESET pilot: the activation sensor of the group AFTER the target (k+2),
    // if it exists. When the next memory is set (its own set sensor trips) it
    // de-pilots this memory. The last memory has no downstream reset sensor.
    const followingGroup = groups[k + 1];
    const resetSensorId = followingGroup?.activationSensorId;

    memories.push({
      id: memoryId(k),
      valveId: memoryValveId(k),
      setSensorId,
      ...(resetSensorId !== undefined ? { resetSensorId } : {}),
      activatesLineId: lineId(k + 1),
      deactivatesLineId: lineId(k),
    });
  }

  return memories;
}

/** Build the pneumatic model: one cylinder + one 5/2 double-solenoid valve each. */
function buildPneumatic(actuators: readonly string[]): PneumaticModel {
  const cylinders = actuators.map((a) => ({ actuator: a, id: cylinderId(a) }));
  const valves = actuators.map((a) => ({
    actuator: a,
    id: mainValveId(a),
    advanceSolenoidId: solenoidId(a, '+'),
    retractSolenoidId: solenoidId(a, '-'),
  }));
  return { cylinders, valves };
}

/** Collect every distinct sensor id referenced by groups and memories. */
function collectSensorIds(
  groups: readonly CascadeGroupModel[],
  memories: readonly CascadeMemoryValve[],
): string[] {
  const set = new Set<string>();
  for (const group of groups) {
    if (group.activationSensorId !== undefined) set.add(group.activationSensorId);
    for (const mv of group.movements) {
      if (mv.startSensorId !== undefined) set.add(mv.startSensorId);
      set.add(mv.arrivalSensorId);
    }
  }
  for (const m of memories) {
    set.add(m.setSensorId);
    if (m.resetSensorId !== undefined) set.add(m.resetSensorId);
  }
  return [...set].sort();
}
