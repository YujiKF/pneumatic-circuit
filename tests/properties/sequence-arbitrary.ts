/**
 * An {@link Arbitrary} that generates VALID PMR3407 sequences together with
 * the ground-truth set of actuators used, so property tests can assert parser
 * invariants (round-trip, actuator coverage) without a solver.
 *
 * A generated sequence is described structurally (not as a string) so we can
 * render it in any accepted dialect and shrink it meaningfully.
 */

import type { Arbitrary, Rng } from './_arbitrary.ts';

export type GenDirection = '+' | '-';

export interface GenMovement {
  actuator: string;
  direction: GenDirection;
}

export interface GenStep {
  movements: GenMovement[];
  hasTimer: boolean;
}

export interface GenSequence {
  steps: GenStep[];
}

const ACTUATOR_POOL = ['A', 'B', 'C', 'D', 'E'] as const;
const DIRECTIONS: readonly GenDirection[] = ['+', '-'];

/** Distinct actuators actually used by a generated sequence, sorted. */
export function actuatorsOf(seq: GenSequence): string[] {
  const set = new Set<string>();
  for (const step of seq.steps) {
    for (const mv of step.movements) set.add(mv.actuator);
  }
  return [...set].sort();
}

/** Canonical string (matches the parser's canonical form) for a generated sequence. */
export function canonicalStringOf(seq: GenSequence): string {
  let out = '';
  for (const step of seq.steps) {
    if (step.hasTimer) out += 'T';
    if (step.movements.length === 1) {
      const mv = step.movements[0] as GenMovement;
      out += `${mv.actuator}${mv.direction}`;
    } else {
      const ordered = [...step.movements].sort((a, b) =>
        a.actuator < b.actuator ? -1 : a.actuator > b.actuator ? 1 : 0,
      );
      out += '(' + ordered.map((m) => `${m.actuator}${m.direction}`).join('') + ')';
    }
  }
  return out;
}

/**
 * Render a generated sequence into a chosen surface dialect.
 * dialect 0: compact  "A+B+"
 * dialect 1: spaced    "A+ B+"
 * dialect 2: semicolon "A+;B+"
 * dialect 3: lowercase "a+b+"
 * Groups and timers are preserved across dialects.
 */
export function renderDialect(seq: GenSequence, dialect: number): string {
  const parts: string[] = [];
  for (const step of seq.steps) {
    let piece = step.hasTimer ? 'T' : '';
    if (step.movements.length === 1) {
      const mv = step.movements[0] as GenMovement;
      piece += `${mv.actuator}${mv.direction}`;
    } else {
      piece += '(' + step.movements.map((m) => `${m.actuator}${m.direction}`).join('') + ')';
    }
    parts.push(piece);
  }
  let joined: string;
  switch (dialect % 4) {
    case 1:
      joined = parts.join(' ');
      break;
    case 2:
      joined = parts.join(';');
      break;
    default:
      joined = parts.join('');
      break;
  }
  if (dialect % 4 === 3) {
    joined = joined.toLowerCase();
  }
  return joined;
}

export const sequenceArbitrary: Arbitrary<GenSequence> = {
  generate(rng: Rng): GenSequence {
    const stepCount = rng.intBetween(1, 6);
    const steps: GenStep[] = [];
    for (let s = 0; s < stepCount; s++) {
      const simultaneous = rng.int(4) === 0; // ~25% grouped
      const hasTimer = rng.int(5) === 0; // ~20% timed
      if (simultaneous) {
        const howMany = rng.intBetween(2, 3);
        const chosen: GenMovement[] = [];
        const used = new Set<string>();
        for (let k = 0; k < howMany; k++) {
          let actuator = rng.pick(ACTUATOR_POOL);
          let guard = 0;
          while (used.has(actuator) && guard < 10) {
            actuator = rng.pick(ACTUATOR_POOL);
            guard++;
          }
          if (used.has(actuator)) continue;
          used.add(actuator);
          chosen.push({ actuator, direction: rng.pick(DIRECTIONS) });
        }
        steps.push({ movements: chosen, hasTimer });
      } else {
        steps.push({
          movements: [{ actuator: rng.pick(ACTUATOR_POOL), direction: rng.pick(DIRECTIONS) }],
          hasTimer,
        });
      }
    }
    return { steps };
  },

  shrink(value: GenSequence): GenSequence[] {
    const candidates: GenSequence[] = [];
    // Drop each step.
    for (let i = 0; i < value.steps.length; i++) {
      if (value.steps.length <= 1) break;
      const steps = value.steps.filter((_, idx) => idx !== i);
      candidates.push({ steps });
    }
    // Remove a timer flag.
    for (let i = 0; i < value.steps.length; i++) {
      if (value.steps[i]?.hasTimer) {
        const steps = value.steps.map((st, idx) =>
          idx === i ? { ...st, hasTimer: false } : st,
        );
        candidates.push({ steps });
      }
    }
    // Collapse a group to its first movement.
    for (let i = 0; i < value.steps.length; i++) {
      const st = value.steps[i];
      if (st && st.movements.length > 1) {
        const steps = value.steps.map((s, idx) =>
          idx === i ? { ...s, movements: [s.movements[0] as GenMovement] } : s,
        );
        candidates.push({ steps });
      }
    }
    return candidates;
  },
};
