# Design — PMR3407 Pneumatic Circuit Generator

This design realizes the requirements in `requirements.md` and the rules in
`../../../docs/PMR3407_RULES.md`. It is deterministic (no LLM at runtime): the
same input always produces the same circuit.

## 1. Guiding principles

1. **Logical correctness first.** The circuit must be functionally correct
   before it is pretty. Priority order: correctness → PMR3407 adherence →
   testability → clarity → appearance.
2. **Interface-independent core.** The domain and solvers know nothing about
   React/SVG. The solver is testable from `node --test` without any UI.
3. **The renderer never decides logic.** Solvers produce a fully-specified
   logical `Circuit`; layout and rendering only add geometry/pixels.
4. **Explicit over implicit.** Initial state, ambiguities, and conventions are
   explicit (see RULES Ambiguities), so behaviour is reproducible.

## 2. Pipeline

```
 raw text
    │
    ▼
┌─────────┐   ┌───────────────┐   ┌──────────────┐   ┌───────────────────────┐
│ Parser  │──▶│ SequenceModel │──▶│ MethodSolver │──▶│ CircuitLogicalModel    │
└─────────┘   └───────────────┘   └──────────────┘   │ (domain `Circuit`)     │
                                                       └───────────┬───────────┘
                                                                   ▼
                                            ┌────────────┐   ┌──────────────┐
                                            │ Validator  │──▶│ LayoutEngine │
                                            └────────────┘   └──────┬───────┘
                                                                    ▼
                                                        ┌──────────────┐   ┌───────────┐
                                                        │ SVGRenderer  │──▶│ Simulator │
                                                        └──────────────┘   └───────────┘
```

| Stage                | Responsibility                                                                                   | Feature |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| Parser               | text → canonical `SequenceModel`; validation; actuator detection; explicit initial state         | F1      |
| MethodSolver         | `SequenceModel` → logical `Circuit` per method (intuitive / cascade / step-by-step)               | F2+     |
| Validator            | structural + rule checks (no duplicate sensors, overlap resolved, cycle returns home, wiring)     | F2+     |
| LayoutEngine         | assign coordinates to components/connections (no logic)                                          | F2+     |
| SVGRenderer          | draw a validated `Circuit` (pneumatic + electrical); never decides logic                          | F2+     |
| Simulator            | step the runtime state models forward; verify the sequence executes                              | F2+     |

Each solver is an independent module under `src/engine/{intuitive,cascade,
step-by-step}/` that receives a normalized `SequenceModel` and returns a
`Circuit`.

## 3. Domain model

All types are **interfaces + string-literal unions** — **no `enum`**, no
`namespace`, no parameter properties, no decorators (Node v22 strip-only). All
relative imports use explicit `.ts` extensions.

### 3.1 Sequence layer (`src/domain/sequence.ts`)

- `Direction = '+' | '-'`
- `Movement { actuator: ActuatorId; direction: Direction }`
- `Step { index: number; movements: Movement[]; hasTimer: boolean }` — a step
  carries **one or more** simultaneous movements.
- `SequenceModel { steps; actuators; initialState; canonical }`
- `RestState = 'retracted' | 'extended'`
- `InitialState { positions: Record<ActuatorId, RestState> }` — explicit,
  default all-retracted, overridable (see `initial-state.ts`).

### 3.2 Component layer (`src/domain/components.ts`)

- `Cylinder { kind:'cylinder'; id; actuator }` — id like `1.0`.
- `Sensor { kind:'sensor'; id; actuator; position:'retracted'|'extended' }` —
  id like `1.2`/`1.3` (pneumatic) or `1S1`/`1S2` (electric).
- `DirectionalValve { kind:'directional-valve'; id; valveType; actuation;
  actuator? }` — id like `1.1`; `valveType ∈ '3/2'|'5/2'|'5/3'`;
  `actuation ∈ 'spring-return'|'single-pilot'|'double-pilot'`.
- `Relay { kind:'relay'; id; relayKind:'control'|'counter'|'timer';
  delaySeconds? }` — `K1`, `KC`, boxed-delay timer.
- `Coil { kind:'coil'; id; relayId }`.
- `Contact { kind:'contact'; id; contactType:'NO'|'NC'; ownerId }`.
- `Memory { kind:'memory'; id; sealed }` — bistable; `sealed` marks the SELO
  hold.
- `CascadeGroup { number; stepIndices; lineId }`.
- `Connection { sourceComponent; sourcePort; targetComponent; targetPort;
  signalType:'pneumatic'|'electric' }`.
- `Circuit { domain:'pneumatic'|'electropneumatic'; method; components;
  connections; groups; explanation }`.

### 3.3 Runtime state models (for the Simulator, F2+)

- `CylinderState = 'RETRACTED' | 'MOVING_FORWARD' | 'EXTENDED' | 'MOVING_BACKWARD'`
- `RelayState = 'ON' | 'OFF'`
- `SensorState = 'ACTIVE' | 'INACTIVE'`
- `ValveState = 'STATE_1' | 'STATE_2'`

### 3.4 Result type (`src/domain/result.ts`)

`Result<T> = Ok<T> | Err`, with `DomainError { code; message; position? }`.
Parsing and validation return `Result` instead of throwing for expected errors.

## 4. Parser design (`src/parser/`, F1)

- `tokenizer.ts` — lexical pass. Emits `actuator | sign | timer | lparen |
  rparen` tokens; whitespace and `;` are separators only; illegal characters
  are rejected with position. `T`/`t` is the reserved timer marker (RULES §A5).
- `parser.ts` — structural pass. Consumes tokens into ordered `Step`s handling
  timers and groups; validates (double sign, missing/duplicate direction,
  unbalanced/empty/nested parens, dangling timer, duplicate in group);
  auto-detects actuators; attaches explicit `InitialState`; produces the
  canonical string with alphabetical group ordering.
- `errors.ts` — stable error-code constants (`as const`, not enum).

## 5. Method solvers (F2+)

- **Step-by-step (first milestone):** one memory per step; set condition = prev
  memory active AND prev movement sensor tripped; setting resets prev memory;
  each memory has a **SELO seal** contact; an extra rung arms the last line.
  The missing/mis-placed-seal bug MUST be catchable by a test.
- **Cascade:** group division (no actuator with both signs per group), one-hot
  group lines, last-into-first merge per RULES §A3.
- **Intuitive:** 5-phase direct chaining, valid only when no overlap.

## 6. Testing strategy

- `node --test` on `tests/**/*.test.ts` and `src/**/*.test.ts`. Tests are `.ts`
  run directly by Node v22.
- Golden tests (`tests/golden/`, F2+) pin exact `Circuit` outputs for selected
  worked exercises.
- Property tests (`tests/properties/`) use a hand-rolled `Rng` + `forAll` +
  shrinker (`_arbitrary.ts`) because fast-check cannot be installed.

## 7. Environment / dependency constraints

- **No npm registry** (INTEGRATIONS_ONLY → 403). The core has **zero** npm
  dependencies; only globally-preinstalled `tsc`/`prettier`/`eslint` + Node
  built-ins are used. `@types/node` is unavailable, so minimal ambient
  declarations for the used Node built-ins live in `types/node-shims.d.ts`.
- **Node v22 native TS (strip-only):** no `enum`, `const enum`, `namespace`,
  parameter properties, or decorators. Use unions + `as const`. All relative
  imports include `.ts`.
- **`NODE_OPTIONS`** is a broken preload in the sandbox and must be `unset` in
  every shell before running `node`/`tsc`.
- **UI (React/Vite)** is best-effort only and cannot be `npm install`ed here; it
  is documented, not required for the core to be correct.
