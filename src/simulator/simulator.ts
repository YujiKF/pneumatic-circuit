/**
 * Deterministic step-by-step simulator.
 *
 * It interprets the {@link CircuitLogicalModel}'s ladder and pneumatic model to
 * walk the physical cycle:
 *   START pressed -> Ki energizes -> its solenoid energizes -> the valve
 *   switches -> the cylinder moves -> the end-of-course sensor trips -> the
 *   next step's Ki energizes -> ...
 *
 * DESIGN. The engine is a strict alternation of two deterministic phases:
 *   1. ELECTRICAL SETTLE: evaluate the ladder to a fixed point. A relay's SEAL
 *      (its own NO contact) latches it, so once set it stays ON while its hold
 *      path is closed -- EVEN AFTER the transient triggering sensor opens. This
 *      is exactly what the seal-contact regression test exercises.
 *   2. PHYSICAL EVENT: apply AT MOST ONE cylinder motion commanded by the now-
 *      energized solenoids (the cylinder whose commanded direction differs from
 *      its current end position). Moving it trips the arrival sensor and clears
 *      the departure sensor.
 * Applying only ONE motion per round keeps sequences that reuse a cylinder
 * (e.g. A+A-A+A-) deterministic: each physical event re-settles the ladder
 * before the next event is chosen, so the step pointer advances one line at a
 * time.
 *
 * The simulator records a TRACE of discrete events; the explanation generator
 * consumes the same trace (single source of logic).
 */

import type { CircuitLogicalModel, PlanStep, Rung } from '../engine/model.ts';
import { retractedSensorId, advancedSensorId } from '../engine/naming.ts';
import type { SimState } from './state.ts';
import { relayOn, sensorActive } from './state.ts';
import type { CylinderState } from '../domain/index.ts';

/** A discrete simulation event, used by the explanation generator. */
export interface SimEvent {
  readonly kind:
    | 'start'
    | 'relay-on'
    | 'relay-off'
    | 'solenoid-on'
    | 'valve-switch'
    | 'cylinder-move'
    | 'cylinder-arrive'
    | 'sensor-active'
    | 'enable-next'
    | 'cycle-complete';
  /** Primary component id involved (relay/solenoid/valve/sensor/actuator). */
  readonly id: string;
  /** Optional secondary detail (actuator letter, direction, next relay). */
  readonly detail?: string;
}

export interface SimResult {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
  /** True if the cycle completed (all steps executed once). */
  readonly completed: boolean;
}

/** Build the initial state: all cylinders retracted, home sensors ACTIVE. */
export function initialSimState(model: CircuitLogicalModel): SimState {
  const relays = new Map<string, 'ON' | 'OFF'>();
  const solenoids = new Map<string, 'ON' | 'OFF'>();
  const sensors = new Map<string, 'ACTIVE' | 'INACTIVE'>();
  const cylinders = new Map<string, CylinderState>();
  const valves = new Map<string, 'STATE_1' | 'STATE_2'>();

  for (const id of model.relayIds) relays.set(id, 'OFF');
  for (const id of model.solenoidIds) solenoids.set(id, 'OFF');
  for (const actuator of model.actuators) {
    cylinders.set(actuator, 'RETRACTED');
    sensors.set(retractedSensorId(actuator), 'ACTIVE');
    sensors.set(advancedSensorId(actuator), 'INACTIVE');
  }
  for (const valve of model.pneumatic.valves) {
    valves.set(valve.id, 'STATE_1'); // STATE_1 = retracted position
  }

  return { relays, solenoids, sensors, cylinders, valves, startPressed: false };
}

/** A contact is "closed" (conducts) per its type and its driver's state. */
function contactClosed(
  driverId: string,
  type: 'NO' | 'NC',
  state: SimState,
  startButtonId: string,
): boolean {
  const on = driverActive(driverId, state, startButtonId);
  return type === 'NO' ? on : !on;
}

function driverActive(
  driverId: string,
  state: SimState,
  startButtonId: string,
): boolean {
  if (state.relays.has(driverId)) return relayOn(state, driverId);
  if (state.sensors.has(driverId)) return sensorActive(state, driverId);
  if (driverId === startButtonId) return state.startPressed;
  return false;
}

/** Evaluate one rung: (OR of set branches) AND (AND of reset contacts). */
function evaluateRung(rung: Rung, state: SimState, startButtonId: string): boolean {
  const setClosed = rung.setBranches.some((branch) =>
    branch.contacts.every((c) => contactClosed(c.driverId, c.type, state, startButtonId)),
  );
  if (!setClosed) return false;
  return rung.resetContacts.every((c) =>
    contactClosed(c.driverId, c.type, state, startButtonId),
  );
}

/**
 * Settle the ladder to a fixed point and record events.
 *
 * RELAY rungs are evaluated iteratively (their seal contacts form latches). A
 * SOLENOID may be driven by MORE THAN ONE power rung (e.g. both K1 and K3
 * command A+ via 1Y1); its coil is the logical OR of all rungs targeting it
 * (parallel coils / wired-OR), computed after the relays settle. Evaluating a
 * multiply-driven coil rung-by-rung with last-writer-wins would oscillate, so
 * the OR is explicit here.
 */
function settleLadder(
  model: CircuitLogicalModel,
  state: SimState,
  events: SimEvent[],
): void {
  // 1) settle relay coils to a fixed point.
  let changed = true;
  let guard = 0;
  while (changed && guard < 1000) {
    changed = false;
    guard++;
    for (const rung of model.ladder.rungs) {
      if (rung.coil.kind !== 'relay') continue;
      const target = evaluateRung(rung, state, model.startButtonId) ? 'ON' : 'OFF';
      if (state.relays.get(rung.coil.id) !== target) {
        state.relays.set(rung.coil.id, target);
        changed = true;
        if (target === 'ON') {
          const step = model.steps.find((s) => s.relayId === rung.coil.id);
          if (step !== undefined && !step.enabledByStart && step.enableSensorId !== undefined) {
            events.push({
              kind: 'enable-next',
              id: step.enableSensorId,
              detail: rung.coil.id,
            });
          }
        }
        events.push({
          kind: target === 'ON' ? 'relay-on' : 'relay-off',
          id: rung.coil.id,
        });
      }
    }
  }

  // 2) compute each solenoid as the OR over its power rungs.
  const solenoidTarget = new Map<string, boolean>();
  for (const rung of model.ladder.rungs) {
    if (rung.coil.kind !== 'solenoid') continue;
    const on = evaluateRung(rung, state, model.startButtonId);
    solenoidTarget.set(rung.coil.id, (solenoidTarget.get(rung.coil.id) ?? false) || on);
  }
  for (const [id, on] of solenoidTarget) {
    const target = on ? 'ON' : 'OFF';
    if (state.solenoids.get(id) !== target) {
      state.solenoids.set(id, target);
      if (target === 'ON') events.push({ kind: 'solenoid-on', id });
    }
  }
}

/**
 * Choose and apply AT MOST ONE cylinder motion commanded by the current
 * solenoid states. Prefers the cylinder driven by the highest-index energized
 * step relay (the most-recently activated line), which keeps ordering
 * deterministic for sequences that reuse a cylinder. Returns true if a
 * cylinder moved.
 */
function applyOnePhysicalEvent(
  model: CircuitLogicalModel,
  state: SimState,
  events: SimEvent[],
): boolean {
  // Determine the active step: the highest-index relay currently ON.
  let activeStep: PlanStep | undefined;
  for (const step of model.steps) {
    if (relayOn(state, step.relayId)) activeStep = step;
  }
  if (activeStep === undefined) return false;

  // Move each cylinder commanded by the active step (simultaneous group).
  let moved = false;
  for (const mv of activeStep.movements) {
    const valve = model.pneumatic.valves.find((v) => v.actuator === mv.actuator);
    if (valve === undefined) continue;
    const advanceOn = state.solenoids.get(valve.advanceSolenoidId) === 'ON';
    const retractOn = state.solenoids.get(valve.retractSolenoidId) === 'ON';
    if (mv.direction === '+' && advanceOn && !retractOn) {
      if (state.cylinders.get(mv.actuator) !== 'EXTENDED') {
        switchAndMove(state, events, valve.id, mv.actuator, '+');
        moved = true;
      }
    } else if (mv.direction === '-' && retractOn && !advanceOn) {
      if (state.cylinders.get(mv.actuator) !== 'RETRACTED') {
        switchAndMove(state, events, valve.id, mv.actuator, '-');
        moved = true;
      }
    }
  }
  return moved;
}

function switchAndMove(
  state: SimState,
  events: SimEvent[],
  valveId: string,
  actuator: string,
  direction: '+' | '-',
): void {
  const targetValve = direction === '+' ? 'STATE_2' : 'STATE_1';
  if (state.valves.get(valveId) !== targetValve) {
    state.valves.set(valveId, targetValve);
    events.push({ kind: 'valve-switch', id: valveId, detail: direction });
  }
  events.push({
    kind: 'cylinder-move',
    id: actuator,
    detail: direction === '+' ? 'MOVING_FORWARD' : 'MOVING_BACKWARD',
  });
  const homeSensor = retractedSensorId(actuator);
  const advSensor = advancedSensorId(actuator);
  if (direction === '+') {
    state.cylinders.set(actuator, 'EXTENDED');
    state.sensors.set(homeSensor, 'INACTIVE'); // the transient the seal survives
    state.sensors.set(advSensor, 'ACTIVE');
    events.push({ kind: 'cylinder-arrive', id: actuator, detail: 'EXTENDED' });
    events.push({ kind: 'sensor-active', id: advSensor });
  } else {
    state.cylinders.set(actuator, 'RETRACTED');
    state.sensors.set(advSensor, 'INACTIVE');
    state.sensors.set(homeSensor, 'ACTIVE');
    events.push({ kind: 'cylinder-arrive', id: actuator, detail: 'RETRACTED' });
    events.push({ kind: 'sensor-active', id: homeSensor });
  }
}

/**
 * Run one full cycle deterministically. Press START (momentary by default,
 * released after the first settle so the seal must hold K1), then alternate
 * ladder settling and single physical events until the last step completes or
 * the system settles with no further motion.
 */
export function runCycle(
  model: CircuitLogicalModel,
  options: { pulseStart?: boolean } = {},
): SimResult {
  const state = initialSimState(model);
  const events: SimEvent[] = [];
  const pulseStart = options.pulseStart ?? true;
  const lastStep = model.steps[model.steps.length - 1] as PlanStep | undefined;

  state.startPressed = true;
  events.push({ kind: 'start', id: model.startButtonId });
  settleLadder(model, state, events);

  if (pulseStart) {
    state.startPressed = false;
    settleLadder(model, state, events); // seal must hold K1 here
  }

  let completed = false;
  let rounds = 0;
  const maxRounds = model.steps.length * 4 + 8;
  while (rounds < maxRounds) {
    rounds++;
    const moved = applyOnePhysicalEvent(model, state, events);
    settleLadder(model, state, events);

    if (
      lastStep !== undefined &&
      relayOn(state, lastStep.relayId) &&
      lastStep.movements.every((mv) => sensorActive(state, mv.arrivalSensorId))
    ) {
      if (!completed) {
        completed = true;
        events.push({ kind: 'cycle-complete', id: model.sequence });
      }
      if (!moved) break;
    }

    if (!moved) break;
  }

  return { state, events, completed };
}
