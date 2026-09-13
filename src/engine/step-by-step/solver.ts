/**
 * Step-by-step (método passo a passo) solver.
 *
 * Consumes a parsed {@link SequenceModel} and produces a
 * {@link CircuitLogicalModel} following the three PMR3407 rules (RULES.md §8):
 *
 *   1. A step's line energizes only if the PREVIOUS line is active.
 *   2. ...and only when the PREVIOUS step's end-of-course sensor is tripped.
 *   3. Energizing a new line DE-ENERGIZES the previous line (reset).
 *
 * Each step gets one control relay Ki (a memory) built as a "subcircuito
 * basico":
 *   - a SET branch: [prev-line NO Ki-1] AND [prev-sensor NO], in series;
 *     for the first step the set branch is the START button contact.
 *   - a SEAL branch (SELO): the relay's OWN NO contact (Ki) in PARALLEL with
 *     the set branch, so the memory HOLDS after the triggering sensor opens.
 *     THIS is the load-bearing bit: the seal must be Ki's own contact, not the
 *     transient sensor, or the step drops when the cylinder leaves the sensor.
 *   - a RESET contact: the NEXT line's NC contact (Ki+1) in series, so setting
 *     Ki+1 opens it and drops Ki (rule 3).
 *
 * Power section: each step energizes the solenoid(s) for its movement(s) while
 * its relay is on (a rung per movement with the relay's NO contact feeding the
 * solenoid coil).
 *
 * Arming the last line (RULES.md §8): an extra arming contact primes the last
 * line so a single START press (single cycle) / the wrap-around (continuous)
 * begins correctly. We model this as an 'arming' contact branch on the first
 * rung, driven by the LAST relay's NC (single) or NO (continuous) contact.
 *
 * Timer (T) steps use a TIME relay (boxed delay) gating the transition: the
 * step's relay is a timer relay with delaySeconds, and the NEXT step is gated
 * by that timer relay instead of a sensor is NOT what the course does — the
 * course keeps the sensor of the previous movement AND inserts the delay on the
 * timed step's own energization. We model the timed step's relay as a timer
 * relay; its downstream enabling still uses the timed step's arrival sensor.
 */

import type {
  ActuatorId,
  InitialState,
  Movement,
  RestState,
  SequenceModel,
  Step,
} from '../../domain/index.ts';
import { initialStateFrom } from '../../domain/index.ts';
import type {
  CircuitLogicalModel,
  CycleMode,
  Ladder,
  PlanMovement,
  PlanStep,
  PneumaticModel,
  Rung,
  RungBranch,
  RungContact,
} from '../model.ts';
import {
  cylinderId,
  mainValveId,
  relayId,
  sensorIdForArrival,
  solenoidId,
} from '../naming.ts';

export interface StepByStepOptions {
  /** single (default) or continuous. RULES.md §9. */
  readonly cycleMode?: CycleMode;
  /** Start button id. Default "E" (RULES.md §5). */
  readonly startButtonId?: string;
  /** Default delay assigned to timer steps, seconds. Default 0.3. */
  readonly defaultDelaySeconds?: number;
  /** Explicit initial rest positions per actuator. Defaults to sequence.initialState. */
  readonly initialState?: Readonly<Record<ActuatorId, RestState>> | InitialState;
}

const DEFAULT_DELAY = 0.3;

/**
 * Solve a sequence with the step-by-step method into a logical model.
 * Assumes the SequenceModel is already valid (produced by the parser).
 */
export function solveStepByStep(
  sequence: SequenceModel,
  options: StepByStepOptions = {},
): CircuitLogicalModel {
  const cycleMode: CycleMode = options.cycleMode ?? 'single';
  const startButtonId = options.startButtonId ?? 'E';
  const defaultDelay = options.defaultDelaySeconds ?? DEFAULT_DELAY;
  const initialState: InitialState = options.initialState
    ? ('positions' in options.initialState
      ? (options.initialState as InitialState)
      : initialStateFrom(sequence.actuators, options.initialState))
    : sequence.initialState;

  const planSteps = buildPlanSteps(sequence.steps, defaultDelay);
  const ladder = buildLadder(planSteps, startButtonId, cycleMode);
  const pneumatic = buildPneumatic(sequence.actuators);

  const sensorIds = collectSensorIds(planSteps);
  const solenoidIds = collectSolenoidIds(planSteps);
  const relayIds = planSteps.map((s) => s.relayId);

  return {
    method: 'step-by-step',
    cycleMode,
    sequence: sequence.canonical,
    actuators: sequence.actuators,
    initialState,
    steps: planSteps,
    ladder,
    pneumatic,
    startButtonId,
    sensorIds,
    solenoidIds,
    relayIds,
  };
}

/** Build the ordered plan steps with relays, solenoids and enable sensors. */
function buildPlanSteps(steps: readonly Step[], defaultDelay: number): PlanStep[] {
  const plan: PlanStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Step;
    const movements = step.movements.map((mv) => toPlanMovement(mv));

    // The sensors that ENABLE this step are the end-of-course sensors of the
    // PREVIOUS step's movement(s) (rule 2). For a SIMULTANEOUS predecessor we
    // gate on ALL of its members' arrival sensors (co-terminal is NOT assumed):
    // the transition may only fire once EVERY member of the group has arrived,
    // not just the last-listed one (review issue 5). `enableSensorId` keeps the
    // last-listed sensor for display/explanation.
    let enableSensorId: string | undefined;
    let enableSensorIds: string[] | undefined;
    let enabledByStart = false;
    if (i === 0) {
      enabledByStart = true;
    } else {
      const prev = steps[i - 1] as Step;
      enableSensorIds = prev.movements.map((mv) =>
        sensorIdForArrival(mv.actuator, mv.direction),
      );
      const lastPrevMv = prev.movements[prev.movements.length - 1] as Movement;
      enableSensorId = sensorIdForArrival(lastPrevMv.actuator, lastPrevMv.direction);
    }

    const planStep: PlanStep = {
      index: i,
      relayId: relayId(i),
      movements,
      hasTimer: step.hasTimer,
      ...(step.hasTimer ? { delaySeconds: defaultDelay } : {}),
      ...(enableSensorId !== undefined ? { enableSensorId } : {}),
      ...(enableSensorIds !== undefined ? { enableSensorIds } : {}),
      enabledByStart,
    };
    plan.push(planStep);
  }

  return plan;
}

function toPlanMovement(mv: Movement): PlanMovement {
  return {
    actuator: mv.actuator,
    direction: mv.direction,
    solenoidId: solenoidId(mv.actuator, mv.direction),
    arrivalSensorId: sensorIdForArrival(mv.actuator, mv.direction),
  };
}

/**
 * Build the ladder: one control rung per step + one power rung per movement.
 *
 * Control rung i (0-based step, rung number = i + 1):
 *   setBranches:
 *     - activation branch: [prev-line NO (Ki-1)] AND [prev-sensor NO]  OR
 *       (for step 0) [start NO (E)] (+ arming contact, see below)
 *     - seal branch: [seal NO (Ki)]
 *   resetContacts: [reset NC (Ki+1)]  (absent for the last step unless
 *     continuous re-arm handles it)
 *   coil: relay Ki (timer relay when hasTimer)
 */
function buildLadder(
  steps: readonly PlanStep[],
  startButtonId: string,
  cycleMode: CycleMode,
): Ladder {
  const rungs: Rung[] = [];
  const n = steps.length;
  let rungNumber = 1;

  for (let i = 0; i < n; i++) {
    const step = steps[i] as PlanStep;
    const isFirst = i === 0;
    const isLast = i === n - 1;

    // --- activation (set) branch ---
    const activationContacts: RungContact[] = [];
    // Extra wrap branch for the first rung in continuous mode (see below).
    let wrapBranch: RungBranch | undefined;
    if (isFirst) {
      activationContacts.push({ driverId: startButtonId, type: 'NO', role: 'start' });
      const lastRelay = steps[n - 1] as PlanStep;
      if (cycleMode === 'continuous') {
        // CONTINUOUS: the last line re-arms the first for wrap-around. This must
        // be a PARALLEL branch (OR), not in series with START, otherwise the
        // very first press could never start the cycle (K_last is OFF at rest,
        // so a series NO contact would block START). Modeled as its own branch
        // holding the last relay's NO contact.
        wrapBranch = {
          contacts: [{ driverId: lastRelay.relayId, type: 'NO', role: 'arming' }],
        };
      } else {
        // SINGLE: an arming NC contact of the last relay, in SERIES with START,
        // keeps the first line armed only while the last line is OFF (so the
        // cycle runs exactly once per press and cannot restart itself).
        activationContacts.push({
          driverId: lastRelay.relayId,
          type: 'NC',
          role: 'arming',
        });
      }
    } else {
      const prev = steps[i - 1] as PlanStep;
      activationContacts.push({ driverId: prev.relayId, type: 'NO', role: 'prev-line' });
      // Gate on ALL of the previous step's arrival sensors, in SERIES (AND), so
      // a simultaneous predecessor must have EVERY member arrive before this
      // step can energize (review issue 5). Falls back to the single
      // enableSensorId for an ordinary predecessor.
      const prevSensors =
        step.enableSensorIds ??
        (step.enableSensorId !== undefined ? [step.enableSensorId] : []);
      for (const sensorId of prevSensors) {
        activationContacts.push({
          driverId: sensorId,
          type: 'NO',
          role: 'prev-sensor',
        });
      }
    }
    const activationBranch: RungBranch = { contacts: activationContacts };

    // --- seal branch (SELO): the relay's OWN NO contact ---
    // Critical topology: the seal is Ki, NOT the transient prev-sensor, so the
    // memory holds after the cylinder leaves that sensor.
    const sealBranch: RungBranch = {
      contacts: [{ driverId: step.relayId, type: 'NO', role: 'seal' }],
    };

    // --- reset contact: NEXT line's NC contact drops this line (rule 3) ---
    const resetContacts: RungContact[] = [];
    if (!isLast) {
      const next = steps[i + 1] as PlanStep;
      resetContacts.push({ driverId: next.relayId, type: 'NC', role: 'reset' });
    } else if (cycleMode === 'continuous') {
      // In continuous mode the wrap-around: the FIRST line resets the last.
      const first = steps[0] as PlanStep;
      resetContacts.push({ driverId: first.relayId, type: 'NC', role: 'reset' });
    }

    const setBranches: RungBranch[] =
      wrapBranch !== undefined
        ? [activationBranch, wrapBranch, sealBranch]
        : [activationBranch, sealBranch];

    rungs.push({
      number: rungNumber++,
      setBranches,
      resetContacts,
      coil: { kind: 'relay', id: step.relayId },
    });
  }

  // --- power rungs: each unique solenoid energized by its step relays in parallel ---
  const solenoidRelays = new Map<string, string[]>();
  for (let i = 0; i < n; i++) {
    const step = steps[i] as PlanStep;
    for (const mv of step.movements) {
      const relays = solenoidRelays.get(mv.solenoidId);
      if (relays !== undefined) {
        if (!relays.includes(step.relayId)) {
          relays.push(step.relayId);
        }
      } else {
        solenoidRelays.set(mv.solenoidId, [step.relayId]);
      }
    }
  }

  for (const [solId, relays] of solenoidRelays) {
    rungs.push({
      number: rungNumber++,
      setBranches: relays.map((rId) => ({
        contacts: [{ driverId: rId, type: 'NO', role: 'prev-line' }],
      })),
      resetContacts: [],
      coil: { kind: 'solenoid', id: solId },
    });
  }

  return { rungs };
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

function collectSensorIds(steps: readonly PlanStep[]): string[] {
  const set = new Set<string>();
  for (const step of steps) {
    if (step.enableSensorIds !== undefined) {
      for (const id of step.enableSensorIds) set.add(id);
    } else if (step.enableSensorId !== undefined) {
      set.add(step.enableSensorId);
    }
    for (const mv of step.movements) set.add(mv.arrivalSensorId);
  }
  return [...set].sort();
}

function collectSolenoidIds(steps: readonly PlanStep[]): string[] {
  const set = new Set<string>();
  for (const step of steps) {
    for (const mv of step.movements) set.add(mv.solenoidId);
  }
  return [...set].sort();
}
