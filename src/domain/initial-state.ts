/**
 * Helpers for constructing the explicit {@link InitialState}.
 *
 * PMR3407 worked examples default every cylinder to retracted (A0/B0/C0), but
 * this module keeps the default explicit and overridable so no downstream
 * layer assumes it. See docs/PMR3407_RULES.md, "Initial state".
 */

import type { ActuatorId, InitialState, RestState } from './sequence.ts';

/**
 * Build the default initial state for a set of actuators: every actuator
 * retracted.
 */
export function defaultInitialState(actuators: readonly ActuatorId[]): InitialState {
  const positions: Record<ActuatorId, RestState> = {};
  for (const actuator of actuators) {
    positions[actuator] = 'retracted';
  }
  return { positions };
}

/**
 * Build an initial state from an explicit map, defaulting any actuator not
 * listed in `overrides` to retracted. Unknown actuators in `overrides` are
 * kept (the caller may pre-declare actuators).
 */
export function initialStateFrom(
  actuators: readonly ActuatorId[],
  overrides: Readonly<Record<ActuatorId, RestState>>,
): InitialState {
  const positions: Record<ActuatorId, RestState> = {};
  for (const actuator of actuators) {
    positions[actuator] = overrides[actuator] ?? 'retracted';
  }
  for (const actuator of Object.keys(overrides)) {
    if (!(actuator in positions)) {
      positions[actuator] = overrides[actuator] as RestState;
    }
  }
  return { positions };
}

/** Read the resting position of an actuator, defaulting to retracted. */
export function restStateOf(state: InitialState, actuator: ActuatorId): RestState {
  return state.positions[actuator] ?? 'retracted';
}
