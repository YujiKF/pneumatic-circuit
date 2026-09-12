/**
 * Simulator state model.
 *
 * Runtime states (RULES / user spec, string-literal unions, strip-only safe):
 *   Cylinder: RETRACTED / MOVING_FORWARD / EXTENDED / MOVING_BACKWARD
 *   Relay:    ON / OFF
 *   Sensor:   ACTIVE / INACTIVE
 *   Valve:    STATE_1 / STATE_2   (STATE_1 = retract pilot, STATE_2 = advance)
 *
 * The simulator is DETERMINISTIC and event-stepped: it evaluates the ladder to
 * a fixed point, then advances physical motion by discrete events (a moving
 * cylinder reaches its end and trips the arrival sensor). The same trace feeds
 * the explanation generator, so there is a single source of logic.
 */

import type {
  CylinderState,
  RelayState,
  SensorState,
  ValveState,
} from '../domain/index.ts';

/** Mutable simulation state keyed by component id. */
export interface SimState {
  /** Relay id -> ON/OFF (also holds solenoid coil states). */
  readonly relays: Map<string, RelayState>;
  /** Solenoid id -> ON/OFF. */
  readonly solenoids: Map<string, RelayState>;
  /** Sensor id -> ACTIVE/INACTIVE. */
  readonly sensors: Map<string, SensorState>;
  /** Cylinder actuator letter -> motion state. */
  readonly cylinders: Map<string, CylinderState>;
  /** Valve id -> STATE_1/STATE_2. */
  readonly valves: Map<string, ValveState>;
  /** Whether the START button is currently pressed. */
  startPressed: boolean;
}

export function relayOn(s: SimState, id: string): boolean {
  return s.relays.get(id) === 'ON';
}

export function sensorActive(s: SimState, id: string): boolean {
  return s.sensors.get(id) === 'ACTIVE';
}

export function solenoidOn(s: SimState, id: string): boolean {
  return s.solenoids.get(id) === 'ON';
}
