/**
 * Cascade group-division algorithm (método cascata), PMR3407 §7.
 *
 * This module is the LOGIC core of the cascade method and is deliberately kept
 * free of any circuit/drawing concern so it can be tested in isolation (a user
 * requirement: "O resultado dos grupos também deve ser testável separadamente
 * do desenho.").
 *
 * GROUP DIVISION RULE (RULES.md §7, deck 4 p.62-65 / deck 5):
 *   Walk the sequence left to right. Start a NEW group whenever adding the next
 *   STEP would place the SAME cylinder letter with an OPPOSITE sign into the
 *   current group. i.e. within a group, no cylinder may both advance (+) and
 *   retract (-). A parenthesized simultaneous group and a timer step are still
 *   just steps/movements fed to the same left-to-right scan.
 *
 * The division is derived GENERICALLY from the sequence; no known exercise's
 * grouping is hardcoded.
 *
 * MEMORY COUNT (RULES.md §7.3): the number of switching memory valves is
 *   Nm = numberOfGroups - 1  (bistable double-pilot 4/2 or 5/2 valves).
 * The number of pressure LINES equals the number of groups.
 *
 * LAST-INTO-FIRST MERGE (RULES.md §7.4 / §A3): if merging the LAST group into
 * the FIRST group does not violate the same-letter-opposite-sign rule, merge to
 * reduce the memory count. The merge is conservative and deterministic.
 *
 * No enums (Node strip-only): closed sets are string-literal unions.
 */

import type { Movement, SequenceModel, Step } from '../../domain/index.ts';

/**
 * One cascade group as produced by the division: the ordered STEPS it owns and
 * the flattened list of MOVEMENTS. Keeping both lets callers reason at either
 * granularity (a step may hold several simultaneous movements).
 */
export interface DividedGroup {
  /** 1-based group number (Grupo I = 1, Grupo II = 2, ...). */
  readonly number: number;
  /** Indices (into SequenceModel.steps) belonging to this group, in order. */
  readonly stepIndices: readonly number[];
  /** All movements of the group's steps, flattened in execution order. */
  readonly movements: readonly Movement[];
}

/** Result of dividing a sequence into cascade groups. */
export interface GroupDivision {
  readonly groups: readonly DividedGroup[];
  /** Number of pressure lines = number of groups. */
  readonly numberOfGroups: number;
  /** Number of switching memory valves: Nm = numberOfGroups - 1. */
  readonly numberOfMemories: number;
  /** True when a last-into-first merge was applied. */
  readonly merged: boolean;
}

/** Options controlling the division. */
export interface DivideOptions {
  /**
   * Apply the last-into-first merge optimization when it does not create a
   * conflict. Default true (RULES.md §7.4). Set false to inspect the raw,
   * unmerged division (useful in tests).
   */
  readonly mergeLastIntoFirst?: boolean;
}

/**
 * Would adding `movements` to a group already containing `present` violate the
 * same-letter-opposite-sign rule? A conflict exists when any actuator would end
 * up with both a '+' and a '-' movement in the group.
 *
 * `present` is a map actuator -> set of directions already in the group.
 */
function conflicts(
  present: Map<string, Set<string>>,
  movements: readonly Movement[],
): boolean {
  // Build the candidate directions per actuator from the current group PLUS the
  // incoming step's movements. Because a single step never contains the same
  // actuator with both signs (the parser rejects that), the only way to create
  // a conflict is a clash with a movement already accumulated in the group.
  for (const mv of movements) {
    const existing = present.get(mv.actuator);
    if (existing === undefined) continue;
    const opposite = mv.direction === '+' ? '-' : '+';
    if (existing.has(opposite)) return true;
  }
  return false;
}

/** Add a step's movements into the running per-actuator direction map. */
function absorb(present: Map<string, Set<string>>, movements: readonly Movement[]): void {
  for (const mv of movements) {
    let set = present.get(mv.actuator);
    if (set === undefined) {
      set = new Set<string>();
      present.set(mv.actuator, set);
    }
    set.add(mv.direction);
  }
}

/** Flatten the movements of a run of steps in execution order. */
function flattenMovements(steps: readonly Step[]): Movement[] {
  const out: Movement[] = [];
  for (const step of steps) {
    for (const mv of step.movements) out.push(mv);
  }
  return out;
}

/**
 * Divide a parsed sequence into ordered cascade groups.
 *
 * The scan is over STEPS (so a simultaneous parenthesized group and a timer
 * step are handled uniformly). A new group opens as soon as the next step's
 * movements would clash with a movement already in the current group.
 */
export function divideIntoGroups(
  sequence: SequenceModel,
  options: DivideOptions = {},
): GroupDivision {
  const mergeLastIntoFirst = options.mergeLastIntoFirst ?? true;
  const steps = sequence.steps;

  // --- left-to-right scan into raw groups (list of step-index runs) ---
  const rawGroups: number[][] = [];
  let current: number[] = [];
  let present = new Map<string, Set<string>>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Step;
    if (current.length > 0 && conflicts(present, step.movements)) {
      // Adding this step would put a cylinder in both directions: close.
      rawGroups.push(current);
      current = [];
      present = new Map<string, Set<string>>();
    }
    current.push(i);
    absorb(present, step.movements);
  }
  if (current.length > 0) rawGroups.push(current);

  // --- last-into-first merge optimization (RULES.md §7.4 / §A3) ---
  let merged = false;
  let finalGroups = rawGroups;
  if (mergeLastIntoFirst && rawGroups.length >= 2) {
    const first = rawGroups[0] as number[];
    const last = rawGroups[rawGroups.length - 1] as number[];
    if (canMerge(steps, first, last)) {
      // Merge the LAST group's steps into the FIRST group (wrap-around). The
      // remaining groups keep their relative order; the merged group is first.
      const mergedFirst = [...first, ...last];
      finalGroups = [mergedFirst, ...rawGroups.slice(1, rawGroups.length - 1)];
      merged = true;
    }
  }

  const groups: DividedGroup[] = finalGroups.map((stepIndices, idx) => {
    const groupSteps = stepIndices.map((si) => steps[si] as Step);
    return {
      number: idx + 1,
      stepIndices,
      movements: flattenMovements(groupSteps),
    };
  });

  const numberOfGroups = groups.length;
  return {
    groups,
    numberOfGroups,
    // Nm = groups - 1 (at least 0). A single group needs no switching memory.
    numberOfMemories: Math.max(0, numberOfGroups - 1),
    merged,
  };
}

/**
 * Can the LAST group be merged into the FIRST without creating a
 * same-letter-opposite-sign conflict? The union of both groups' movements must
 * contain no actuator with both '+' and '-'.
 */
function canMerge(
  steps: readonly Step[],
  first: readonly number[],
  last: readonly number[],
): boolean {
  const present = new Map<string, Set<string>>();
  for (const si of first) absorb(present, (steps[si] as Step).movements);
  for (const si of last) {
    if (conflicts(present, (steps[si] as Step).movements)) return false;
    absorb(present, (steps[si] as Step).movements);
  }
  return true;
}
