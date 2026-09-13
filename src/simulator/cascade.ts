/**
 * Deterministic pure pneumatic cascade simulator (PMR3407 §7).
 *
 * Simulates physical cycle execution of a {@link CascadeLogicalModel}:
 *  - tracks cylinder states (RETRACTED / EXTENDED),
 *  - end-of-course sensors (ACTIVE / INACTIVE),
 *  - main command valves (STATE_1 / STATE_2),
 *  - cascade memory valves (RESET / SET),
 *  - group pressure lines (L1..Ln).
 *
 * Alternates line activation, intra-group sensor gating, cylinder motion,
 * and memory handoff to prove behavioral reproduction of the sequence and
 * return to initial rest state.
 */

import type { CylinderState } from '../domain/index.ts';
import type { CascadeLogicalModel, CascadeMovement } from '../engine/cascade/model.ts';
import { retractedSensorId, advancedSensorId } from '../engine/naming.ts';
import type { SimEvent } from './simulator.ts';

export interface CascadeSimState {
  readonly cylinders: Map<string, CylinderState>;
  readonly sensors: Map<string, 'ACTIVE' | 'INACTIVE'>;
  readonly mainValves: Map<string, 'STATE_1' | 'STATE_2'>;
  readonly memoryValves: Map<string, 'RESET' | 'SET'>;
  activeLineId: string;
  startPressed: boolean;
}

export interface CascadeSimResult {
  readonly state: CascadeSimState;
  readonly events: readonly SimEvent[];
  readonly completed: boolean;
  readonly balanced: boolean;
  readonly executedMovements: readonly string[];
}

export interface CascadeSimOptions {
  readonly pulseStart?: boolean;
  readonly maxPhysicalEvents?: number;
}

/** Build the initial cascade simulation state respecting explicit or inferred initial positions. */
export function initialCascadeSimState(model: CascadeLogicalModel): CascadeSimState {
  const cylinders = new Map<string, CylinderState>();
  const sensors = new Map<string, 'ACTIVE' | 'INACTIVE'>();
  const mainValves = new Map<string, 'STATE_1' | 'STATE_2'>;
  const memoryValves = new Map<string, 'RESET' | 'SET'>();

  for (const actuator of model.actuators) {
    const isExtended = model.initialState?.positions[actuator] === 'extended';
    cylinders.set(actuator, isExtended ? 'EXTENDED' : 'RETRACTED');
    sensors.set(retractedSensorId(actuator), isExtended ? 'INACTIVE' : 'ACTIVE');
    sensors.set(advancedSensorId(actuator), isExtended ? 'ACTIVE' : 'INACTIVE');
  }

  for (const valve of model.pneumatic.valves) {
    const isExtended = model.initialState?.positions[valve.actuator] === 'extended';
    mainValves.set(valve.id, isExtended ? 'STATE_2' : 'STATE_1');
  }

  for (const mem of model.memories) {
    memoryValves.set(mem.valveId, 'RESET');
  }

  return {
    cylinders,
    sensors,
    mainValves,
    memoryValves,
    activeLineId: model.groups[0]?.lineId ?? 'L1',
    startPressed: false,
  };
}

/**
 * Execute one full pneumatic cascade cycle deterministically.
 */
export function runCascadeCycle(
  model: CascadeLogicalModel,
  options: CascadeSimOptions = {},
): CascadeSimResult {
  const state = initialCascadeSimState(model);
  const events: SimEvent[] = [];
  const executedMovements: string[] = [];
  const maxEvents = options.maxPhysicalEvents ?? Number.POSITIVE_INFINITY;

  state.startPressed = true;
  events.push({ kind: 'start', id: model.startButtonId });

  if (options.pulseStart ?? true) {
    state.startPressed = false;
  }

  const groups = model.groups;
  if (groups.length === 0) {
    return { state, events, completed: true, balanced: true, executedMovements };
  }

  const tail = model.division?.groups[0]?.mergedTailCount ?? 0;
  let physicalCount = 0;

  function executeMovement(mv: CascadeMovement): boolean {
    if (physicalCount >= maxEvents) return false;

    // Verify intra-group gating sensor if present
    if (mv.startSensorId !== undefined && state.sensors.get(mv.startSensorId) !== 'ACTIVE') {
      // Sensor not active yet: cannot fire
      return false;
    }

    const targetValveState = mv.direction === '+' ? 'STATE_2' : 'STATE_1';
    if (state.mainValves.get(mv.mainValveId) !== targetValveState) {
      state.mainValves.set(mv.mainValveId, targetValveState);
      events.push({ kind: 'valve-switch', id: mv.mainValveId, detail: mv.direction });
    }

    events.push({
      kind: 'cylinder-move',
      id: mv.actuator,
      detail: mv.direction === '+' ? 'MOVING_FORWARD' : 'MOVING_BACKWARD',
    });

    const homeSensor = retractedSensorId(mv.actuator);
    const advSensor = advancedSensorId(mv.actuator);
    const arrival = mv.arrivalSensorId;
    const departure = mv.direction === '+' ? homeSensor : advSensor;

    state.cylinders.set(mv.actuator, mv.direction === '+' ? 'EXTENDED' : 'RETRACTED');
    state.sensors.set(departure, 'INACTIVE');
    state.sensors.set(arrival, 'ACTIVE');

    events.push({
      kind: 'cylinder-arrive',
      id: mv.actuator,
      detail: mv.direction === '+' ? 'EXTENDED' : 'RETRACTED',
    });
    events.push({ kind: 'sensor-active', id: arrival });
    executedMovements.push(`${mv.actuator}${mv.direction}`);
    physicalCount++;
    return true;
  }

  // Phase 1: Group 1 (non-merged movements)
  const g1 = groups[0]!;
  state.activeLineId = g1.lineId;
  const g1Movements = tail > 0 ? g1.movements.slice(0, g1.movements.length - tail) : g1.movements;
  for (const mv of g1Movements) {
    executeMovement(mv);
  }

  // Phase 2: Groups 2 through N
  for (let g = 1; g < groups.length; g++) {
    const group = groups[g]!;
    // Memory transition: memory (g-1) sets, handing control to line (g+1)
    const mem = model.memories[g - 1];
    if (mem) {
      state.memoryValves.set(mem.valveId, 'SET');
      events.push({ kind: 'valve-switch', id: mem.valveId, detail: 'SET' });
    }
    // Previous memory resets
    if (g > 1) {
      const prevMem = model.memories[g - 2];
      if (prevMem) {
        state.memoryValves.set(prevMem.valveId, 'RESET');
        events.push({ kind: 'valve-switch', id: prevMem.valveId, detail: 'RESET' });
      }
    }

    state.activeLineId = group.lineId;
    for (const mv of group.movements) {
      executeMovement(mv);
    }
  }

  // Phase 3: Merged tail movements in Group 1 (when control wraps back to Line 1)
  if (tail > 0) {
    // All memories reset on return to Line 1
    for (const mem of model.memories) {
      state.memoryValves.set(mem.valveId, 'RESET');
    }
    state.activeLineId = g1.lineId;
    const g1TailMovements = g1.movements.slice(g1.movements.length - tail);
    for (const mv of g1TailMovements) {
      executeMovement(mv);
    }
  } else {
    // Return all memories to rest at cycle complete
    for (const mem of model.memories) {
      state.memoryValves.set(mem.valveId, 'RESET');
    }
    state.activeLineId = g1.lineId;
  }

  const completed = true;
  events.push({ kind: 'cycle-complete', id: model.sequence });

  // Verify balanced cycle (all cylinders back at initial position)
  let balanced = true;
  for (const act of model.actuators) {
    const initialPos = model.initialState?.positions[act] === 'extended' ? 'EXTENDED' : 'RETRACTED';
    if (state.cylinders.get(act) !== initialPos) {
      balanced = false;
      break;
    }
  }

  return {
    state,
    events,
    completed,
    balanced,
    executedMovements,
  };
}
