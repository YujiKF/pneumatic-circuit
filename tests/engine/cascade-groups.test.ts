/**
 * Cascade group-division unit tests (método cascata), PMR3407 §7.
 *
 * These test the PURE group-division logic INDEPENDENTLY of any drawing (a user
 * requirement: "O resultado dos grupos também deve ser testável separadamente
 * do desenho."). No known exercise's grouping is hardcoded in the algorithm;
 * these tests assert the GENERICALLY-derived result.
 *
 * Covered:
 *  - the same-letter-opposite-sign division rule;
 *  - Nm = numberOfGroups - 1 (memory-valve count) and the line count;
 *  - simultaneous (parenthesized) groups and timer steps fed to the same scan;
 *  - the last-into-first merge optimization: BOTH a merge case and a
 *    non-merge case.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { divideIntoGroups, cascadeExecutionOrder } from '../../src/engine/index.ts';
import type { GroupDivision } from '../../src/engine/index.ts';
import type { SequenceModel } from '../../src/domain/index.ts';

/** The original movement order of a parsed sequence, e.g. ['A+','A-','A+']. */
function originalOrder(seq: SequenceModel): string[] {
  const out: string[] = [];
  for (const step of seq.steps) {
    for (const mv of step.movements) out.push(`${mv.actuator}${mv.direction}`);
  }
  return out;
}

/** Reconstructed cascade execution order, e.g. ['A+','A-','A+']. */
function execOrder(division: GroupDivision): string[] {
  return cascadeExecutionOrder(division).map((m) => `${m.actuator}${m.direction}`);
}

/** Render a division as "A+B+ | B-A-" strings for compact assertions. */
function shape(division: GroupDivision): string[] {
  return division.groups.map((g) =>
    g.movements.map((m) => `${m.actuator}${m.direction}`).join(''),
  );
}

function divide(raw: string, opts?: Parameters<typeof parseSequence>[1]): GroupDivision {
  const parsed = parseSequence(raw, opts);
  assert.ok(parsed.ok, `sequence "${raw}" must parse`);
  return divideIntoGroups(parsed.value);
}

function divideNoMerge(
  raw: string,
  opts?: Parameters<typeof parseSequence>[1],
): GroupDivision {
  const parsed = parseSequence(raw, opts);
  assert.ok(parsed.ok, `sequence "${raw}" must parse`);
  return divideIntoGroups(parsed.value, { mergeLastIntoFirst: false });
}

// ---------------------------------------------------------------------------
// A+B+B-A- and the equivalent A+B+/B-A- -> Group I [A+ B+], Group II [B- A-]
// ---------------------------------------------------------------------------
test("A+B+B-A- divides into Group I [A+,B+], Group II [B-,A-] with Nm=1", () => {
  const d = divide('A+B+B-A-');
  assert.deepEqual(shape(d), ['A+B+', 'B-A-']);
  assert.equal(d.numberOfGroups, 2);
  assert.equal(d.numberOfMemories, 1); // Nm = groups - 1
  assert.equal(d.merged, false);
});

test("A+B+/B-A- (slash notation) yields the identical grouping as A+B+B-A-", () => {
  const slash = divide('A+B+/B-A-');
  const plain = divide('A+B+B-A-');
  assert.deepEqual(shape(slash), shape(plain));
  assert.deepEqual(shape(slash), ['A+B+', 'B-A-']);
  assert.equal(slash.numberOfMemories, 1);
});

// ---------------------------------------------------------------------------
// B-C+A+B+C-A- (deck 1 Ex3a / deck 4): generically-derived groups + Nm
// ---------------------------------------------------------------------------
test("B-C+A+B+C-A- divides generically into [B-,C+,A+] and [B+,C-,A-], Nm=1", () => {
  // B starts extended (sequence opens with B-).
  const d = divide('B-C+A+B+C-A-', { initialState: { B: 'extended' } });
  assert.deepEqual(shape(d), ['B-C+A+', 'B+C-A-']);
  assert.equal(d.numberOfGroups, 2);
  assert.equal(d.numberOfMemories, 1);
});

// ---------------------------------------------------------------------------
// A+B-B+T(A-B-)B+ (deck 5): groups [A+B-][B+][T(A-B-)][B+], Nm=3
// ---------------------------------------------------------------------------
test("A+B-B+T(A-B-)B+ divides into [A+B-][B+][A-B-][B+] with Nm=3", () => {
  const d = divide('A+B-B+T(A-B-)B+');
  assert.deepEqual(shape(d), ['A+B-', 'B+', 'A-B-', 'B+']);
  assert.equal(d.numberOfGroups, 4);
  assert.equal(d.numberOfMemories, 3); // Nm = 4 - 1
  // The timer step is a normal step in the scan; the simultaneous (A-B-) is a
  // single step whose two movements land in the same group.
  const timerGroup = d.groups[2]!;
  assert.equal(timerGroup.movements.length, 2);
  assert.deepEqual(
    timerGroup.movements.map((m) => `${m.actuator}${m.direction}`),
    ['A-', 'B-'],
  );
});

// ---------------------------------------------------------------------------
// Merge optimization: a MERGE case and a NON-merge case.
// ---------------------------------------------------------------------------
test("MERGE case: A+A-A+ merges last group into first (3 groups -> 2, Nm 2 -> 1)", () => {
  const raw = divideNoMerge('A+A-A+');
  // Raw left-to-right scan: [A+][A-][A+] (three groups because A alternates).
  assert.deepEqual(shape(raw), ['A+', 'A-', 'A+']);
  assert.equal(raw.numberOfMemories, 2);
  assert.equal(raw.merged, false);

  const merged = divide('A+A-A+');
  // First [A+] and last [A+] share only A+ (same sign) -> mergeable.
  assert.deepEqual(shape(merged), ['A+A+', 'A-']);
  assert.equal(merged.numberOfGroups, 2);
  assert.equal(merged.numberOfMemories, 1);
  assert.equal(merged.merged, true);
});

test("NON-merge case: A+B+B-A- cannot merge (wrap conflicts on A and B)", () => {
  const merged = divide('A+B+B-A-'); // merge enabled by default
  // Union of first [A+ B+] and last [B- A-] conflicts on BOTH cylinders.
  assert.deepEqual(shape(merged), ['A+B+', 'B-A-']);
  assert.equal(merged.merged, false);
  assert.equal(merged.numberOfMemories, 1);
});

test("a single-group sequence needs zero memories", () => {
  // A+B-A+ never repeats an opposite sign on the same cylinder -> one group.
  const d = divide('A+B-A+');
  assert.equal(d.numberOfGroups, 1);
  assert.equal(d.numberOfMemories, 0);
  assert.equal(d.merged, false);
});

// ---------------------------------------------------------------------------
// Merge PRESERVES execution order (review issue 3).
//
// The last-into-first merge appends the last group's movements to the FIRST
// group's line, which naively looks like it moves the trailing movement to the
// cycle START. It does NOT: in a cascade the first line is the DEFAULT/rest
// live line, so the merged-in movements physically run at the cycle END (when
// control wraps back to line 1). cascadeExecutionOrder models that wrap, and it
// must reproduce the ORIGINAL sequence order.
// ---------------------------------------------------------------------------
test("MERGE preserves execution order: A+A-A+ still runs A+ then A- then A+", () => {
  const parsed = parseSequence('A+A-A+');
  assert.ok(parsed.ok);
  const division = divideIntoGroups(parsed.value); // merge on by default
  assert.equal(division.merged, true, 'A+A-A+ merges');
  // The merged group carries exactly one wrapped-in tail movement (the last A+).
  assert.equal(division.groups[0]!.mergedTailCount, 1);
  // Even though the group SHAPE is [A+A+][A-], the physical execution order,
  // following the cascade wrap, equals the original sequence.
  assert.deepEqual(execOrder(division), ['A+', 'A-', 'A+']);
  assert.deepEqual(execOrder(division), originalOrder(parsed.value));
});

test("NON-merge keeps execution order = original (A+B+B-A-)", () => {
  const parsed = parseSequence('A+B+B-A-');
  assert.ok(parsed.ok);
  const division = divideIntoGroups(parsed.value);
  assert.equal(division.merged, false);
  assert.equal(division.groups[0]!.mergedTailCount, 0);
  assert.deepEqual(execOrder(division), originalOrder(parsed.value));
});

test("merged-tail count is zero for every non-first group", () => {
  const parsed = parseSequence('A+A-A+');
  assert.ok(parsed.ok);
  const division = divideIntoGroups(parsed.value);
  for (let i = 1; i < division.groups.length; i++) {
    assert.equal(division.groups[i]!.mergedTailCount, 0, `group ${i + 1} has no tail`);
  }
});

test("group numbers are 1-based and contiguous (Grupo I, II, ...)", () => {
  const d = divide('A+B-B+T(A-B-)B+');
  assert.deepEqual(
    d.groups.map((g) => g.number),
    [1, 2, 3, 4],
  );
});
