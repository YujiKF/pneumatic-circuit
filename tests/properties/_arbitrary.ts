/**
 * Hand-rolled property-testing helper.
 *
 * fast-check cannot be installed (npm registry is blocked). This module
 * provides a tiny, deterministic random generator plus a `forAll` runner and a
 * naive shrinker, enough to express the invariants this project cares about.
 *
 * Determinism: a fixed default seed makes failures reproducible. Pass a
 * different seed to explore other cases.
 */

/** A minimal xorshift32 PRNG: deterministic and dependency-free. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Avoid a zero state which would lock xorshift at 0.
    this.state = seed === 0 ? 0x9e3779b9 : seed >>> 0;
  }

  /** Next uint32. */
  nextUint(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return this.nextUint() % maxExclusive;
  }

  /** Integer in [min, max]. */
  intBetween(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  /** Pick a random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)] as T;
  }
}

/** A generated value together with its shrink candidates. */
export interface Arbitrary<T> {
  generate(rng: Rng): T;
  /** Produce simpler candidate values (may be empty). */
  shrink(value: T): T[];
}

export interface ForAllOptions {
  readonly runs?: number;
  readonly seed?: number;
}

export interface Counterexample<T> {
  readonly value: T;
  readonly error: unknown;
}

/**
 * Run `predicate` against `runs` generated values. On the first failure, shrink
 * to a minimal counterexample and throw an Error describing it. Returns
 * silently on success.
 */
export function forAll<T>(
  arb: Arbitrary<T>,
  predicate: (value: T) => void,
  options: ForAllOptions = {},
): void {
  const runs = options.runs ?? 100;
  const seed = options.seed ?? 0x1234_5678;
  const rng = new Rng(seed);

  for (let i = 0; i < runs; i++) {
    const value = arb.generate(rng);
    const failure = check(predicate, value);
    if (failure !== undefined) {
      const minimal = shrinkToMinimal(arb, predicate, value);
      throw new Error(
        `Property failed after ${i + 1} run(s) (seed=${seed}).\n` +
          `Counterexample: ${JSON.stringify(minimal.value)}\n` +
          `Cause: ${describe(minimal.error)}`,
      );
    }
  }
}

function check<T>(predicate: (value: T) => void, value: T): unknown | undefined {
  try {
    predicate(value);
    return undefined;
  } catch (error) {
    return error ?? new Error('predicate threw a falsy value');
  }
}

function shrinkToMinimal<T>(
  arb: Arbitrary<T>,
  predicate: (value: T) => void,
  initial: T,
): Counterexample<T> {
  let current: T = initial;
  let currentError: unknown = check(predicate, current) ?? new Error('unknown');

  let improved = true;
  let guard = 0;
  while (improved && guard < 1000) {
    improved = false;
    guard++;
    for (const candidate of arb.shrink(current)) {
      const failure = check(predicate, candidate);
      if (failure !== undefined) {
        current = candidate;
        currentError = failure;
        improved = true;
        break;
      }
    }
  }
  return { value: current, error: currentError };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
