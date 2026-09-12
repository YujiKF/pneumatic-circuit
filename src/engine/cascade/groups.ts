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
  /**
   * Number of trailing movements in THIS group that were merged in from the
   * original LAST group by the last-into-first wrap optimization. 0 for every
   * group that was not the merge target. These movements execute at the END of
   * the cycle (when cascade control wraps back to this line), NOT at its start,
   * which is what preserves the original movement order (see
   * {@link cascadeExecutionOrder} and RULES.md §A3).
   */
  readonly mergedTailCount: number;
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
  // How many trailing movements of the FIRST group came from the wrapped-in
  // last group (0 unless a merge happened). Used to reconstruct execution order.
  let mergedTailMovements = 0;
  if (mergeLastIntoFirst && rawGroups.length >= 2) {
    const first = rawGroups[0] as number[];
    const last = rawGroups[rawGroups.length - 1] as number[];
    if (canMerge(steps, first, last)) {
      // Merge the LAST group's steps into the FIRST group (wrap-around). The
      // remaining groups keep their relative order; the merged group is first.
      const mergedFirst = [...first, ...last];
      finalGroups = [mergedFirst, ...rawGroups.slice(1, rawGroups.length - 1)];
      merged = true;
      mergedTailMovements = flattenMovements(
        last.map((si) => steps[si] as Step),
      ).length;
    }
  }

  const groups: DividedGroup[] = finalGroups.map((stepIndices, idx) => {
    const groupSteps = stepIndices.map((si) => steps[si] as Step);
    return {
      number: idx + 1,
      stepIndices,
      movements: flattenMovements(groupSteps),
      // Only the first group (idx 0) can carry a merged-in tail.
      mergedTailCount: idx === 0 ? mergedTailMovements : 0,
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
 * Reconstruct the PHYSICAL execution order of movements from a division,
 * accounting for the last-into-first wrap.
 *
 * In a cascade the first group's line is the DEFAULT live line at rest; the
 * cycle starts on it and, at the end, control WRAPS back to it. When the last
 * group is merged into the first, its movements are appended to the first
 * group's movement list but they physically run at the END of the cycle (when
 * control returns to line 1), not at the start. So the true execution order is:
 *
 *   [first group's own (non-merged) movements]
 *     ++ [group 2 .. group N movements, in order]
 *     ++ [first group's merged-in tail movements]
 *
 * Without a merge this is just the groups concatenated in order, which equals
 * the original sequence. This function lets a test prove the merge PRESERVES
 * the original movement order (review issue 3) rather than reordering it.
 */
export function cascadeExecutionOrder(division: GroupDivision): Movement[] {
  const groups = division.groups;
  if (groups.length === 0) return [];
  const first = groups[0] as DividedGroup;
  const tail = first.mergedTailCount;
  const firstOwn = tail > 0 ? first.movements.slice(0, first.movements.length - tail) : first.movements.slice();
  const firstMergedTail = tail > 0 ? first.movements.slice(first.movements.length - tail) : [];

  const middleAndLast: Movement[] = [];
  for (let g = 1; g < groups.length; g++) {
    for (const mv of (groups[g] as DividedGroup).movements) middleAndLast.push(mv);
  }

  return [...firstOwn, ...middleAndLast, ...firstMergedTail];
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
