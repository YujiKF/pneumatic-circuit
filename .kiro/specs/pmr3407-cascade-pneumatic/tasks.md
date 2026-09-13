# Tasks — Milestone 2: Cascade Pneumatic (Cascata Pneumática)

Ordered implementation plan for the **pneumatic cascade** method. **A task is
DONE only when its tests pass** (`node --test` green), not merely when
`tsc --noEmit` succeeds. Each task cites the requirements
([`requirements.md`](./requirements.md)) it satisfies and notes whether existing
code already partially satisfies it (see [`design.md`](./design.md) §9 gap
analysis).

The order follows the course construction steps (CASCADE §C5.3: divide → lines +
memories → actuators + main valves → sensors 4a/4b → test) and the gap analysis.

Status legend: `[x]` done, `[~]` partially done by existing code (verify /
complete), `[ ]` pending. Run `unset NODE_OPTIONS` before `node`/`tsc`.

---

## 2.0 Baseline verification (environment)

- [ ] **2.0 Confirm baseline green.** Run `npm run typecheck` and `npm test`;
  confirm `tsc --noEmit` is clean and the current suite (incl. the existing
  cascade tests) passes. Record the pass count. No code change. (REQ-CAS-ENV-*)

## 2.1 Formalize / verify group division against goldens

- [~] **2.1a Verify the existing division** in `src/engine/cascade/groups.ts`
  against `tests/engine/cascade-groups.test.ts` (merge `A+A-A+`, non-merge
  `A+B+B-A-`, 4-group `A+B-B+T(A-B-)B+`, single-group, order preservation). No
  logic change expected; confirm it matches CASCADE §C2-§C4.
  (REQ-CAS-DIV-*, REQ-CAS-MERGE*, REQ-CAS-LINES, REQ-CAS-MEMCOUNT)
- [ ] **2.1b Add the deck-4 p.65 golden** `A+B+D-A-B-C+C-D+`: assert the
  pre-merge 3-group division `[A+ B+ D-] [A- B- C+] [C- D+]` and the algorithm's
  real merge outcome (NO merge, D wraps with both signs). Document the divergence
  from the deck's manual "1 2 1" per [`golden-tests.md`](./golden-tests.md) G5.
  (REQ-CAS-MERGE-DECK)
- [ ] **2.1c Add the user example golden** `A+B+A-B-` (G1) at the logical level
  (groups `[A+ B+] [A- B-]`, `Nm=1`). (REQ-CAS-DIV-RULE)

## 2.2 CascadePlan / model completeness

- [~] **2.2a Reconcile the model** in `src/engine/cascade/model.ts` /
  `solver.ts` with the `CascadePlan` view (design §3). No new type; confirm
  `groups`/`groupLines`/`valves`/`sensors`/`memories` map as documented.
  (REQ-CAS-* model)
- [ ] **2.2b Add a derived `transitions` view** (`CascadeTransition` with
  `fromGroup`, `toGroup`, `memoryId`, `conditionSensorIds`) computed in
  `solver.ts`. For a simultaneous-group predecessor, `conditionSensorIds` SHALL
  list the arrival sensors of **all** members, not only the last-listed one.
  Test on G4 (`A+B-B+T(A-B-)B+`): G4's transition condition includes both `1S1`
  and `2S1`. (REQ-CAS-TRANSITION-COND, CASCADE §C5.2)
- [ ] **2.2c Populate `CascadeGroup.stepIndices`** in
  `src/engine/cascade/circuit.ts` (`toCascadeGroups`), currently emitted empty,
  so the layout/renderer can label groups. Test that each group's `stepIndices`
  matches the division. (REQ-CAS-CIRCUIT-GROUPS)

## 2.3 Cascade validator pass

- [ ] **2.3a Cascade-specific checks** (extend `src/validator/` or add a cascade
  pass consumed by `validateCircuit`): mutual exclusivity (one line at a time,
  §C7), memory-count coherence (`Nm = NG − 1`, §C3), and every transition has a
  producible activation condition (§C5). Tests assert the pass flags a
  hand-mutated model (e.g. a memory that activates and deactivates the same line,
  or `Nm` inconsistent with `NG`) and accepts all goldens. (REQ-CAS-VALID-*)
- [~] **2.3b Confirm the generic validator** still accepts every golden circuit
  with zero issues (already asserted in `tests/golden/cascade.golden.test.ts`).
  (REQ-CAS-VALID-CONNECTED)

## 2.4 Pneumatic circuit projection completeness

- [~] **2.4a Verify `toCascadeCircuit`** emits the full pneumatic structure
  (cylinders, main 5/2 valves, `Nm` memory valves, sensors, supply, both pilots
  tied) and validates clean for G1-G5. Close any projection gap surfaced by the
  new goldens/validator (design §9 items 1-2). (REQ-CAS-CIRCUIT,
  REQ-CAS-MAINVALVE, REQ-CAS-MEMVALVE, REQ-CAS-SENSOR-*)
- [ ] **2.4b Golden circuit assertions** for G1 and G5 at the circuit level
  (component counts, memory set/reset sensors, line→line memory mapping),
  mirroring the existing G2/G3/G4 assertions. (REQ-CAS-CIRCUIT)

## 2.5 Layout (geometry only)

- [ ] **2.5 Cascade layout** in `src/layout/`: place group pressure-line buses
  stacked by group number, the memory-valve chain between supply and lines, and
  cylinders + main valves in a row; route intra-group sensors between a line and
  its main-valve pilot. Geometry only, no logic; layout recomputable from the
  graph alone. Tests: determinism (same input → same `LayoutResult`), full
  placement (every component placed), non-overlap. (REQ-CAS-LAYOUT,
  REQ-CAS-LAYOUT-NOLOGIC)

## 2.6 SVG renderer (cascade pneumatic)

- [ ] **2.6 Cascade pneumatic SVG** in `src/renderer/pneumatic`: draw cylinders,
  main 5/2 valves, memory valves `M1..Nm`, group buses `L1..Ln`, supply/start,
  and sensors, from a **validated** `Circuit`, returning an SVG **string** (no
  DOM). Reuse the guard: refuse invalid circuits (`RenderRefusedError`). Tests:
  structural facts (buses/memories/cylinders present; group labels), refusal on
  an invalid circuit, and no `NaN`/`undefined`/`null` + XML-escaped output.
  (REQ-CAS-SVG, REQ-CAS-SVG-REFUSE, REQ-CAS-SVG-CLEAN)

## 2.7 Chronological explanation

- [~] **2.7a Keep the group listing** golden (`Grupo I / … / Nm = k`) in
  `tests/golden/cascade.golden.test.ts` passing. (REQ-CAS-EXPLAIN)
- [ ] **2.7b Add the chronological narrative** derived from the logical model +
  `cascadeExecutionOrder`: line 1 pressurized → movements with intra-group
  sensors → last event trips activation sensor → memory set → previous memory
  reset → next line live → … → wrap to line 1. Test that the narrative order
  equals `cascadeExecutionOrder` and names each memory set/reset in cycle order.
  (REQ-CAS-EXPLAIN-CHRONO, CASCADE §C4.2/§C5)

## 2.8 Pipeline wiring + UI option

- [~] **2.8a Confirm `generate()`** routes `method:'cascade'` to
  `solveCascade`/`toCascadeCircuit` and, once 2.6 lands, returns the cascade
  `pneumaticSvg` and the chronological `funcionamento`. Test through the pipeline
  facade. (REQ-CAS-PIPELINE)
- [ ] **2.8b Keep `Cascata` selectable in the UI** and routed only through the
  pipeline facade (best-effort; not runnable in the sandbox). Documentation-level
  confirmation. (REQ-CAS-UI)

## 2.9 Property tests

- [ ] **2.9 Add the six property tests** under `tests/properties/` using the
  existing hand-rolled `Rng`/`forAll`/shrinker (no new deps): P1 no-conflict,
  P2 exactly-once coverage, P3 order preservation, P4 valid transition,
  P5 memory-count coherence, P6 mutual exclusivity. See
  [`golden-tests.md`](./golden-tests.md) §3. (REQ-CAS-PROP-*)

## 2.10 Final verification

- [ ] **2.10 Full green.** `npm run typecheck` clean AND `npm test` green
  (all new cascade goldens + property tests + existing suite). Confirm no
  regression in the Milestone-1 tests. (REQ-CAS-ENV-*)

---

## Task ↔ requirement traceability (summary)

| Task  | Key requirements                                             | Existing? |
| ----- | ----------------------------------------------------------- | --------- |
| 2.1   | REQ-CAS-DIV-*, MERGE*, LINES, MEMCOUNT, MERGE-DECK           | mostly    |
| 2.2   | REQ-CAS model, TRANSITION-COND, CIRCUIT-GROUPS              | partial   |
| 2.3   | REQ-CAS-VALID-*                                             | new       |
| 2.4   | REQ-CAS-CIRCUIT, MAINVALVE, MEMVALVE, SENSOR-*             | mostly    |
| 2.5   | REQ-CAS-LAYOUT*                                             | new       |
| 2.6   | REQ-CAS-SVG*                                                | new       |
| 2.7   | REQ-CAS-EXPLAIN*                                            | partial   |
| 2.8   | REQ-CAS-PIPELINE, UI                                        | partial   |
| 2.9   | REQ-CAS-PROP-*                                              | new       |
