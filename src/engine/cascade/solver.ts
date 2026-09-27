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

import type { Movement, SequenceModel, Step } from '../../domain/index.ts';
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

  const groups = buildGroups(sequence, division);
  const memories = buildMemories(division, groups);
  const transitions = buildTransitions(sequence, division, memories);
  const returnTransition = buildReturnTransition(sequence, division, memories);
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
    ...(returnTransition !== undefined ? { returnTransition } : {}),
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
function buildGroups(sequence: SequenceModel, division: GroupDivision): CascadeGroupModel[] {
  const result: CascadeGroupModel[] = [];
  const flatGroups = division.groups;
  const lastGroup = flatGroups[flatGroups.length - 1];
  // Sensors whose activation wraps control back to line 1 (all members of the
  // last step of the last group). Used to gate a merged-in tail (RULES §A3).
  const wrapSensors =
    flatGroups.length > 1 && lastGroup ? lastStepArrivals(sequence, lastGroup) : [];

  for (let g = 0; g < flatGroups.length; g++) {
    const group = flatGroups[g] as DividedGroup;
    const steps = group.stepIndices.map((si) => sequence.steps[si] as Step);
    const tailSteps = g === 0 ? tailStepCount(steps, group.mergedTailCount) : 0;
    const movements = buildGroupMovements(steps, {
      firstIsCycleStart: g === 0,
      tailStepCount: tailSteps,
      wrapSensors,
    });

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

/** How many trailing STEPS hold the merged-in tail movements. */
function tailStepCount(steps: readonly Step[], tailMovements: number): number {
  if (tailMovements <= 0) return 0;
  let count = 0;
  let acc = 0;
  for (let i = steps.length - 1; i >= 0 && acc < tailMovements; i--) {
    acc += (steps[i] as Step).movements.length;
    count++;
  }
  return count;
}

/**
 * Arrival sensors of every member of the last step a group executes before
 * handing control forward (excluding a merged-in tail, see lastArrivalSensor).
 */
function lastStepArrivals(sequence: SequenceModel, group: DividedGroup): string[] {
  const steps = group.stepIndices.map((si) => sequence.steps[si] as Step);
  const handoffSteps = group.stepIndices.length - tailStepCount(steps, group.mergedTailCount);
  const lastIdx = group.stepIndices[Math.max(0, handoffSteps - 1)];
  const step = lastIdx === undefined ? undefined : sequence.steps[lastIdx];
  if (!step) return [];
  return step.movements.map((mv) => sensorIdForArrival(mv.actuator, mv.direction));
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
    const memory = memories[k - 1];
    const prevGroup = division.groups[k - 1];
    const conditionSensorIds = prevGroup ? lastStepArrivals(sequence, prevGroup) : [];
    if (conditionSensorIds.length === 0 && memory) conditionSensorIds.push(memory.setSensorId);
    transitions.push({
      fromGroup: k,
      toGroup: k + 1,
      memoryId: memory ? memory.id : memoryId(k),
      conditionSensorIds,
    });
  }

  return transitions;
}

/**
 * The wrap-around transition: last group -> line 1, piloting the RESET side of
 * the last memory (MÉDIO-2). Undefined for a single-group cascade.
 */
function buildReturnTransition(
  sequence: SequenceModel,
  division: GroupDivision,
  memories: readonly CascadeMemoryValve[],
): CascadeTransition | undefined {
  const last = division.groups[division.groups.length - 1];
  const lastMemory = memories[memories.length - 1];
  if (division.groups.length < 2 || !last || !lastMemory) return undefined;
  return {
    fromGroup: last.number,
    toGroup: 1,
    memoryId: lastMemory.id,
    conditionSensorIds: lastStepArrivals(sequence, last),
  };
}

interface GroupMovementOptions {
  /** Group 1: its first step is fed through the START button. */
  readonly firstIsCycleStart: boolean;
  /** Number of trailing steps that are a merged-in tail (group 1 only). */
  readonly tailStepCount: number;
  /** Sensors tripped by the last step of the last group (wrap to line 1). */
  readonly wrapSensors: readonly string[];
}

/**
 * Build a group's cascade movements with intra-group gating sensors.
 *
 * Gating is STEP-aware: every movement of a step is gated by the arrival
 * sensors of ALL members of the previous step in the group (series AND), so a
 * simultaneous step's members start together and a step after a simultaneous
 * step waits on every member (BAIXO-2). The first step of a group is fed by the
 * line directly — except group 1's first step, which is fed through START, and
 * the first step of a merged-in tail, which is gated by the wrap sensors (it
 * only runs after control wraps back to line 1).
 *
 * A gate sensor equal to the movement's own arrival sensor would be
 * self-referential (Finding A); such a step falls back to the previous distinct
 * step's arrivals.
 */
function buildGroupMovements(
  steps: readonly Step[],
  opts: GroupMovementOptions,
): CascadeMovement[] {
  const out: CascadeMovement[] = [];
  const tailStart = steps.length - opts.tailStepCount;
  let prevArrivals: string[] | undefined;
  let lastDistinctArrivals: string[] | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Step;
    const arrivals = step.movements.map((mv) => sensorIdForArrival(mv.actuator, mv.direction));

    let gate: string[] | undefined;
    if (opts.tailStepCount > 0 && i === tailStart) {
      gate = opts.wrapSensors.length > 0 ? [...opts.wrapSensors] : undefined;
    } else if (i > 0) {
      gate = prevArrivals;
      if (gate !== undefined && gate.some((s) => arrivals.includes(s))) {
        gate = lastDistinctArrivals;
      }
    }
    const gatedByStart = opts.firstIsCycleStart && i === 0;

    for (const mv of step.movements) {
      const startSensorId = gate !== undefined ? gate[gate.length - 1] : undefined;
      out.push({
        actuator: mv.actuator,
        direction: mv.direction,
        pilotPort: pilotPort(mv.direction),
        mainValveId: mainValveId(mv.actuator),
        ...(startSensorId !== undefined ? { startSensorId, startSensorIds: [...(gate as string[])] } : {}),
        ...(gatedByStart ? { gatedByStart: true } : {}),
        arrivalSensorId: sensorIdForArrival(mv.actuator, mv.direction),
      });
    }

    if (prevArrivals !== undefined && !sameSet(prevArrivals, arrivals)) {
      lastDistinctArrivals = prevArrivals;
    }
    prevArrivals = arrivals;
  }

  return out;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Arrival sensor of the LAST movement a group executes BEFORE handing control
 * forward. For group 1 with a merged-in tail, the tail runs only after the
 * wrap, so the hand-off happens at the end of the HEAD (not the tail).
 */
function lastArrivalSensor(group: DividedGroup): string {
  const handoff = group.movements.length - group.mergedTailCount;
  const last = group.movements[Math.max(0, handoff - 1)] as Movement;
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
    // The LAST memory is reset by the wrap sensor (last arrival of the last
    // group), returning control to line 1 (MÉDIO-2).
    const followingGroup = groups[k + 1];
    const lastGroup = groups[groups.length - 1] as CascadeGroupModel;
    const lastMv = lastGroup.movements[lastGroup.movements.length - 1];
    const resetSensorId =
      followingGroup?.activationSensorId ?? (k === nm ? lastMv?.arrivalSensorId : undefined);

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
      for (const s of mv.startSensorIds ?? []) set.add(s);
      set.add(mv.arrivalSensorId);
    }
  }
  for (const m of memories) {
    set.add(m.setSensorId);
    if (m.resetSensorId !== undefined) set.add(m.resetSensorId);
  }
  return [...set].sort();
}
