# Tasks — PMR3407 Pneumatic Circuit Generator

Ordered implementation plan. **A task is DONE only when its tests pass** (`node
--test` green), not merely when `tsc --noEmit` succeeds. Each task cites the
requirements it satisfies.

Status legend: `[x]` done, `[ ]` pending.

## Milestone 0 — Foundation (FEAT-001)

- [x] **0.1 Scaffold** the repo tree (`src/{domain,parser,engine/{intuitive,
  cascade,step-by-step},validator,layout,renderer/{pneumatic,electrical},
  simulator,ui}`, `tests/{parser,engine,golden,properties}`, `docs/`, Kiro
  spec dir).
- [x] **0.2 Config** `package.json` (type=module, private, scripts `typecheck`
  / `test`, no deps) + `tsconfig.json` (nodenext, strict, noEmit,
  allowImportingTsExtensions, verbatimModuleSyntax, isolatedModules,
  skipLibCheck) + `types/node-shims.d.ts` (ambient Node built-ins, since
  `@types/node` cannot be installed). Satisfies REQ-ENV-*.
- [x] **0.3 Rules doc** `docs/PMR3407_RULES.md` with attributions and a
  non-empty Ambiguities section that picks the `.2/.3` and `S1/S2`
  conventions.
- [x] **0.4 Kiro spec** requirements.md (EARS), design.md (domain + pipeline),
  tasks.md (this file).
- [x] **0.5 Domain model** `src/domain/*` as interfaces + unions, no enums;
  explicit `InitialState`. Satisfies REQ-DOMAIN-*, REQ-CONNECTION-SHAPE,
  REQ-INITIAL-*.
- [x] **0.6 Parser** `src/parser/*`: dialects, timers, groups, actuator
  detection, canonicalization, Result-style rejections. Satisfies
  REQ-PARSE-*, REQ-ACTUATORS, REQ-STEP-*.
- [x] **0.7 Parser tests** `tests/parser/*` (accepted formats, timers/groups,
  all four rejection examples, actuator detection) + property helper
  `tests/properties/_arbitrary.ts` + `tests/properties/parser.property.test.ts`.
  Satisfies REQ-PROP-*.
- [x] **0.8 Verify** `tsc --noEmit` exits 0 AND `node --test` passes.

## Milestone 1 — Electropneumatic + Step-by-step end to end (FEAT-002)

- [ ] **1.1 SequenceModel analysis** helpers: direct/indirect classification,
  overlap detection. Tests. (REQ-VALID-OVERLAP)
- [ ] **1.2 Step-by-step solver** `src/engine/step-by-step/`: one memory/step,
  set/reset/seal logic, arm-last-line rung. Produce electropneumatic
  `Circuit`. (REQ-SBS-*)
- [ ] **1.3 Seal-bug test**: a test that FAILS if the SELO seal contact is
  missing or mis-placed (a step drops when the actuator leaves the sensor).
- [ ] **1.4 Validator** `src/validator/`: no duplicate sensors, every coil
  driven, connection endpoints exist, cycle returns home. (REQ-VALID-*)
- [ ] **1.5 Golden tests** `tests/golden/` for the selected step-by-step
  exercises (see below).

## Milestone 2 — Cascade (FEAT-003)

- [ ] **2.1 Group division** `src/engine/cascade/`: no actuator with both signs
  per group; `Nm` memory count; last-into-first merge per RULES §A3. (REQ-CASCADE-*)
- [ ] **2.2 One-hot line logic** + memory reset on group transition.
- [ ] **2.3 Golden tests** for cascade exercises.

## Milestone 3 — Layout, renderer, simulator, UI (FEAT-004)

- [ ] **3.1 LayoutEngine** (geometry only).
- [ ] **3.2 SVGRenderer** pneumatic + electrical (never decides logic).
  (REQ-RENDERER-NOLOGIC)
- [ ] **3.3 Simulator** stepping the runtime state models; verify cycle.
- [ ] **3.4 UI** (React/Vite) — best-effort; documented as un-installable here.

## Selected golden exercises

These worked sequences are pinned as golden tests once the relevant solver
exists (chosen to exercise direct/indirect, timers, and simultaneous groups):

1. `A+B+A-B-` — direct, two cylinders (baseline step-by-step / cascade).
2. `A+B+B-A-` — indirect, classic signal overlap.
3. `B-C+A+B+C-A-` — three cylinders, starts with a retract.
4. `A+B-T(B+C+)C-A-` — timer + simultaneous group.
5. `A+B-B+T(A-B-)B+` — timer before a simultaneous group, repeated actuator.
6. `A+B+C+C-D+D-B-A-` — four cylinders.

Direct/indirect classification pairs from RULES §3 are also pinned as
classifier golden cases.
