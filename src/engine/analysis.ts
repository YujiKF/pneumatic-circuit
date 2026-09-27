/**
 * Sequence analysis (RULES §3, REQ-VALID-OVERLAP): direct/indirect
 * classification and signal-overlap detection for the intuitive wiring.
 *
 * Pure functions over the parsed {@link SequenceModel}; no circuit concern.
 */

import type { ActuatorId, SequenceModel } from '../domain/index.ts';
import { sensorIdForArrival } from './naming.ts';

/** RULES §3 classification. */
export type SequenceKind = 'direct' | 'indirect';

/**
 * One signal overlap: the sensor that commands `commanded` is still active
 * when the OPPOSITE movement of the same cylinder (`blocked`) must be commanded,
 * so both pilots of that valve would be pressurized (intuitive wiring).
 */
export interface SignalOverlap {
  /** Sensor that stays active, e.g. "1S2". */
  readonly sensorId: string;
  /** Movement that sensor commands in the intuitive chain, e.g. "B+". */
  readonly commanded: string;
  /** Opposite movement that is blocked while the sensor is active, e.g. "B-". */
  readonly blocked: string;
}

export interface SequenceAnalysis {
  readonly kind: SequenceKind;
  /** Overlaps of the intuitive (sensor -> next pilot) wiring; empty if none. */
  readonly overlaps: readonly SignalOverlap[];
  /** True when the intuitive method is safe (no overlap). */
  readonly intuitiveApplicable: boolean;
}

/**
 * Classify a sequence as direct or indirect (RULES §3): direct when the order
 * in which cylinders act "going out" (first appearance) equals the order in
 * which they act "coming back" (second appearance). A sequence where some
 * cylinder does not move exactly twice is classified by its overlap instead
 * (indirect iff overlapping), which agrees with §3 on every worked example.
 */
export function classifySequence(sequence: SequenceModel): SequenceKind {
  const counts = new Map<ActuatorId, number>();
  const outbound: ActuatorId[] = [];
  const inbound: ActuatorId[] = [];
  for (const step of sequence.steps) {
    for (const mv of step.movements) {
      const n = (counts.get(mv.actuator) ?? 0) + 1;
      counts.set(mv.actuator, n);
      if (n === 1) outbound.push(mv.actuator);
      else if (n === 2) inbound.push(mv.actuator);
    }
  }
  const simple = [...counts.values()].every((n) => n === 2);
  if (!simple) return detectSignalOverlap(sequence).length > 0 ? 'indirect' : 'direct';
  return outbound.every((a, i) => inbound[i] === a) ? 'direct' : 'indirect';
}

/**
 * Detect signal overlap for the intuitive wiring, where movement k is
 * commanded by the arrival sensor of movement k-1 (cyclically; the first
 * movement is commanded by the last one's arrival together with START).
 *
 * Positions are tracked through one cycle from the initial state. For every
 * movement k we check whether its commanding sensor is still active at the
 * instant the next OPPOSITE movement of the same cylinder must be commanded.
 * Movements of one simultaneous step share the same commanding sensor(s).
 */
export function detectSignalOverlap(sequence: SequenceModel): SignalOverlap[] {
  const steps = sequence.steps;
  if (steps.length === 0) return [];

  // Position of every actuator BEFORE each step is commanded.
  const pos = new Map<ActuatorId, '+' | '-'>();
  for (const a of sequence.actuators) {
    pos.set(a, sequence.initialState.positions[a] === 'extended' ? '+' : '-');
  }
  const before: Array<Map<ActuatorId, '+' | '-'>> = [];
  for (const step of steps) {
    before.push(new Map(pos));
    for (const mv of step.movements) pos.set(mv.actuator, mv.direction);
  }

  const active = (sensor: { actuator: ActuatorId; direction: '+' | '-' }, at: number): boolean =>
    before[at]!.get(sensor.actuator) === sensor.direction;

  const overlaps: SignalOverlap[] = [];
  const seen = new Set<string>();
  const n = steps.length;
  for (let k = 0; k < n; k++) {
    const trigger = steps[(k - 1 + n) % n]!.movements; // all members of the previous step
    for (const mv of steps[k]!.movements) {
      // Next opposite command of the same cylinder, cyclically after k.
      for (let d = 1; d < n; d++) {
        const j = (k + d) % n;
        const opp = steps[j]!.movements.find((m) => m.actuator === mv.actuator && m.direction !== mv.direction);
        if (opp === undefined) continue;
        // The (AND of the) trigger sensors of k still active when j is commanded?
        if (trigger.every((t) => active(t, j))) {
          const sensorId = trigger.map((t) => sensorIdForArrival(t.actuator, t.direction)).join('+');
          const key = `${sensorId}|${mv.actuator}${mv.direction}`;
          if (!seen.has(key)) {
            seen.add(key);
            overlaps.push({
              sensorId,
              commanded: `${mv.actuator}${mv.direction}`,
              blocked: `${opp.actuator}${opp.direction}`,
            });
          }
        }
        break;
      }
    }
  }
  return overlaps;
}

/** Full analysis: classification + overlaps + intuitive applicability. */
export function analyzeSequence(sequence: SequenceModel): SequenceAnalysis {
  const overlaps = detectSignalOverlap(sequence);
  return { kind: classifySequence(sequence), overlaps, intuitiveApplicable: overlaps.length === 0 };
}
