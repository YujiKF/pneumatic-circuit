/**
 * The CircuitLogicalModel: the single logical representation a solver method
 * produces. Everything downstream (the {@link Circuit} for validation/render,
 * the simulator, and the textual explanation) is DERIVED from this model, so
 * there is exactly one source of logic.
 *
 * This is deliberately richer than the flat {@link Circuit} in the domain: it
 * keeps the ladder structure (rungs with contact groups + coils), the per-step
 * plan, the seal-contact topology, and the pneumatic model together. A
 * projection to a flat {@link Circuit} (components + connections) is provided
 * by circuit.ts for the validator and future renderer.
 *
 * No enums (strip-only): closed sets are string-literal unions.
 */

import type {
  ActuatorId,
  Direction,
  SolverMethod,
} from '../domain/index.ts';

/** How the whole cycle repeats. RULES.md section 9. */
export type CycleMode = 'single' | 'continuous';

/**
 * A logical step in the executed plan. One control relay (memory) per step.
 * A step may carry MORE THAN ONE movement (simultaneous parenthesized group),
 * all sharing the single relay/line.
 */
export interface PlanStep {
  /** 0-based index within the plan (equals the sequence step index). */
  readonly index: number;
  /** Control relay id for this step, e.g. "K1". */
  readonly relayId: string;
  /** Movements executed simultaneously in this step. */
  readonly movements: readonly PlanMovement[];
  /**
   * Whether this step is gated by a time relay (timer prefix). When true the
   * relay is a timer relay with `delaySeconds`.
   */
  readonly hasTimer: boolean;
  /** Delay for the timer relay, seconds; undefined when hasTimer is false. */
  readonly delaySeconds?: number;
  /**
   * The sensor id whose activation ENABLES this step (the end-of-course sensor
   * tripped by the PREVIOUS step's movement). For the first step this is the
   * START button id instead of a sensor. See `enabledByStart`.
   */
  readonly enableSensorId?: string;
  /** True for the first step: enabled by the START button, not a sensor. */
  readonly enabledByStart: boolean;
}

/** A single actuator movement inside a plan step, with its solenoid/sensor. */
export interface PlanMovement {
  readonly actuator: ActuatorId;
  readonly direction: Direction;
  /** Solenoid energized by this step to drive the movement, e.g. "1Y1". */
  readonly solenoidId: string;
  /** Sensor reached WHEN this movement completes, e.g. "1S2". */
  readonly arrivalSensorId: string;
}

// ---------------------------------------------------------------------------
// Ladder (electrical) structure
// ---------------------------------------------------------------------------

/**
 * A contact on a rung. `driverId` is the element that operates the contact:
 * a relay ("K1"), a sensor ("1S2") or the start button ("E").
 * `role` records WHY the contact is present, which lets tests assert the
 * SEAL topology precisely.
 */
export interface RungContact {
  readonly driverId: string;
  readonly type: 'NO' | 'NC';
  /**
   * Semantic role of the contact:
   *  - 'start'      : the START button contact (rung 1 set path)
   *  - 'prev-line'  : previous step's relay NO contact (rule 1: prev active)
   *  - 'prev-sensor': previous movement's end-of-course sensor (rule 2)
   *  - 'seal'       : the step's OWN relay NO contact holding it (SELO)
   *  - 'reset'      : the next step's relay NC contact (rule 3: de-energize)
   *  - 'arming'     : the extra arming contact for the last line
   */
  readonly role:
    | 'start'
    | 'prev-line'
    | 'prev-sensor'
    | 'seal'
    | 'reset'
    | 'arming';
}

/**
 * A parallel branch of series-connected contacts. On a rung, branches are in
 * parallel (logical OR); contacts within a branch are in series (logical AND).
 * The SEAL is a branch (the relay's own NO contact, in parallel with the
 * set/activation branch) so the memory holds after the triggering sensor
 * opens.
 */
export interface RungBranch {
  readonly contacts: readonly RungContact[];
}

/**
 * One ladder rung: a set of parallel branches feeding, in series with any
 * reset contacts, a coil. Energizing logic:
 *   coilEnergized = (OR over setBranches of (AND of branch contacts))
 *                   AND (AND over resetContacts)
 * The reset contacts are NC contacts of the NEXT line; when the next line is
 * on they open and drop this rung.
 */
export interface Rung {
  /** 1-based rung number. */
  readonly number: number;
  /** Parallel set branches (activation branch + seal branch). */
  readonly setBranches: readonly RungBranch[];
  /** Series reset contacts (NC of the next line, etc.). */
  readonly resetContacts: readonly RungContact[];
  /** The coil this rung energizes, e.g. relay coil "K1" or a solenoid. */
  readonly coil: RungCoil;
}

/** The coil energized at the end of a rung. */
export interface RungCoil {
  /** 'relay' = a control/timer relay coil; 'solenoid' = a valve solenoid. */
  readonly kind: 'relay' | 'solenoid';
  /** Id of the relay ("K1") or solenoid ("1Y1"). */
  readonly id: string;
}

/** The complete ladder (electrical circuit) as an ordered list of rungs. */
export interface Ladder {
  readonly rungs: readonly Rung[];
}

// ---------------------------------------------------------------------------
// Pneumatic structure
// ---------------------------------------------------------------------------

/** A double-acting cylinder in the pneumatic model. */
export interface PneumaticCylinder {
  readonly actuator: ActuatorId;
  /** e.g. "1.0". */
  readonly id: string;
}

/** A 5/2 double-solenoid (double-pilot) main directional valve. */
export interface PneumaticValve {
  readonly actuator: ActuatorId;
  /** e.g. "1.1". */
  readonly id: string;
  /** Solenoid driving the advance pilot (port 14). */
  readonly advanceSolenoidId: string;
  /** Solenoid driving the retract pilot (port 12). */
  readonly retractSolenoidId: string;
}

/** The pneumatic side: cylinders + their main valves. */
export interface PneumaticModel {
  readonly cylinders: readonly PneumaticCylinder[];
  readonly valves: readonly PneumaticValve[];
}

// ---------------------------------------------------------------------------
// The assembled logical model
// ---------------------------------------------------------------------------

/**
 * The complete logical model for one solved sequence. This is the single
 * source of truth. `steps` is the plan; `ladder` is the derived electrical
 * circuit; `pneumatic` is the derived pneumatic circuit.
 */
export interface CircuitLogicalModel {
  readonly method: SolverMethod;
  readonly cycleMode: CycleMode;
  /** Canonical sequence string this model was built from. */
  readonly sequence: string;
  readonly actuators: readonly ActuatorId[];
  readonly steps: readonly PlanStep[];
  readonly ladder: Ladder;
  readonly pneumatic: PneumaticModel;
  /** Id of the start button, e.g. "E". */
  readonly startButtonId: string;
  /** All distinct sensor ids referenced anywhere in the model. */
  readonly sensorIds: readonly string[];
  /** All distinct solenoid ids referenced anywhere in the model. */
  readonly solenoidIds: readonly string[];
  /** All distinct relay ids. */
  readonly relayIds: readonly string[];
}
