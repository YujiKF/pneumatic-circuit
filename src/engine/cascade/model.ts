/**
 * Cascade logical model (método cascata), PMR3407 §7.
 *
 * This is the pneumatic cascade counterpart to the step-by-step
 * {@link CircuitLogicalModel}. It is DERIVED from the generic group division
 * (see groups.ts) and describes the pneumatic control structure:
 *
 *  - one PRESSURE LINE per group (only one is pressurized at a time);
 *  - Nm = groups - 1 bistable double-pilot MEMORY VALVES that select which
 *    line is live;
 *  - per movement, the intra-group SENSOR sits between the group pressure line
 *    and the cylinder's main valve pilot (a sensor's signal is only "live"
 *    while its group line is pressurized -> overlap is broken);
 *  - the group-ACTIVATION sensor (tripped by the LAST event of the previous
 *    group) drives a memory valve pilot to hand pressure to the next line and
 *    reset the previous memory (RULES.md §7.5).
 *
 * Everything downstream (flat {@link Circuit} for the validator, later the
 * renderer) is projected from this model; the model is the single source of
 * cascade logic. No enums (Node strip-only): closed sets are string unions.
 */

import type { ActuatorId, Direction, InitialState, SolverMethod } from '../../domain/index.ts';
import type { CycleMode, PneumaticModel } from '../model.ts';
import type { GroupDivision } from './groups.ts';

/** A single movement inside a cascade group, with its pneumatic ids. */
export interface CascadeMovement {
  readonly actuator: ActuatorId;
  readonly direction: Direction;
  /** Main valve pilot port fed for this movement: '14' advance, '12' retract. */
  readonly pilotPort: '12' | '14';
  /** Main valve id driven, e.g. "1.1". */
  readonly mainValveId: string;
  /**
   * Intra-group sensor that gates this movement (between the group's pressure
   * line and the main valve pilot). For the FIRST movement of a group there is
   * no intra-group gating sensor (the line pressurization itself starts it);
   * `startSensorId` is then undefined.
   */
  readonly startSensorId?: string;
  /**
   * ALL sensors that must be active (AND, in series between the line and the
   * pilot) for this movement to be commanded: the arrival sensors of EVERY
   * member of the previous step in the group (BAIXO-2 / RULES §A6). Members of
   * one simultaneous step share the same gate. `startSensorId` is the
   * last-listed entry (kept for display). Undefined when ungated.
   */
  readonly startSensorIds?: readonly string[];
  /**
   * True for the first step of the cycle (group 1, first step): its pilot is
   * fed by line 1 THROUGH the start button, so the cycle only begins when
   * START is pressed (RULES §6 step 4 / §9).
   */
  readonly gatedByStart?: boolean;
  /** Sensor reached WHEN this movement completes, e.g. "1S2". */
  readonly arrivalSensorId: string;
}

/** A transition from one group to the next via a memory valve. */
export interface CascadeTransition {
  readonly fromGroup: number;
  readonly toGroup: number;
  readonly memoryId: string;
  /** Arrival sensor(s) from all members of the previous group's final step. */
  readonly conditionSensorIds: readonly string[];
}

/**
 * A cascade group: its steps' movements, the pressure line feeding it, and the
 * sensor whose activation HANDS control to this group (the last event of the
 * previous group). The first group has no activation sensor (it is the initial
 * line, energized via the start button / rest state).
 */
export interface CascadeGroupModel {
  /** 1-based group number (Grupo I = 1, ...). */
  readonly number: number;
  /** Pressure line id feeding this group, e.g. "L1". */
  readonly lineId: string;
  /** Ordered movements executed while this group's line is live. */
  readonly movements: readonly CascadeMovement[];
  /** Step indices from the sequence belonging to this group. */
  readonly stepIndices?: readonly number[];
  /**
   * Sensor whose activation transfers pressure to THIS group's line (tripped
   * by the last movement of the previous group). Undefined for the first
   * group.
   */
  readonly activationSensorId?: string;
}

/**
 * A bistable double-pilot memory valve (4/2 or 5/2). There are Nm = groups - 1
 * of them. Memory k (1-based) is SET by the activation sensor of group k+1 and
 * feeds the transition between line k and line k+1.
 */
export interface CascadeMemoryValve {
  /** Memory id, e.g. "M1". */
  readonly id: string;
  /** Course valve id, e.g. "0.1", "0.2" (supply/cascade valves). */
  readonly valveId: string;
  /** Sensor id that pilots the SET side of this memory. */
  readonly setSensorId: string;
  /**
   * Sensor id that pilots the RESET side of this memory. For memory k < Nm it
   * is the activation sensor of group k+2 (the next memory takes over); for the
   * LAST memory it is the wrap sensor (last arrival of the last group), which
   * returns control to line 1. Undefined only if a model is hand-built.
   */
  readonly resetSensorId?: string;
  /** Pressure line this memory hands control TO when set, e.g. "L2". */
  readonly activatesLineId: string;
  /** Pressure line this memory takes control FROM when set, e.g. "L1". */
  readonly deactivatesLineId: string;
}

/** The complete cascade logical model for one solved sequence. */
export interface CascadeLogicalModel {
  readonly method: SolverMethod;
  readonly cycleMode: CycleMode;
  readonly sequence: string;
  readonly initialState?: InitialState;
  readonly actuators: readonly ActuatorId[];
  readonly groups: readonly CascadeGroupModel[];
  readonly memories: readonly CascadeMemoryValve[];
  readonly transitions: readonly CascadeTransition[];
  /**
   * The wrap-around transition from the LAST group's line back to line 1
   * (MÉDIO-2): its condition sensors (all members of the last step of the last
   * group) pilot the RESET side of the last memory, which returns the whole
   * chain to rest. Undefined when there is a single group (no memories).
   */
  readonly returnTransition?: CascadeTransition;
  readonly pneumatic: PneumaticModel;
  /** Id of the start button/valve, e.g. "E". */
  readonly startButtonId: string;
  /** Number of pressure lines = number of groups. */
  readonly numberOfGroups: number;
  /** Number of switching memory valves: Nm = groups - 1. */
  readonly numberOfMemories: number;
  /** Whether the last-into-first merge optimization was applied. */
  readonly merged: boolean;
  /** Underlying group division from the solver. */
  readonly division?: GroupDivision;
  /** All distinct sensor ids referenced anywhere in the model. */
  readonly sensorIds: readonly string[];
}
