# Golden Tests & Property Tests — Milestone 2 (Cascade Pneumatic)

This document specifies (does NOT author) the cascade golden tests and property
tests for Milestone 2. Test `.ts` files are written later by the implementation
tasks in [`tasks.md`](./tasks.md); each is DONE only when it passes under
`node --test`. Every golden ties back to a worked PMR3407 exercise and to the
rules in [`docs/PMR3407_CASCADE_RULES.md`](../../../docs/PMR3407_CASCADE_RULES.md).

Group contents and counts MUST be asserted **independently of any drawing**
(from the logical model), per the user requirement.

---

## 1. Chosen golden exercises (≥3, incl. ≥1 non-trivial division)

### G1 — `A+B+A-B-` (user's example; direct, simple division)

- **Sequence:** `A+B+A-B-`
- **Expected groups:** `[A+ B+]`, `[A- B-]`
- **Number of groups (lines):** 2
- **Number of memories:** `Nm = 1`
- **Sensors used:**
  - intra-group: G1 `A+` on line (none), `B+` gated by `1S2`; G2 `A-` on line
    (none), `B-` gated by `1S1`.
  - group-activation: G2 activated by last event of G1 (`B+` → `2S2`).
- **Merge:** none (wrap union `{A+,B+,A-,B-}` conflicts on A and B).
- **Expected circuit:** 2 cylinders (`1.0`,`2.0`), 2 main 5/2 double-pilot valves
  (`1.1`,`2.1`), 1 memory valve (`M1`/`0.1`), supply/start `E`, sensors
  `1S1,1S2,2S1,2S2`, 2 pressure lines `L1,L2`. Validates with zero issues.
- **Note:** the routing briefing lists this as the user's direct example; keep it
  even though the canonical deck example is G2. CASCADE §C2.4.

### G2 — `A+B+/B-A-` (≡ `A+B+B-A-`; canonical deck-4 p.63, indirect)

- **Sequence:** `A+B+/B-A-` and `A+B+B-A-` (must produce identical results)
- **Expected groups:** `[A+ B+]`, `[B- A-]`
- **Number of groups (lines):** 2
- **Number of memories:** `Nm = 1`
- **Sensors used:**
  - intra-group: G1 `A+` (none), `B+` gated by `1S2`; G2 `B-` (none), `A-` gated
    by `2S1`.
  - group-activation: G2 activated by last event of G1 (`B+` → `2S2`); memory
    `M1` set by `2S2`, activates `L2`, deactivates `L1`.
- **Merge:** none (wrap conflicts on A and B). CASCADE §C4.3.
- **Expected circuit:** as G1's shape. Validates with zero issues.
- **Status:** EXISTS in `tests/golden/cascade.golden.test.ts`; keep/verify.

### G3 — `B-C+A+B+C-A-` (deck 1 Ex3a / deck 4; NON-trivial, 3 cylinders, B extended)

- **Sequence:** `B-C+A+B+C-A-`, initial state `B: extended`
- **Expected groups:** `[B- C+ A+]`, `[B+ C- A-]`
- **Number of groups (lines):** 2
- **Number of memories:** `Nm = 1`
- **Sensors used:**
  - group-activation: G2 activated by last event of G1 (`A+` → `1S2`); `M1` set
    by `1S2`.
  - intra-group: gated per the previous-movement arrival within each group.
- **Merge:** none.
- **Expected circuit:** 3 cylinders + 3 main valves, 1 memory valve, `L1,L2`,
  sensors for A/B/C both ends as referenced. Validates with zero issues.
- **Initial-state note:** B starts extended (opens with `B-`); exercises CASCADE
  §C6 (no silent all-retracted).
- **Status:** EXISTS; keep/verify.

### G4 — `A+B-B+T(A-B-)B+` (deck 5, fully worked; NON-trivial, 4 groups, timer + simultaneous)

- **Sequence:** `A+B-B+T(A-B-)B+`
- **Expected groups:** `[A+ B-]`, `[B+]`, `[A- B-]`, `[B+]`
- **Number of groups (lines):** 4
- **Number of memories:** `Nm = 3` (`M1,M2,M3`)
- **Sensors used:**
  - group-activation: G2 ← last of G1 (`B-` → `2S1`); G3 ← last of G2 (`B+` →
    `2S2`); G4 ← last of G3, the simultaneous `(A- B-)`. **Today the model
    records the last-listed member (`B-` → `2S1`); the Milestone-2 transition
    view SHALL list BOTH members' arrival sensors (`1S1` and `2S1`).** CASCADE
    §C5.2.
  - memory chain: `L1->L2`, `L2->L3`, `L3->L4`.
- **Merge:** none.
- **Timer:** treat `T` as a pneumatic temporizador (RULES §A4); it does not alter
  the division.
- **Expected circuit:** 2 cylinders + 2 main valves, 3 memory valves,
  `L1..L4`. Validates with zero issues.
- **Status:** EXISTS (records last-listed sensor); Milestone-2 extends the
  transition assertion to both members.

### G5 (optional) — `A+B+D-A-B-C+C-D+` (deck-4 p.65; 3-group + merge illustration)

- **Sequence:** `A+B+D-A-B-C+C-D+`
- **Expected pre-merge groups:** `[A+ B+ D-]`, `[A- B- C+]`, `[C- D+]`
- **Number of groups (pre-merge):** 3, `Nm = 2`
- **Merge:** the deck labels this "1 2 1" (last group unites with the first).
  Assert the pre-merge 3-group division deterministically, then assert the
  merge outcome from the conservative union rule (CASCADE §C4.2/§C4.3): the
  first `[A+ B+ D-]` and last `[C- D+]` union is `{A+,B+,D-,C-,D+}` which
  conflicts on **D** (`D-` and `D+`) → **the conservative rule does NOT merge**.
  Record this explicitly: the algorithm's deterministic union rule keeps them
  separate even though the deck's hand solution merges. This is a **known
  divergence** between the deck's manual optimization and the conservative
  deterministic rule; pin the algorithm's actual output and note the deck's
  "1 2 1" as the manual result. (Do not change the algorithm to match the deck
  unless a later task revises §A3.)
- **Status:** NEW; add as a golden that documents the divergence and the
  pre-merge division.

> **Divergence flag (important for the implementer):** G5 is the one case where
> the conservative deterministic merge rule (§A3) and the deck's manual "1 2 1"
> solution disagree, because `D` appears with both signs across the wrap. The
> golden SHALL assert the algorithm's real output (no merge on D-conflict) and
> the doc SHALL record the deck's manual result as a separate, non-authoritative
> observation. This keeps the generator deterministic and never emits an invalid
> group.

---

## 2. Per-exercise record table (quick reference)

| ID | Sequence            | Groups                        | NG | Nm | Merge      | Trivial? |
| -- | ------------------- | ----------------------------- | -- | -- | ---------- | -------- |
| G1 | `A+B+A-B-`          | `[A+ B+] [A- B-]`             | 2  | 1  | no         | trivial  |
| G2 | `A+B+/B-A-`         | `[A+ B+] [B- A-]`             | 2  | 1  | no         | trivial  |
| G3 | `B-C+A+B+C-A-`      | `[B- C+ A+] [B+ C- A-]`       | 2  | 1  | no         | NON-triv |
| G4 | `A+B-B+T(A-B-)B+`   | `[A+ B-] [B+] [A- B-] [B+]`   | 4  | 3  | no         | NON-triv |
| G5 | `A+B+D-A-B-C+C-D+`  | `[A+ B+ D-] [A- B- C+] [C- D+]` | 3 | 2 | no (D wrap conflict) | NON-triv |

---

## 3. Property tests (all six the user enumerated)

To be written under `tests/properties/` using the existing hand-rolled
`Rng`/`forAll`/shrinker (`tests/properties/_arbitrary.ts`); NO new dependency.
The generator produces random valid sequences (2-4 cylinders, balanced cycles);
the properties assert against the solved `CascadeLogicalModel` / `GroupDivision`.

- **P1 — no conflicting same-actuator movement in a group** (REQ-CAS-PROP-NOCONFLICT,
  CASCADE §C2.1): for every group, no actuator appears with both `+` and `-`.
- **P2 — every movement appears exactly once across groups**
  (REQ-CAS-PROP-COVER, §C2): the multiset of movements across all groups equals
  the sequence's movements.
- **P3 — movement order preserved** (REQ-CAS-PROP-ORDER, §C4.2):
  `cascadeExecutionOrder(division)` equals the original movement order, with and
  without a merge.
- **P4 — every group transition has a valid condition** (REQ-CAS-PROP-TRANSITION,
  §C5): for every transition (group `k`→`k+1`), the activation sensor(s) are the
  arrival sensor(s) of the previous group's last event and are producible.
- **P5 — memory count coherent with group count** (REQ-CAS-PROP-MEMCOHERENT,
  §C3): `numberOfMemories == max(0, numberOfGroups − 1)` and
  `memories.length == numberOfMemories`.
- **P6 — no two group lines permanently co-active** (REQ-CAS-PROP-EXCLUSIVE,
  §C7): the memory chain selects exactly one line at a time (each memory
  activates line `k+1` and deactivates line `k`; the activates/deactivates
  relationships form a single forward chain with no line both activated and
  never deactivated by another).

---

## 4. Independence-from-drawing requirement

For every golden G1-G5, the group contents, `NG`, `Nm`, and transition sensors
MUST be asserted from the **logical model** (`solveCascade`) and/or the pure
`divideIntoGroups` result, NOT from the SVG. The SVG-level goldens (once the
renderer exists) assert only **structural** facts (presence of `L1..Ln` buses,
`M1..Nm` memory symbols, cylinders, main valves, no `NaN`/`undefined`) and are
kept separate from the logical goldens.
