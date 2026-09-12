/**
 * An {@link Arbitrary} that generates PHYSICALLY-CONSISTENT step-by-step
 * sequences: each cylinder alternates direction (a cylinder that is retracted
 * can only advance next, and vice-versa), so every movement actually happens
 * and every end-of-course sensor can trip. This lets the property tests
 * exercise the solver + simulator + validator over the space of solvable
 * sequences, including the "returns to initial state" invariant.
 *
 * Built on the FEAT-001 hand-rolled helper (Rng/Arbitrary); fast-check is not
 * installable.
 */

import type { Arbitrary, Rng } from './_arbitrary.ts';

export type Dir = '+' | '-';

export interface GenStepMovement {
  actuator: string;
  direction: Dir;
}

export interface GenStepSeq {
  /** Ordered single-movement steps (no simultaneous groups here). */
  steps: GenStepMovement[];
  /** Actuators that must START extended (their first move is '-'). */
  extendedAtStart: string[];
  /** True when every cylinder returns to its initial position at the end. */
  balanced: boolean;
}

const POOL = ['A', 'B', 'C'] as const;

/** Canonical string for the generated sequence. */
export function toCanonical(seq: GenStepSeq): string {
  return seq.steps.map((m) => `${m.actuator}${m.direction}`).join('');
}

/**
 * Generate a physically-consistent sequence. We track each cylinder's position
 * (retracted/extended) and only emit the movement that its current position
 * allows, so directions alternate per cylinder. `balanced` sequences append
 * the returning moves so every cylinder ends home.
 */
export const stepSequenceArbitrary: Arbitrary<GenStepSeq> = {
  generate(rng: Rng): GenStepSeq {
    const actuatorCount = rng.intBetween(1, 3);
    const actuators = POOL.slice(0, actuatorCount);
    // position: false = retracted (home), true = extended.
    const pos = new Map<string, boolean>();
    for (const a of actuators) pos.set(a, false);
    const startPos = new Map(pos);

    const moveCount = rng.intBetween(actuators.length, actuators.length * 3);
    const steps: GenStepMovement[] = [];
    for (let i = 0; i < moveCount; i++) {
      const actuator = rng.pick(actuators);
      const extended = pos.get(actuator) === true;
      const direction: Dir = extended ? '-' : '+';
      pos.set(actuator, !extended);
      steps.push({ actuator, direction });
    }

    // Make it balanced: return every extended cylinder home.
    const balanced = rng.int(2) === 0;
    if (balanced) {
      for (const a of actuators) {
        if (pos.get(a) === true) {
          steps.push({ actuator: a, direction: '-' });
          pos.set(a, false);
        }
      }
    }

    const extendedAtStart: string[] = [];
    for (const [a, p] of startPos) if (p) extendedAtStart.push(a);

    // Guarantee at least one step.
    if (steps.length === 0) {
      steps.push({ actuator: actuators[0] as string, direction: '+' });
    }

    return { steps, extendedAtStart, balanced };
  },

  shrink(value: GenStepSeq): GenStepSeq[] {
    const out: GenStepSeq[] = [];
    // Drop trailing step (keep >=1) -- preserves prefix consistency.
    if (value.steps.length > 1) {
      out.push({ ...value, steps: value.steps.slice(0, -1), balanced: false });
    }
    return out;
  },
};
