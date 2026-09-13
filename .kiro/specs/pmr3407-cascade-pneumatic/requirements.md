# Requirements — Milestone 2: Cascade Pneumatic (Cascata Pneumática)

Testable requirements in EARS style ("WHEN … THE SYSTEM SHALL …") for the
**pneumatic cascade** method. Each requirement is traceable to
[`docs/PMR3407_CASCADE_RULES.md`](../../../docs/PMR3407_CASCADE_RULES.md) (cited
as **CASCADE §Cn**) and, through it, to
[`docs/PMR3407_RULES.md`](../../../docs/PMR3407_RULES.md) (cited as **RULES §n**),
and each maps to a (future) test named in
[`tasks.md`](./tasks.md) / [`golden-tests.md`](./golden-tests.md).

Quality priority (highest first): **1) logical correctness, 2) adherence to
PMR3407 methods, 3) testability, 4) code clarity, 5) visual appearance.**

Status legend: **[EXISTS]** = already satisfied by current code (to be
verified/pinned, not rebuilt); **[PARTIAL]** = code exists but is incomplete;
**[NEW]** = not yet implemented. See [`design.md`](./design.md) §"What exists vs
what is missing" for the file-level gap analysis.

> **Scope guard (Milestone 2).** This milestone is the **PNEUMATIC** cascade
> only. Electropneumatic cascade, the "E com menos válvulas" optimization, and
> the emergency-button variant are explicitly **out of scope** (CASCADE §C5.3).

---

## 1. Input and parsing (reuse the existing parser)

- **REQ-CAS-PARSE-REUSE [EXISTS]** — WHEN a cascade circuit is requested for a
  sequence, THE SYSTEM SHALL parse it with the **existing** parser
  (`src/parser/`) and SHALL NOT introduce a new parser. (RULES §1)
- **REQ-CAS-PARSE-SLASH [EXISTS]** — WHEN the sequence uses the cascade
  group-boundary slash notation (e.g. `A+B+/B-A-`), THE SYSTEM SHALL treat `/`
  as a pure separator and produce the identical canonical model and identical
  grouping as the equivalent compact sequence (`A+B+B-A-`). (RULES §1)
- **REQ-CAS-INITIAL-EXPLICIT [EXISTS]** — WHEN a cascade circuit is solved, THE
  SYSTEM SHALL use the explicit, overridable `InitialState` and SHALL NOT
  silently assume all cylinders start retracted. (CASCADE §C6, RULES §2, audit
  Obs.1)

## 2. Movement analysis

- **REQ-CAS-ACTUATORS [EXISTS]** — WHEN a sequence is solved for cascade, THE
  SYSTEM SHALL use the auto-detected, de-duplicated, alphabetically-sorted
  actuator set from the `SequenceModel`. (RULES §2)
- **REQ-CAS-STEP-MULTI [EXISTS]** — THE SYSTEM SHALL treat a parenthesized
  simultaneous step and a timer step as a single step in the group scan, with
  all movements of a simultaneous step landing in one group. (CASCADE §C2.2)

## 3. Automatic group division

- **REQ-CAS-DIV-RULE [EXISTS]** — WHEN dividing a sequence, THE SYSTEM SHALL
  scan left to right and SHALL close the current group and open a new one at the
  moment adding the next step would place the **same cylinder letter with the
  opposite sign** into the current group. (CASCADE §C2.1, RULES §7)
- **REQ-CAS-DIV-START-END [EXISTS]** — THE SYSTEM SHALL start the first group at
  the first step and end the last group at the last step (subject to
  REQ-CAS-MERGE). (CASCADE §C2.1)
- **REQ-CAS-DIV-REAPPEAR [EXISTS]** — THE SYSTEM SHALL allow an actuator to
  appear multiple times in the same group **only** when every appearance has the
  same sign; it SHALL forbid the same actuator with both signs in one group.
  (CASCADE §C2.2)
- **REQ-CAS-DIV-GENERIC [EXISTS]** — THE SYSTEM SHALL derive the division
  generically from the steps and SHALL NOT hardcode any known exercise's
  grouping. (CASCADE §C2.4)
- **REQ-CAS-DIV-TESTABLE [EXISTS]** — THE SYSTEM SHALL expose the group division
  as a pure result testable **independently of any drawing** (group contents +
  counts). (CASCADE §C2, existing `tests/engine/cascade-groups.test.ts`)

## 4. Line count, memory count, and merge

- **REQ-CAS-LINES [EXISTS]** — THE SYSTEM SHALL produce exactly **one pressure
  line per group** (`lines = NG`). (CASCADE §C3)
- **REQ-CAS-MEMCOUNT [EXISTS]** — THE SYSTEM SHALL produce `Nm = NG − 1` bistable
  double-pilot memory valves; a single-group sequence SHALL produce zero memory
  valves. (CASCADE §C3, RULES §7.3)
- **REQ-CAS-MERGE [EXISTS]** — WHEN the union of the first and last groups
  contains no actuator with both signs, THE SYSTEM SHALL merge the last group
  into the first to reduce the line/memory count; otherwise it SHALL keep them
  separate. (CASCADE §C4.2, RULES §A3)
- **REQ-CAS-MERGE-ORDER [EXISTS]** — WHEN a last-into-first merge is applied, THE
  SYSTEM SHALL preserve the original physical execution order (the merged-in
  movements run at the END of the cycle), verifiable via
  `cascadeExecutionOrder`. (CASCADE §C4.2)
- **REQ-CAS-MERGE-DECK [PARTIAL]** — WHEN the sequence is the deck-4 p.65 example
  `A+B+D-A-B-C+C-D+`, THE SYSTEM SHALL divide it into the pre-merge groups
  `[A+ B+ D-] [A- B- C+] [C- D+]` and apply the merge rule deterministically per
  REQ-CAS-MERGE. (CASCADE §C4.3) — *pin as a new golden.*

## 5. Group-line generation and switching logic

- **REQ-CAS-FIRSTLINE [EXISTS]** — THE SYSTEM SHALL make line 1 the default/rest
  live line, fed through the memory-valve chain in its rest state. (CASCADE §C5
  rule 1)
- **REQ-CAS-ACTIVATE [EXISTS]** — WHEN the last event of a group completes (its
  arrival sensor trips), THE SYSTEM SHALL activate the next group's line via the
  corresponding memory valve. (CASCADE §C5 rule 2)
- **REQ-CAS-RESET [EXISTS]** — WHEN a group is activated, THE SYSTEM SHALL
  reset/de-pilot the memory valve that had activated the previous group. (CASCADE
  §C5 rule 3)
- **REQ-CAS-TRANSITION-COND [PARTIAL]** — THE SYSTEM SHALL give every group-to-
  group transition a valid activation condition (a sensor that is producible by
  a movement of the previous group); WHEN the previous group ends on a
  simultaneous step, the transition condition SHALL depend on **all** members
  arriving, not only the last-listed one. (CASCADE §C5.2) — *the "all members"
  gating is the missing part; today only the last-listed sensor is recorded.*

## 6. Valves and sensors

- **REQ-CAS-MAINVALVE [EXISTS]** — THE SYSTEM SHALL emit exactly one 5/2
  double-pilot main valve per cylinder, with advance on pilot 14 and retract on
  pilot 12. (CASCADE §C5.1, RULES §4.1)
- **REQ-CAS-MEMVALVE [EXISTS]** — THE SYSTEM SHALL emit each memory valve as a
  bistable double-pilot 5/2 directional valve, set by the next group's
  activation sensor and reset by the following group's activation sensor (or the
  supply/start line for the last memory). (CASCADE §C3, §C5)
- **REQ-CAS-SENSOR-INTRA [EXISTS]** — THE SYSTEM SHALL place an intra-group
  action-change sensor between the group pressure line and the cylinder's main
  valve pilot; the first movement of a group SHALL have no intra-group gating
  sensor. (CASCADE §C5.1, step 4a)
- **REQ-CAS-SENSOR-ACTIVATE [EXISTS]** — THE SYSTEM SHALL drive memory-valve
  pilots (never a main valve directly) from group-activation sensors. (CASCADE
  §C5.1, step 4b)
- **REQ-CAS-NODUP-SENSOR [PARTIAL]** — THE SYSTEM SHALL NOT emit two sensors for
  the same (actuator, end-position). (RULES §4) — *covered generically by the
  existing validator; needs a cascade-targeted check/test.*

## 7. Pneumatic circuit projection

- **REQ-CAS-CIRCUIT [PARTIAL]** — THE SYSTEM SHALL project the cascade logical
  model to a flat pneumatic `Circuit` (components + connections) that the
  existing `validateCircuit` accepts with **zero** issues. (design §5) — *exists;
  gaps in projection completeness are enumerated in design §"gap analysis".*
- **REQ-CAS-CIRCUIT-NOLOGIC [EXISTS]** — THE SYSTEM SHALL keep the projection
  purely structural and SHALL NOT re-derive cascade logic in the projection.
  (design §1)
- **REQ-CAS-CIRCUIT-GROUPS [PARTIAL]** — THE SYSTEM SHALL populate the domain
  `CascadeGroup` aggregate with meaningful `stepIndices` and `lineId` so the
  layout/renderer can label groups without consulting the logical model.
  (CASCADE §C2) — *today `stepIndices` is emitted empty; this is a gap.*

## 8. Cascade validator pass

- **REQ-CAS-VALID-EXCLUSIVE [NEW]** — THE SYSTEM SHALL verify the
  mutual-exclusivity invariant: no two group lines are permanently co-active when
  the method requires exclusivity. (CASCADE §C7)
- **REQ-CAS-VALID-MEMCOHERENT [NEW]** — THE SYSTEM SHALL verify the memory count
  is coherent with the group count (`Nm = NG − 1`) and that every memory
  references existing lines/sensors. (CASCADE §C3)
- **REQ-CAS-VALID-TRANSITION [NEW]** — THE SYSTEM SHALL verify every group
  transition has a valid, producible activation condition. (CASCADE §C5)
- **REQ-CAS-VALID-CONNECTED [EXISTS]** — THE SYSTEM SHALL verify every pilot is
  driven and every connection references existing components/ports (reuse the
  generic validator). (RULES §4)

## 9. Layout (geometry only)

- **REQ-CAS-LAYOUT [NEW]** — THE SYSTEM SHALL lay out the cascade pneumatic
  circuit deterministically, grouping the pressure lines and memory-valve chain
  spatially, without writing geometry back into the logical circuit. (design §6)
- **REQ-CAS-LAYOUT-NOLOGIC [NEW]** — THE SYSTEM SHALL compute layout from the
  circuit graph alone and never decide logic in the layout engine. (design §1)

## 10. SVG renderer

- **REQ-CAS-SVG [NEW]** — THE SYSTEM SHALL render a validated cascade pneumatic
  `Circuit` to an SVG **string** (no DOM), drawing cylinders, main 5/2 valves,
  memory valves, the group pressure lines, sensors, and the supply/start
  element. (design §7)
- **REQ-CAS-SVG-REFUSE [EXISTS]** — WHEN asked to render an unvalidated/invalid
  circuit, THE SYSTEM SHALL refuse (throw `RenderRefusedError`) and SHALL NOT
  draw. (design §1, existing renderer guard)
- **REQ-CAS-SVG-CLEAN [NEW]** — THE SYSTEM SHALL produce SVG free of `NaN`,
  `undefined`, and `null` and SHALL escape XML characters. (existing renderer
  invariant)

## 11. Chronological explanation

- **REQ-CAS-EXPLAIN [PARTIAL]** — THE SYSTEM SHALL derive an ordered,
  human-readable explanation of the cascade circuit (Grupo I / Grupo II …,
  movements, `Nm`) from the logical model, in the style of the course. (design
  §8, RULES §10) — *a basic Grupo-listing explanation exists in
  `toCascadeCircuit`; a chronological line-switching narrative (line pressurizes
  → movement → sensor → memory set → next line) is the missing part.*
- **REQ-CAS-EXPLAIN-CHRONO [NEW]** — THE SYSTEM SHALL present the explanation in
  **cycle order** including the group-to-group switching events (activation
  sensor trips → memory set → previous memory reset → next line live), matching
  `cascadeExecutionOrder`. (CASCADE §C4.2, §C5)

## 12. Pipeline wiring and UI option

- **REQ-CAS-PIPELINE [PARTIAL]** — THE SYSTEM SHALL expose the cascade method
  through the pure `generate()` pipeline so the UI can request `method:
  'cascade'` and receive the pneumatic SVG, funcionamento, components, and
  verification. (design §2) — *`generate()` already routes `method === 'cascade'`
  to `solveCascade`/`toCascadeCircuit`; it currently renders no cascade SVG
  because REQ-CAS-SVG is not yet done.*
- **REQ-CAS-UI [NEW]** — THE SYSTEM SHALL keep the `Cascata` method selectable in
  the best-effort UI and route it through the pipeline facade only. (README UI
  section)

## 13. Property invariants (tested with the hand-rolled generator)

- **REQ-CAS-PROP-NOCONFLICT [NEW]** — FOR ALL generated valid sequences, no group
  SHALL contain the same actuator with both signs. (CASCADE §C2.1)
- **REQ-CAS-PROP-COVER [NEW]** — FOR ALL generated valid sequences, every
  movement SHALL appear exactly once across the groups. (CASCADE §C2)
- **REQ-CAS-PROP-ORDER [NEW]** — FOR ALL generated valid sequences,
  `cascadeExecutionOrder` SHALL equal the original movement order. (CASCADE
  §C4.2)
- **REQ-CAS-PROP-TRANSITION [NEW]** — FOR ALL generated multi-group sequences,
  every group transition SHALL have a valid activation sensor. (CASCADE §C5)
- **REQ-CAS-PROP-MEMCOHERENT [NEW]** — FOR ALL generated valid sequences,
  `numberOfMemories == max(0, numberOfGroups − 1)`. (CASCADE §C3)
- **REQ-CAS-PROP-EXCLUSIVE [NEW]** — FOR ALL generated multi-group sequences, no
  two group lines SHALL be permanently co-active. (CASCADE §C7)

## 14. Environment constraints (non-functional)

- **REQ-CAS-ENV-NODE22 [EXISTS]** — THE SYSTEM SHALL run under Node v22 native TS
  type-stripping (no `enum`/`namespace`/decorators/parameter properties; `.ts`
  import extensions) with zero npm dependencies. (RULES/README)
- **REQ-CAS-ENV-TEST [EXISTS]** — THE SYSTEM SHALL be tested with `node --test`;
  a task is done only when its tests pass, not merely when it type-checks.
  (README)
