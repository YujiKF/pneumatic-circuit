# Requirements — PMR3407 Pneumatic Circuit Generator

Testable requirements in EARS style ("WHEN … THE SYSTEM SHALL …"). Each
requirement is traceable to `docs/PMR3407_RULES.md` and to a test. Quality
priority (highest first): **1) logical correctness, 2) adherence to PMR3407
methods, 3) testability, 4) code clarity, 5) visual appearance.**

Legend: **[F1]** = delivered in FEAT-001; **[F2+]** = later feature.

---

## 1. Parsing and normalization

- **REQ-PARSE-COMPACT [F1]** — WHEN the input is a compact sequence such as
  `A+B+A-B-`, THE SYSTEM SHALL parse it into an ordered `SequenceModel`.
- **REQ-PARSE-DIALECTS [F1]** — WHEN the same sequence is given as compact
  (`A+B+A-B-`), space-separated (`A+ B+ A- B-`), semicolon-separated
  (`A+;B+;A-;B-`), or lowercase (`a+b+a-b-`), THE SYSTEM SHALL produce an
  **identical canonical `SequenceModel`** for all four.
- **REQ-PARSE-LOWERCASE [F1]** — WHEN actuator letters are lowercase, THE
  SYSTEM SHALL normalize them to uppercase.
- **REQ-PARSE-TIMER [F1]** — WHEN a movement or group is preceded by `T`, THE
  SYSTEM SHALL mark the resulting step with `hasTimer = true` and SHALL NOT
  invent a numeric delay.
- **REQ-PARSE-GROUP [F1]** — WHEN movements are wrapped in parentheses (e.g.
  `(A-B-)`), THE SYSTEM SHALL place all of them as simultaneous movements in a
  **single step**.
- **REQ-PARSE-CANONICAL [F1]** — THE SYSTEM SHALL expose a whitespace-free
  canonical string and SHALL order movements inside a group alphabetically so
  that equivalent inputs canonicalize identically.
- **REQ-PARSE-RESULT [F1]** — WHEN a parse error occurs, THE SYSTEM SHALL
  return a `Result` error (code + message) and SHALL NOT throw.

### Rejections (each with a specific, useful message)

- **REQ-PARSE-REJECT-DOUBLESIGN [F1]** — WHEN the input is `A++`, THE SYSTEM
  SHALL reject it with code `PARSE_DOUBLE_SIGN`.
- **REQ-PARSE-REJECT-NODIR [F1]** — WHEN the input is `AB+`, THE SYSTEM SHALL
  reject it with code `PARSE_DOUBLE_ACTUATOR`.
- **REQ-PARSE-REJECT-TRAILING [F1]** — WHEN the input is `A+X`, THE SYSTEM SHALL
  reject it with code `PARSE_MISSING_DIRECTION`.
- **REQ-PARSE-REJECT-DANGLING [F1]** — WHEN the input is `++B`, THE SYSTEM SHALL
  reject it with code `PARSE_DANGLING_SIGN`.
- **REQ-PARSE-REJECT-PARENS [F1]** — WHEN parentheses are unbalanced, THE SYSTEM
  SHALL reject with code `PARSE_UNBALANCED_PARENS`.
- **REQ-PARSE-REJECT-EMPTYGROUP [F1]** — WHEN a group is empty `()`, THE SYSTEM
  SHALL reject with code `PARSE_EMPTY_GROUP`.
- **REQ-PARSE-REJECT-DANGLINGTIMER [F1]** — WHEN a timer `T` has no following
  movement, THE SYSTEM SHALL reject with code `PARSE_DANGLING_TIMER`.
- **REQ-PARSE-REJECT-DUPGROUP [F1]** — WHEN one actuator appears twice in a
  simultaneous group, THE SYSTEM SHALL reject with code
  `PARSE_DUPLICATE_IN_GROUP`.
- **REQ-PARSE-REJECT-CHAR [F1]** — WHEN an illegal character appears, THE SYSTEM
  SHALL reject with code `PARSE_INVALID_CHARACTER` and report its position.
- **REQ-PARSE-REJECT-EMPTY [F1]** — WHEN the input is empty/blank, THE SYSTEM
  SHALL reject with code `PARSE_EMPTY`.

## 2. Actuator detection and initial state

- **REQ-ACTUATORS [F1]** — WHEN a sequence is parsed, THE SYSTEM SHALL
  auto-detect the distinct actuators, de-duplicated and sorted alphabetically.
- **REQ-INITIAL-DEFAULT [F1]** — WHEN no initial state is supplied, THE SYSTEM
  SHALL default every detected actuator to `retracted` and SHALL represent this
  explicitly (never assume it silently).
- **REQ-INITIAL-OVERRIDE [F1]** — WHEN an initial state override is supplied,
  THE SYSTEM SHALL apply it per actuator and default the rest to `retracted`.

## 3. Domain model

- **REQ-DOMAIN-TYPES [F1]** — THE SYSTEM SHALL express the domain (`Sequence`,
  `Movement`, `Cylinder`, `Sensor`, `DirectionalValve`, `Relay`, `Contact`,
  `Coil`, `Memory`, `Step`, `CascadeGroup`, `Connection`, `Circuit`) as
  interfaces + string-literal union types.
- **REQ-DOMAIN-NOENUM [F1]** — THE SYSTEM SHALL NOT use TypeScript `enum`,
  `namespace`, parameter properties, or decorators (Node v22 strip-only).
- **REQ-DOMAIN-NODEPS [F1]** — THE SYSTEM SHALL have zero third-party runtime or
  dev dependencies.
- **REQ-CONNECTION-SHAPE [F1]** — THE SYSTEM SHALL model a `Connection` with
  `sourceComponent`, `sourcePort`, `targetComponent`, `targetPort`, and
  `signalType`.

## 4. Step interpretation

- **REQ-STEP-MULTI [F1]** — THE SYSTEM SHALL allow a step to contain more than
  one movement (simultaneous group).
- **REQ-STEP-ORDER [F1]** — THE SYSTEM SHALL preserve step order as given.

## 5. Step-by-step method (first milestone) [F2+]

- **REQ-SBS-MEMORY [F2+]** — THE SYSTEM SHALL create one memory per step.
- **REQ-SBS-SET [F2+]** — WHEN the previous step's memory is active AND the
  previous movement's sensor is tripped, THE SYSTEM SHALL set the current step's
  memory.
- **REQ-SBS-RESET [F2+]** — WHEN a step's memory is set, THE SYSTEM SHALL reset
  the previous step's memory.
- **REQ-SBS-SEAL [F2+]** — THE SYSTEM SHALL include a seal/hold (SELO) contact
  so a step remains active after the actuator leaves the triggering sensor; a
  missing/mis-placed seal SHALL be detectable by a test.
- **REQ-SBS-ARMLAST [F2+]** — THE SYSTEM SHALL arm the last step's line with an
  extra rung so single/continuous cycling starts correctly.

## 6. Cascade method [F2+]

- **REQ-CASCADE-GROUPS [F2+]** — THE SYSTEM SHALL divide the sequence into
  groups such that no group contains one actuator moving in both directions.
- **REQ-CASCADE-ONEHOT [F2+]** — THE SYSTEM SHALL keep exactly one group line
  pressurized at a time; the last event of a group SHALL activate the next
  group line and reset the current one.
- **REQ-CASCADE-MERGE [F2+]** — THE SYSTEM SHALL merge the last group into the
  first only if the merged group has no actuator with both signs (see RULES
  §A3).

## 7. Method separation and pipeline

- **REQ-PIPELINE [F1 (contract) / F2+ (impl)]** — THE SYSTEM SHALL implement the
  pipeline Input → Parser → SequenceModel → MethodSolver → CircuitLogicalModel →
  Validator → LayoutEngine → SVGRenderer → Simulator.
- **REQ-RENDERER-NOLOGIC [F2+]** — THE SYSTEM SHALL ensure the renderer never
  decides logic; it only draws an already-validated `Circuit`.
- **REQ-DOMAIN-SEP [F2+]** — THE SYSTEM SHALL keep pneumatic and
  electropneumatic circuits as distinct `CircuitDomain` outputs.

## 8. Validation [F2+]

- **REQ-VALID-NODUP-SENSOR [F2+]** — THE SYSTEM SHALL reject two sensors at the
  same (actuator, end-position) (RULES §4, "não usar dois sensores na mesma
  posição").
- **REQ-VALID-OVERLAP [F2+]** — THE SYSTEM SHALL detect signal overlap and
  require a method (cascade/step-by-step) that resolves it for indirect
  sequences.
- **REQ-VALID-CONNECTED [F2+]** — THE SYSTEM SHALL verify every pilot/coil is
  driven and every connection references existing components/ports.
- **REQ-VALID-RETURN [F2+]** — THE SYSTEM SHALL verify the cycle returns to its
  initial state.

## 9. Cycle mode [F2+]

- **REQ-CYCLE-SINGLE [F2+]** — WHEN single-cycle mode is selected, THE SYSTEM
  SHALL require a new start to repeat.
- **REQ-CYCLE-CONT [F2+]** — WHEN continuous mode is selected, THE SYSTEM SHALL
  loop the last step back to the first.

## 10. Explanation [F2+]

- **REQ-EXPLAIN [F2+]** — THE SYSTEM SHALL derive an ordered, human-readable
  explanation of the generated circuit from the logical model.

## 11. Property invariants (tested with a hand-rolled generator) [F1]

- **REQ-PROP-DIALECT [F1]** — FOR ALL generated valid sequences, THE SYSTEM
  SHALL produce the same canonical model across all accepted dialects.
- **REQ-PROP-ROUNDTRIP [F1]** — FOR ALL generated valid sequences, re-parsing
  the canonical string SHALL yield the same canonical string (idempotence).
- **REQ-PROP-ACTCOVER [F1]** — FOR ALL generated valid sequences, detected
  actuators SHALL equal the ground-truth actuator set.

## 12. Environment constraints (non-functional)

- **REQ-ENV-NODE22 [F1]** — THE SYSTEM SHALL run under Node v22 native TS
  type-stripping with no bundler.
- **REQ-ENV-TEST [F1]** — THE SYSTEM SHALL be tested with `node --test`
  (`node:test` + `node:assert/strict`).
- **REQ-ENV-DONE [F1]** — A task SHALL be considered done only when its tests
  pass, not merely when it type-checks.
