/**
 * Deterministic, STATE-DRIVEN pneumatic cascade simulator (PMR3407 §7).
 *
 * Unlike a replay of the group list, this simulator never walks
 * `model.groups` in order. Each settle round it derives every pneumatic
 * signal from the current physical state, exactly as the projected circuit
 * wires them:
 *
 *  1. the LIVE line is computed from the memory states (no memory SET -> L1,
 *     memory k SET -> L(k+1)); two stable live lines is an exclusivity fault;
 *  2. a memory SET pilot (14) is pressurized only while its own line is live
 *     AND every activation sensor is active (series AND); its RESET pilot (12)
 *     is the next memory's output, or — for the last memory — the wrap
 *     sensor(s) gated by the last line (MÉDIO-2). Memories settle to a fixed
 *     point before main valves are evaluated (no transient line leakage);
 *  3. a main-valve pilot is pressurized only while the movement's group line
 *     is live AND all of its intra-group gate sensors are active (AND, the
 *     first step of the cycle also needs START). Both pilots of one valve
 *     pressurized at once is a SIGNAL-OVERLAP fault;
 *  4. at most ONE cylinder moves per physical event (FIFO in the order its
 *     valve switched); then everything re-settles.
 *
 * The run stops when the circuit is quiescent (no valve wants to move a
 * cylinder). `completed` is DERIVED: no faults, the executed movements equal
 * the target physical order, and the last line was reached. `restored`
 * proves the memory chain returned to rest (all RESET, L1 live) so another
 * cycle can start; `cycles > 1` actually runs the following cycles.
 *
 * Before simulating, a preflight checks the model against the projected
 * {@link Circuit} (every referenced valve/sensor exists, every memory pilot
 * and main-valve pilot is wired), so a corrupted model cannot "pass".
 */

import type { CylinderState } from '../domain/index.ts';
import type { Circuit } from '../domain/index.ts';
import type { CascadeLogicalModel, CascadeMovement } from '../engine/cascade/model.ts';
import { toCascadeCircuit } from '../engine/cascade/circuit.ts';
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

/** Closed set of simulator fault codes. */
export type CascadeSimFaultCode =
  | 'UNKNOWN_VALVE'
  | 'UNKNOWN_SENSOR'
  | 'INCONSISTENT_MODEL'
  | 'WIRING_MISSING'
  | 'PILOT_CONFLICT'
  | 'MEMORY_CONFLICT'
  | 'LINE_EXCLUSIVITY'
  | 'NO_LIVE_LINE'
  | 'DEADLOCK'
  | 'SEQUENCE_MISMATCH'
  | 'LAST_LINE_NOT_REACHED'
  | 'NOT_AT_REST'
  | 'EVENT_LIMIT';

export interface CascadeSimFault {
  readonly code: CascadeSimFaultCode;
  readonly message: string;
  readonly subject?: string;
  /** 1-based cycle in which the fault occurred (0 = preflight). */
  readonly cycle: number;
}

export interface CascadeSimResult {
  readonly state: CascadeSimState;
  readonly events: readonly SimEvent[];
  /** Derived: no faults, full target sequence executed in order, last line reached (every cycle). */
  readonly completed: boolean;
  /** Every cylinder is back at its initial position. */
  readonly balanced: boolean;
  /** Memory chain at rest (all RESET) and line 1 live — ready for another cycle. */
  readonly restored: boolean;
  /** Movements physically executed, all cycles concatenated. */
  readonly executedMovements: readonly string[];
  /** Target physical order for ONE cycle. */
  readonly expectedMovements: readonly string[];
  /** Lines that were live at some stable point, in first-visit order. */
  readonly visitedLines: readonly string[];
  /** Number of cycles that completed successfully. */
  readonly cyclesCompleted: number;
  readonly faults: readonly CascadeSimFault[];
}

export interface CascadeSimOptions {
  /** Release START after the first settle (single press). Default true. */
  readonly pulseStart?: boolean;
  /** Hard cap on cylinder movements over the whole run. */
  readonly maxPhysicalEvents?: number;
  /** Number of consecutive cycles to run (a new START press each). Default 1. */
  readonly cycles?: number;
}

/** Build the initial cascade simulation state respecting explicit or inferred initial positions. */
export function initialCascadeSimState(model: CascadeLogicalModel): CascadeSimState {
  const cylinders = new Map<string, CylinderState>();
  const sensors = new Map<string, 'ACTIVE' | 'INACTIVE'>();
  const mainValves = new Map<string, 'STATE_1' | 'STATE_2'>();
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
  for (const mem of model.memories) memoryValves.set(mem.valveId, 'RESET');

  return {
    cylinders,
    sensors,
    mainValves,
    memoryValves,
    activeLineId: model.groups[0]?.lineId ?? 'L1',
    startPressed: false,
  };
}

/** Target physical order of one cycle (group 1 head, groups 2..n, group 1 merged tail). */
function expectedOrder(model: CascadeLogicalModel): string[] {
  const groups = model.groups;
  if (groups.length === 0) return [];
  const tail = model.division?.groups[0]?.mergedTailCount ?? 0;
  const g1 = groups[0]!.movements;
  const head = g1.slice(0, g1.length - tail);
  const tailMv = g1.slice(g1.length - tail);
  const middle = groups.slice(1).flatMap((g) => g.movements);
  // Only PHYSICAL movements: a repeated same-direction command (e.g. the 2nd
  // B+ of A+B+B+...) finds the cylinder already there and moves nothing.
  const pos = new Map<string, string>();
  for (const a of model.actuators) pos.set(a, model.initialState?.positions[a] === 'extended' ? '+' : '-');
  const out: string[] = [];
  for (const m of [...head, ...middle, ...tailMv]) {
    if (pos.get(m.actuator) === m.direction) continue;
    pos.set(m.actuator, m.direction);
    out.push(`${m.actuator}${m.direction}`);
  }
  return out;
}

/** Gate sensors of a movement (AND of startSensorIds and startSensorId). */
function gateOf(mv: CascadeMovement): readonly string[] {
  const all = new Set<string>(mv.startSensorIds ?? []);
  if (mv.startSensorId !== undefined) all.add(mv.startSensorId);
  return [...all];
}

/** Condition sensors for memory k's SET pilot (0-based idx). */
function setConditions(model: CascadeLogicalModel, idx: number): string[] {
  const mem = model.memories[idx]!;
  const tr = model.transitions.find((t) => t.memoryId === mem.id);
  const all = new Set<string>([mem.setSensorId, ...(tr?.conditionSensorIds ?? [])]);
  return [...all];
}

/** Condition sensors for the LAST memory's RESET pilot (the wrap). */
function wrapConditions(model: CascadeLogicalModel): string[] {
  const last = model.memories[model.memories.length - 1];
  if (!last) return [];
  const all = new Set<string>(model.returnTransition?.conditionSensorIds ?? []);
  if (last.resetSensorId !== undefined) all.add(last.resetSensorId);
  return [...all];
}

/** Static checks of the model against itself and its projected circuit. */
function preflight(model: CascadeLogicalModel): CascadeSimFault[] {
  const faults: CascadeSimFault[] = [];
  const add = (code: CascadeSimFaultCode, message: string, subject?: string): void => {
    faults.push({ code, message, cycle: 0, ...(subject !== undefined ? { subject } : {}) });
  };

  const realSensors = new Set<string>();
  for (const a of model.actuators) {
    realSensors.add(retractedSensorId(a));
    realSensors.add(advancedSensorId(a));
  }
  const valveActuator = new Map(model.pneumatic.valves.map((v) => [v.id, v.actuator]));
  const checkSensor = (id: string, where: string): void => {
    if (!realSensors.has(id)) add('UNKNOWN_SENSOR', `${where} references sensor "${id}", which is not a stroke-end sensor of any cylinder.`, id);
  };

  for (const g of model.groups) {
    for (const mv of g.movements) {
      const act = valveActuator.get(mv.mainValveId);
      if (act === undefined) add('UNKNOWN_VALVE', `Movement ${mv.actuator}${mv.direction} drives nonexistent main valve "${mv.mainValveId}".`, mv.mainValveId);
      else if (act !== mv.actuator) add('INCONSISTENT_MODEL', `Movement ${mv.actuator}${mv.direction} drives valve "${mv.mainValveId}" of cylinder ${act}.`, mv.mainValveId);
      for (const s of gateOf(mv)) checkSensor(s, `Gate of ${mv.actuator}${mv.direction} in ${g.lineId}`);
      checkSensor(mv.arrivalSensorId, `Arrival of ${mv.actuator}${mv.direction}`);
    }
  }
  model.memories.forEach((mem, idx) => {
    for (const s of setConditions(model, idx)) checkSensor(s, `SET pilot of ${mem.id}`);
    if (mem.resetSensorId !== undefined) checkSensor(mem.resetSensorId, `RESET pilot of ${mem.id}`);
    const target = model.groups[idx + 1];
    if (target?.activationSensorId !== undefined && !setConditions(model, idx).includes(target.activationSensorId)) {
      add('INCONSISTENT_MODEL', `Group ${target.number} is activated by "${target.activationSensorId}" but ${mem.id} is piloted by ${setConditions(model, idx).join('+')}.`, mem.id);
    }
  });

  // Projected circuit wiring: every endpoint exists; every pilot is fed.
  let circuit: Circuit | undefined;
  try {
    circuit = toCascadeCircuit(model);
  } catch (e) {
    add('WIRING_MISSING', `Projection failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (circuit) {
    const ids = new Set(circuit.components.map((c) => c.id));
    const fed = new Set(circuit.connections.map((c) => `${c.targetComponent}:${c.targetPort}`));
    for (const c of circuit.connections) {
      for (const end of [c.sourceComponent, c.targetComponent]) {
        if (!ids.has(end)) add('WIRING_MISSING', `Projected connection references missing component "${end}".`, end);
      }
    }
    for (const mem of model.memories) {
      for (const port of ['14', '12']) {
        if (!fed.has(`${mem.valveId}:${port}`)) add('WIRING_MISSING', `Memory ${mem.id} pilot ${port} is not wired.`, mem.valveId);
      }
    }
    for (const g of model.groups) {
      for (const mv of g.movements) {
        if (!fed.has(`${mv.mainValveId}:${mv.pilotPort}`)) add('WIRING_MISSING', `Pilot ${mv.pilotPort} of ${mv.mainValveId} is not wired.`, mv.mainValveId);
      }
    }
  }
  // Deduplicate identical messages.
  const seen = new Set<string>();
  return faults.filter((f) => (seen.has(f.message) ? false : (seen.add(f.message), true)));
}

/**
 * Run one or more full pneumatic cascade cycles, deriving every signal from
 * the current circuit state.
 */
export function runCascadeCycle(
  model: CascadeLogicalModel,
  options: CascadeSimOptions = {},
): CascadeSimResult {
  const state = initialCascadeSimState(model);
  const events: SimEvent[] = [];
  const executedMovements: string[] = [];
  const expected = expectedOrder(model);
  const cycles = Math.max(1, options.cycles ?? 1);
  const maxEvents = options.maxPhysicalEvents ?? (expected.length + 2) * cycles * 4 + 8;
  const pulseStart = options.pulseStart ?? true;
  const faults: CascadeSimFault[] = preflight(model);
  const visitedLines: string[] = [];
  const cycleLines = new Set<string>();
  let physicalCount = 0;
  let cyclesCompleted = 0;
  let currentCycle = 0;

  const addFault = (code: CascadeSimFaultCode, message: string, subject?: string): void => {
    if (faults.some((f) => f.code === code && f.message === message && f.cycle === currentCycle)) return;
    faults.push({ code, message, cycle: currentCycle, ...(subject !== undefined ? { subject } : {}) });
  };

  const active = (id: string): boolean => state.sensors.get(id) === 'ACTIVE';
  const allActive = (ids: readonly string[]): boolean => ids.every(active);

  /** Live lines derived from memory states. */
  const liveLines = (): string[] => {
    const set = model.memories.filter((m) => state.memoryValves.get(m.valveId) === 'SET');
    if (set.length === 0) return model.groups.length > 0 ? [model.groups[0]!.lineId] : [];
    return set.map((m) => m.activatesLineId);
  };

  /** Settle memory valves to a fixed point. */
  const settleMemories = (): void => {
    for (let iter = 0; iter <= model.memories.length + 1; iter++) {
      const live = new Set(liveLines());
      const updates: Array<[string, 'SET' | 'RESET']> = [];
      model.memories.forEach((mem, idx) => {
        const setPilot = live.has(mem.deactivatesLineId) && allActive(setConditions(model, idx));
        const next = model.memories[idx + 1];
        const resetPilot = next
          ? state.memoryValves.get(next.valveId) === 'SET'
          : live.has(mem.activatesLineId) && wrapConditions(model).length > 0 && allActive(wrapConditions(model));
        if (setPilot && resetPilot) {
          addFault('MEMORY_CONFLICT', `Both pilots of memory ${mem.id} are pressurized.`, mem.id);
          return;
        }
        const cur = state.memoryValves.get(mem.valveId);
        if (setPilot && cur !== 'SET') updates.push([mem.valveId, 'SET']);
        if (resetPilot && cur !== 'RESET') updates.push([mem.valveId, 'RESET']);
      });
      if (updates.length === 0) return;
      for (const [id, v] of updates) {
        state.memoryValves.set(id, v);
        events.push({ kind: 'valve-switch', id, detail: v });
      }
    }
  };

  /** Order in which valves switched but their cylinder has not yet moved. */
  const pendingMotion: string[] = [];

  /** Evaluate main-valve pilots from the current state and switch valves. */
  const settleMainValves = (): void => {
    const live = new Set(liveLines());
    const pressured = new Map<string, Set<'12' | '14'>>();
    for (const g of model.groups) {
      if (!live.has(g.lineId)) continue;
      for (const mv of g.movements) {
        if (mv.gatedByStart && !state.startPressed) continue;
        if (!allActive(gateOf(mv))) continue;
        const set = pressured.get(mv.mainValveId) ?? new Set<'12' | '14'>();
        set.add(mv.pilotPort);
        pressured.set(mv.mainValveId, set);
      }
    }
    for (const [valveId, ports] of pressured) {
      if (!state.mainValves.has(valveId)) continue; // reported by preflight
      if (ports.size > 1) {
        addFault('PILOT_CONFLICT', `Signal overlap: both pilots of ${valveId} are pressurized.`, valveId);
        continue;
      }
      const target = ports.has('14') ? 'STATE_2' : 'STATE_1';
      if (state.mainValves.get(valveId) !== target) {
        state.mainValves.set(valveId, target);
        events.push({ kind: 'valve-switch', id: valveId, detail: target === 'STATE_2' ? '+' : '-' });
        const idx = pendingMotion.indexOf(valveId);
        if (idx >= 0) pendingMotion.splice(idx, 1);
        pendingMotion.push(valveId);
      }
    }
  };

  const settle = (): void => {
    settleMemories();
    settleMainValves();
    const live = liveLines();
    if (live.length > 1) addFault('LINE_EXCLUSIVITY', `Lines ${live.join(', ')} are live at the same time.`);
    if (live.length === 0 && model.groups.length > 0) addFault('NO_LIVE_LINE', 'No pressure line is live.');
    if (live.length === 1) {
      state.activeLineId = live[0]!;
      if (!visitedLines.includes(live[0]!)) visitedLines.push(live[0]!);
      cycleLines.add(live[0]!);
    }
  };

  /** Move ONE cylinder whose valve disagrees with its position. */
  const moveOne = (): boolean => {
    for (const valve of model.pneumatic.valves) {
      if (!pendingMotion.includes(valve.id) && wantsMove(valve.id, valve.actuator)) pendingMotion.push(valve.id);
    }
    while (pendingMotion.length > 0) {
      const valveId = pendingMotion.shift()!;
      const valve = model.pneumatic.valves.find((v) => v.id === valveId);
      if (!valve || !wantsMove(valveId, valve.actuator)) continue;
      const extend = state.mainValves.get(valveId) === 'STATE_2';
      const act = valve.actuator;
      events.push({ kind: 'cylinder-move', id: act, detail: extend ? 'MOVING_FORWARD' : 'MOVING_BACKWARD' });
      state.cylinders.set(act, extend ? 'EXTENDED' : 'RETRACTED');
      const arrival = extend ? advancedSensorId(act) : retractedSensorId(act);
      state.sensors.set(extend ? retractedSensorId(act) : advancedSensorId(act), 'INACTIVE');
      state.sensors.set(arrival, 'ACTIVE');
      events.push({ kind: 'cylinder-arrive', id: act, detail: extend ? 'EXTENDED' : 'RETRACTED' });
      events.push({ kind: 'sensor-active', id: arrival });
      executedMovements.push(`${act}${extend ? '+' : '-'}`);
      physicalCount++;
      return true;
    }
    return false;
  };

  const wantsMove = (valveId: string, actuator: string): boolean => {
    const want = state.mainValves.get(valveId) === 'STATE_2' ? 'EXTENDED' : 'RETRACTED';
    return state.cylinders.get(actuator) !== want;
  };

  const lastLine = model.groups[model.groups.length - 1]?.lineId;

  for (let c = 1; c <= cycles; c++) {
    currentCycle = c;
    const faultsBefore = faults.length;
    const startIdx = executedMovements.length;
    cycleLines.clear();
    state.startPressed = true;
    events.push({ kind: 'start', id: model.startButtonId });

    let first = true;
    let limitHit = false;
    for (;;) {
      settle();
      if (first && pulseStart) state.startPressed = false;
      first = false;
      if (physicalCount >= maxEvents) {
        limitHit = true;
        addFault('EVENT_LIMIT', `Exceeded ${maxEvents} physical events (the circuit does not come to rest).`);
        break;
      }
      if (!moveOne()) break;
    }
    state.startPressed = false;

    const executed = executedMovements.slice(startIdx);
    const matches = executed.length === expected.length && executed.every((m, i) => m === expected[i]);
    if (!matches && !limitHit) {
      if (executed.length < expected.length && executed.every((m, i) => m === expected[i])) {
        addFault('DEADLOCK', `Cycle stalled after ${executed.length}/${expected.length} movements; "${expected[executed.length]}" was never commanded.`, expected[executed.length]);
      } else {
        addFault('SEQUENCE_MISMATCH', `Executed [${executed.join(' ')}] but expected [${expected.join(' ')}].`);
      }
    }
    if (lastLine !== undefined && !cycleLines.has(lastLine)) {
      addFault('LAST_LINE_NOT_REACHED', `The last line ${lastLine} was never pressurized.`, lastLine);
    }
    const restoredNow = isRestored();
    if (!restoredNow) addFault('NOT_AT_REST', 'Memory chain did not return to rest (line 1) at the end of the cycle.');

    const cycleOk = faults.length === faultsBefore && faults.every((f) => f.cycle !== 0) && matches;
    if (!cycleOk) break;
    cyclesCompleted++;
    events.push({ kind: 'cycle-complete', id: model.sequence });
  }

  function isRestored(): boolean {
    const allReset = [...state.memoryValves.values()].every((v) => v === 'RESET');
    const live = liveLines();
    return allReset && live.length <= 1 && (live[0] ?? model.groups[0]?.lineId) === model.groups[0]?.lineId;
  }

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
    completed: faults.length === 0 && cyclesCompleted === cycles,
    balanced,
    restored: isRestored(),
    executedMovements,
    expectedMovements: expected,
    visitedLines,
    cyclesCompleted,
    faults,
  };
}
