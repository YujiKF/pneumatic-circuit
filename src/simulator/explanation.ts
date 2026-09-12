/**
 * Automatic textual explanation, DERIVED from the simulator trace.
 *
 * There is no second, parallel logic: the explanation walks the exact
 * {@link SimEvent} sequence produced by the simulator over the SAME
 * {@link CircuitLogicalModel}. This guarantees the narrative matches the
 * generated circuit (user requirement: "derived from the SAME model").
 *
 * Style mirrors the course example:
 *   1. START is pressed.
 *   2. K1 is energized.
 *   3. K1 energizes 1Y1.
 *   4. The valve of cylinder A switches.
 *   5. A advances.
 *   6. 1S2 becomes active.
 *   7. 1S2 enables the next step.
 */

import type { CircuitLogicalModel } from '../engine/model.ts';
import { runCycle } from './simulator.ts';
import type { SimEvent } from './simulator.ts';

/** Map an actuator letter to its human label ("cylinder A"). */
function cylinderLabel(actuator: string): string {
  return `cylinder ${actuator}`;
}

/**
 * Generate the chronological explanation lines from a fresh simulation of the
 * model. `numbered` prefixes "N. " to each line (default true).
 */
export function explain(
  model: CircuitLogicalModel,
  options: { numbered?: boolean } = {},
): string[] {
  const numbered = options.numbered ?? true;
  const { events } = runCycle(model, { pulseStart: true });
  const lines: string[] = [];

  // Track which relay is "current" so we can attribute solenoid energization.
  let currentRelay: string | undefined;

  for (const ev of events) {
    const line = describe(ev, model, () => currentRelay);
    if (ev.kind === 'relay-on') currentRelay = ev.id;
    if (line !== undefined) lines.push(line);
  }

  if (!numbered) return lines;
  return lines.map((l, i) => `${i + 1}. ${l}`);
}

function describe(
  ev: SimEvent,
  model: CircuitLogicalModel,
  currentRelay: () => string | undefined,
): string | undefined {
  switch (ev.kind) {
    case 'start':
      return `${ev.id} (START) is pressed.`;
    case 'relay-on':
      return `${ev.id} is energized.`;
    case 'relay-off':
      return `${ev.id} is de-energized.`;
    case 'solenoid-on': {
      const relay = currentRelay();
      const actuator = actuatorOfSolenoid(model, ev.id);
      const dir = ev.id.endsWith('1') ? 'advance' : 'retract';
      const owner = relay ? `${relay} energizes ${ev.id}` : `${ev.id} is energized`;
      return `${owner} (${dir} solenoid of ${cylinderLabel(actuator)}).`;
    }
    case 'valve-switch': {
      const actuator = actuatorOfValve(model, ev.id);
      return `The valve of ${cylinderLabel(actuator)} switches.`;
    }
    case 'cylinder-move': {
      const verb = ev.detail === 'MOVING_FORWARD' ? 'advances' : 'retracts';
      return `${cylinderLabel(ev.id)} ${verb} (${ev.id}).`;
    }
    case 'cylinder-arrive':
      return undefined; // covered by sensor-active for narrative brevity
    case 'sensor-active':
      return `${ev.id} becomes active.`;
    case 'enable-next':
      return ev.detail !== undefined
        ? `${ev.id} enables the next step (${ev.detail}).`
        : `${ev.id} enables the next step.`;
    case 'cycle-complete':
      return `The cycle for ${ev.id} is complete.`;
    default:
      return undefined;
  }
}

function actuatorOfSolenoid(model: CircuitLogicalModel, solenoidId: string): string {
  for (const valve of model.pneumatic.valves) {
    if (valve.advanceSolenoidId === solenoidId || valve.retractSolenoidId === solenoidId) {
      return valve.actuator;
    }
  }
  return '?';
}

function actuatorOfValve(model: CircuitLogicalModel, valveId: string): string {
  for (const valve of model.pneumatic.valves) {
    if (valve.id === valveId) return valve.actuator;
  }
  return '?';
}
