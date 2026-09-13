# Design — Milestone 2: Cascade Pneumatic (Cascata Pneumática)

This design realizes [`requirements.md`](./requirements.md) and the rules in
[`docs/PMR3407_CASCADE_RULES.md`](../../../docs/PMR3407_CASCADE_RULES.md)
(companion to [`docs/PMR3407_RULES.md`](../../../docs/PMR3407_RULES.md)). It is
deterministic (no LLM at runtime): the same input always produces the same
cascade circuit.

It is written to be **consistent in style and layering** with the Milestone-1
design (`../pmr3407-pneumatic-circuit-generator/design.md`) and it **reconciles**
with the cascade code an earlier build already produced under
`src/engine/cascade/`. The cascade code is treated as a **candidate the spec
formalizes and that later tasks verify/complete**, not a design to re-invent.

## 1. Guiding principles

1. **Logical correctness first**, then PMR3407 adherence, then testability, then
   clarity, then appearance.
2. **Interface-independent core.** The cascade solver knows nothing about
   React/SVG; it is testable from `node --test`.
3. **The renderer never decides logic.** The cascade solver produces a fully
   specified logical model; layout/rendering only add geometry/pixels and refuse
   to draw an invalid circuit.
4. **The group division is testable independently of the drawing** (a user
   requirement, already honored by `tests/engine/cascade-groups.test.ts`).
5. **Explicit over implicit.** Initial state and merge/edge conventions are
   explicit (CASCADE §C4/§C6, RULES §A3).

## 2. Pipeline

```
 raw text
    │
    ▼
┌─────────┐   ┌───────────────┐   ┌───────────────┐   ┌────────────────────────┐
│ Parser  │──▶│ SequenceModel │──▶│ CascadeSolver │──▶│ CascadeLogicalModel      │
│(existing)│  │  (existing)   │   │ divideIntoGroups│  │  == the CascadePlan     │
└─────────┘   └───────────────┘   │  + solveCascade │  └──────────┬─────────────┘
                                   └───────────────┘             │
                                                                 ▼
                                              ┌───────────────┐  toCascadeCircuit
                                              │ flat Circuit  │◀────────────────┘
                                              └──────┬────────┘
                                                     ▼
                        ┌────────────┐   ┌──────────────┐   ┌───────────────┐
                        │ Validator  │──▶│ LayoutEngine │──▶│ SVGRenderer    │
                        │(+cascade   │   │ (cascade     │   │ (cascade       │
                        │  pass)     │   │  layout)     │   │  pneumatic)    │
                        └────────────┘   └──────────────┘   └──────┬────────┘
                                                                    ▼
                                                          ┌───────────────────┐
                                                          │ Explanation       │
                                                          │ (chronological)   │
                                                          └───────────────────┘
```

| Stage         | Responsibility                                                                   | State       |
| ------------- | -------------------------------------------------------------------------------- | ----------- |
| Parser        | text → canonical `SequenceModel` (reused as-is)                                  | EXISTS      |
| CascadeSolver | `SequenceModel` → `CascadeLogicalModel` (groups, lines, memories, sensors)        | EXISTS/PARTIAL |
| Projection    | `CascadeLogicalModel` → flat `Circuit` for the validator/layout                   | PARTIAL     |
| Validator     | generic checks + a **cascade-specific pass** (exclusivity, `Nm`, transitions)     | PARTIAL/NEW |
| LayoutEngine  | geometry for the cascade diagram (lines + memory chain), no logic                 | NEW         |
| SVGRenderer   | draw a validated cascade `Circuit` as an SVG string; refuse if invalid            | NEW         |
| Explanation   | chronological narrative from the logical model (`cascadeExecutionOrder`)          | PARTIAL/NEW |
| Pipeline/UI   | route `method:'cascade'` through `generate()` and the UI facade                   | PARTIAL/NEW |

`generate()` in `src/pipeline.ts` **already** routes `method === 'cascade'` to
`solveCascade` + `toCascadeCircuit`; the missing pieces are the cascade SVG,
the cascade validator pass, and the chronological explanation.

## 3. The `CascadePlan` logical shape (reconciled with `CascadeLogicalModel`)

The user sketched a conceptual `CascadePlan`:

```
CascadePlan { groups, groupLines, transitions, valves, sensors, memories, connections }
```

**Decision: `CascadePlan` is NOT a new type.** It is a *conceptual view* that the
existing `CascadeLogicalModel` (`src/engine/cascade/model.ts`) already realizes,
with one small enrichment and one derived accessor. Mapping the user's fields to
the real model:

| `CascadePlan` field | Realized by (existing)                                              | Gap |
| ------------------- | ------------------------------------------------------------------- | --- |
| `groups`            | `CascadeLogicalModel.groups: CascadeGroupModel[]` (number, movements)| —   |
| `groupLines`        | `CascadeGroupModel.lineId` (`"L1".."Ln"`), one per group             | —   |
| `transitions`       | `CascadeGroupModel.activationSensorId` + `CascadeMemoryValve` pair   | needs an explicit `transitions` accessor for clarity/tests |
| `valves`            | `pneumatic.valves` (main 5/2) + `memories[].valveId` (memory 5/2)    | —   |
| `sensors`           | `sensorIds` + per-movement `startSensorId`/`arrivalSensorId`         | —   |
| `memories`          | `memories: CascadeMemoryValve[]` (set/reset sensor, activates/deactivates line) | — |
| `connections`       | produced by `toCascadeCircuit` (projection), not stored on the model | intentionally derived, not stored |

So the "logical representation independent of the SVG" the user asked for
**already exists** as `CascadeLogicalModel`, and the renderer only ever consumes
the flat `Circuit` projected from it. The one recommended enrichment is a derived
`transitions` view (see §4) so tests and the explanation can talk about
group-to-group switching as first-class objects without re-deriving them.

Reconciliation with the **division** layer:

- `divideIntoGroups(sequence, {mergeLastIntoFirst})` → `GroupDivision` with
  `DividedGroup[]` (`number`, `stepIndices`, `movements`, `mergedTailCount`),
  `numberOfGroups`, `numberOfMemories`, `merged`.
- `cascadeExecutionOrder(division)` reconstructs physical order after a
  last-into-first merge (guarantees order preservation, CASCADE §C4.2).
- `solveCascade` consumes the division and produces the `CascadeLogicalModel`
  (the `CascadePlan`). This split (pure division ↔ full model) is exactly what
  lets the group result be tested independently of the drawing.

## 4. Cascade solver design (`src/engine/cascade/`)

- **`groups.ts` (EXISTS, ~246 lines):** the left-to-right division, the merge
  optimization, and `cascadeExecutionOrder`. Keep as-is; Milestone-2 verifies it
  against the goldens and adds the deck-4 p.65 merge golden.
- **`model.ts` (EXISTS, ~105 lines):** `CascadeMovement` (pilotPort 12/14,
  mainValveId, optional intra-group `startSensorId`, `arrivalSensorId`),
  `CascadeGroupModel` (number, lineId, movements, optional
  `activationSensorId`), `CascadeMemoryValve` (id, valveId, set/reset sensor,
  activates/deactivates line), `CascadeLogicalModel`. **Enrichment:** add a
  derived `transitions` accessor/type, e.g.

  ```
  CascadeTransition {
    fromGroup: number; toGroup: number;
    memoryId: string;
    conditionSensorIds: string[];   // ALL predecessor-arrival sensors (C5.2)
  }
  ```

  computed from `groups`/`memories`. It makes REQ-CAS-TRANSITION-COND and the
  chronological explanation testable, and fixes the simultaneous-group gating so
  the condition lists **all** members, not just the last-listed one.
- **`solver.ts` (EXISTS, ~243 lines):** builds groups/memories/pneumatic/sensor
  ids. Keep; extend to populate the `transitions` view and the full
  `conditionSensorIds` set for simultaneous predecessors.
- **`circuit.ts` (EXISTS, ~256 lines):** projection to the flat `Circuit`. Keep
  the structural approach; close the projection gaps (see §9): populate
  `CascadeGroup.stepIndices`, and confirm both-pilot completion is
  faithful rather than a filler.

## 5. Projection to the flat `Circuit` (validator/layout input)

The projection (`toCascadeCircuit`) emits, purely structurally:

- cylinders + their 5/2 double-pilot main valves;
- `Nm` memory valves as 5/2 double-pilot directional valves;
- stroke-end sensors for every referenced sensor id (respecting §4 "no two
  sensors at the same position");
- a supply/start 3/2 spring-return valve feeding the memory chain;
- connections: memory-valve set/reset pilots from activation sensors; group
  pressure lines feeding intra-group sensors; each movement's gated signal to
  the main-valve pilot (12/14); both pilots of every main valve tied off.

Invariant: `validateCircuit(toCascadeCircuit(model)).ok === true` for every
golden (already asserted by `tests/golden/cascade.golden.test.ts`).

## 6. Layout engine (cascade) — NEW

- Reuse the existing pure `src/layout/` engine and its `LayoutResult` shape
  (positions, orientation, orthogonal routing, `byId`, no geometry written back
  to the graph). The layout engine is method-agnostic and today has **no cascade
  awareness** (confirmed: no `cascade`/`groups` references in `src/layout/`).
- Cascade-specific layout requirements: place the **group pressure lines** as
  horizontal buses stacked by group number; place the **memory-valve chain**
  between the supply and the lines; place cylinders + main valves in a row;
  route intra-group sensors between a line and its main-valve pilot. This is
  geometry only (REQ-CAS-LAYOUT-NOLOGIC).
- Determinism, full placement, and non-overlap are unit-tested exactly like the
  Milestone-1 layout tests.

## 7. SVG renderer (cascade pneumatic) — NEW

- Reuse the framework-independent SVG symbol library (`src/renderer/symbols.ts`)
  and the `renderer/pneumatic` entrypoint returning SVG **strings** (no DOM).
- Add cascade drawing: pressure-line buses with labels `L1..Ln`, memory valves
  `M1..Nm` (bistable double-pilot), the supply/start element, cylinders + main
  valves, and sensors. Group labels come from the domain `CascadeGroup`
  aggregate (hence the need to populate `stepIndices`/`lineId`, §9).
- Reuse the renderer **guard** (`src/renderer/guard.ts`): refuse to draw an
  unvalidated/invalid circuit (`RenderRefusedError`). Output must be free of
  `NaN`/`undefined`/`null` and XML-escaped.

## 8. Chronological explanation — PARTIAL → NEW

- Today `toCascadeCircuit` emits a static `Grupo I / Grupo II / … / Nm = k`
  listing (pinned by a golden). Milestone-2 adds a **chronological** narrative
  derived from the same logical model and `cascadeExecutionOrder`:
  line 1 pressurized → first group's movements (with intra-group sensors) →
  last event trips activation sensor → memory `Mk` set → previous memory reset →
  next line live → … → wrap back to line 1. One logic source, no re-derivation.

## 9. What already exists vs what is missing (gap analysis)

Grounded in the real files under `src/engine/cascade/` and `tests/`:

### Already correct / present (verify + pin, do not rebuild)

- **Group division** — `groups.ts::divideIntoGroups` implements the
  same-letter-opposite-sign rule generically; `mergeLastIntoFirst` default on;
  `cascadeExecutionOrder` reconstructs order after merge. Covered by
  `tests/engine/cascade-groups.test.ts` (merge `A+A-A+`, non-merge `A+B+B-A-`,
  4-group `A+B-B+T(A-B-)B+`, single-group, order preservation). **CASCADE §C2,
  §C3, §C4.**
- **Line/memory counts** — `Nm = NG − 1`, one line per group; `numberOfMemories`
  clamped at 0. **CASCADE §C3.**
- **Logical model** — `model.ts` captures groups, lines, memory valves
  (set/reset sensor, activates/deactivates line), intra-group vs activation
  sensors, pilot ports. **CASCADE §C5.**
- **Projection + validation** — `circuit.ts::toCascadeCircuit` produces a flat
  `Circuit` that `validateCircuit` accepts with zero issues for all four current
  goldens (`tests/golden/cascade.golden.test.ts`).
- **Pipeline routing** — `pipeline.ts::generate` already dispatches
  `method:'cascade'` to the cascade solver + projection.

### Missing / incomplete (Milestone-2 work)

1. **`transitions` view + full simultaneous-group gating** — the model records
   only the **last-listed** activation sensor for a simultaneous predecessor
   (mirrors Milestone-1 Obs.3). Add a `transitions` accessor whose
   `conditionSensorIds` lists **all** members. (REQ-CAS-TRANSITION-COND)
2. **`CascadeGroup.stepIndices` is emitted empty** in `toCascadeGroups`
   (`circuit.ts`), so the renderer cannot label groups by their steps. Populate
   it. (REQ-CAS-CIRCUIT-GROUPS)
3. **Cascade validator pass** — a dedicated set of checks: mutual exclusivity
   (§C7), `Nm = NG − 1` coherence, and every transition has a producible
   condition. Today only the generic structural validator runs.
   (REQ-CAS-VALID-*)
4. **Cascade layout** — `src/layout/` has no cascade awareness; add
   group-bus/memory-chain placement. (REQ-CAS-LAYOUT)
5. **Cascade SVG renderer** — `src/renderer/pneumatic` does not draw the cascade
   lines/memories; add it, reusing the guard. (REQ-CAS-SVG)
6. **Chronological explanation** — only a static group listing exists; add the
   cycle-ordered switching narrative. (REQ-CAS-EXPLAIN-CHRONO)
7. **Deck-4 p.65 merge golden** — `A+B+D-A-B-C+C-D+` is not yet pinned.
   (REQ-CAS-MERGE-DECK)
8. **UI wiring for the cascade SVG** — `generate()` returns no `pneumaticSvg`
   for cascade until (5) lands; then surface it through the facade. (REQ-CAS-UI)

## 10. Golden-test plan (summary)

The full per-exercise records and the property list live in
[`golden-tests.md`](./golden-tests.md). Summary: ≥3 chosen cascade exercises
(`A+B+/B-A-`, `B-C+A+B+C-A-` non-trivial, `A+B-B+T(A-B-)B+` non-trivial 4-group),
plus the user's example `A+B+A-B-` and the optional deck-4 p.65 merge case
`A+B+D-A-B-C+C-D+`. Six property tests: no-conflict, exactly-once coverage,
order-preservation, valid-transition, memory-count coherence,
mutual-exclusivity.

## 11. Environment / dependency constraints

Same as Milestone 1: Node v22 native TS strip-only (no `enum`/`namespace`/
decorators/parameter properties; `.ts` import extensions), **zero npm deps**,
`node --test`, `unset NODE_OPTIONS` before running `node`/`tsc`. The UI stays
best-effort (React/Vite not installable in the sandbox). A task is done only when
its tests pass, not merely when it type-checks.
