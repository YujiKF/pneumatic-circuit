/**
 * Electropneumatic / pneumatic naming helpers.
 *
 * Centralizes the numbering conventions fixed in docs/PMR3407_RULES.md so the
 * solver, validator, simulator and explanation generator all agree on the same
 * identifiers. See RULES.md sections 4 (pneumatic numbering), 4.1 (port
 * labels) and 5 (electropneumatic naming), plus ambiguities A1/A2.
 *
 * Conventions (RULES.md, authoritative):
 *  - Cylinder A -> number 1, B -> 2, C -> 3, ... (actuator letter index + 1).
 *  - Pneumatic cylinder id: "1.0"/"2.0"/...; main valve: "1.1"; limit valves
 *    "N.2" = RETRACTED end, "N.3" = ADVANCED end (A1).
 *  - Electropneumatic sensors: "1S1" = RETRACTED end, "1S2" = ADVANCED end (A2).
 *  - Solenoids on the double-solenoid 5/2 valve: "1Y1" = ADVANCE, "1Y2" =
 *    RETRACT (RULES.md section 5).
 *  - Control relays: "K1".."Kn" (one per step).
 */

import type { ActuatorId, Direction } from '../domain/index.ts';

/** Convert an actuator letter (A,B,C,...) to its 1-based cylinder number. */
export function actuatorNumber(actuator: ActuatorId): number {
  // Actuators are single uppercase letters A..Z (T is reserved and never an
  // actuator). "A" -> 1. This is stable and deterministic.
  const code = actuator.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
  return code;
}

/** Pneumatic cylinder element id, e.g. cylinder A -> "1.0". */
export function cylinderId(actuator: ActuatorId): string {
  return `${actuatorNumber(actuator)}.0`;
}

/** Pneumatic main directional valve id, e.g. cylinder A -> "1.1". */
export function mainValveId(actuator: ActuatorId): string {
  return `${actuatorNumber(actuator)}.1`;
}

/**
 * Electropneumatic sensor id for the end position REACHED by moving in
 * `direction`. Advancing (+) reaches the ADVANCED end (S2); retracting (-)
 * reaches the RETRACTED end (S1). RULES.md A2.
 */
export function sensorIdForArrival(actuator: ActuatorId, direction: Direction): string {
  const n = actuatorNumber(actuator);
  return direction === '+' ? `${n}S2` : `${n}S1`;
}

/** Electropneumatic sensor id for the RETRACTED (home) end, e.g. "1S1". */
export function retractedSensorId(actuator: ActuatorId): string {
  return `${actuatorNumber(actuator)}S1`;
}

/** Electropneumatic sensor id for the ADVANCED end, e.g. "1S2". */
export function advancedSensorId(actuator: ActuatorId): string {
  return `${actuatorNumber(actuator)}S2`;
}

/**
 * Solenoid id that commands `direction` on cylinder `actuator`. Advance (+) =
 * Y1, retract (-) = Y2. RULES.md section 5.
 */
export function solenoidId(actuator: ActuatorId, direction: Direction): string {
  const n = actuatorNumber(actuator);
  return direction === '+' ? `${n}Y1` : `${n}Y2`;
}

/** Control relay id for a 0-based step index, e.g. step 0 -> "K1". */
export function relayId(stepIndex: number): string {
  return `K${stepIndex + 1}`;
}

/** Pneumatic limit-valve id for an arrival end, e.g. advance -> "1.3". */
export function limitValveIdForArrival(actuator: ActuatorId, direction: Direction): string {
  const n = actuatorNumber(actuator);
  return direction === '+' ? `${n}.3` : `${n}.2`;
}
