# PMR3407 Pneumatic Circuit Generator

A **deterministic** generator of pneumatic and electropneumatic circuits based
on the methods taught in **PMR3407 — Sistemas Fluido-Mecânicos / Pneumática**
(EESP-USP). Given an actuation sequence such as `A+B+A-B-`, it parses the
sequence, solves the control logic with a PMR3407 method (intuitive, cascade,
step-by-step, electropneumatic), validates the result, and (later) lays it out
and renders it as SVG.

There is **no LLM at runtime** — the generation is rule-based and reproducible.

## Status

- **FEAT-001 (done):** project scaffold, formal rules
  (`docs/PMR3407_RULES.md`), Kiro spec
  (`.kiro/specs/pmr3407-pneumatic-circuit-generator/`), the domain model
  (`src/domain/`), and the **sequence parser** (`src/parser/`) with tests.
- **FEAT-002 / FEAT-003 (done):** step-by-step + cascade solvers, the circuit
  validator, the simulator and the textual explanation, with golden and
  property tests.
- **FEAT-004 (done):** the **presentation layer** — a pure, deterministic
  **layout engine** (`src/layout/`), a framework-independent **SVG symbol
  library + renderers** (`src/renderer/`), a pure **pipeline API**
  (`src/pipeline.ts`), and a best-effort **React + Vite UI** (`src/ui/`). The
  layout engine and the SVG renderers are plain TypeScript producing SVG
  **strings** (no DOM/browser), unit-tested with `node --test`.

## Requirements

- **Node.js v22+** — the core `.ts` files run directly via Node's native
  TypeScript type-stripping. There is **no build/bundle step** for the core.
- **`tsc` v7** (globally installed) for type-checking.
- **No npm dependencies.** The public npm registry is not reachable in the
  development sandbox, so the core intentionally has **zero** runtime/dev
  dependencies and relies only on Node built-ins and global tooling. Minimal
  ambient type declarations for the Node built-ins used are in
  `types/node-shims.d.ts` (a stand-in for `@types/node`).

### `NODE_OPTIONS` caveat

The development sandbox sets a broken `NODE_OPTIONS` preload. You **must**
`unset NODE_OPTIONS` in each shell before running `node` or `tsc`, otherwise
Node crashes with `Cannot find module proxy-bootstrap.js`.

## Commands

```sh
# Type-check (no emit)
unset NODE_OPTIONS && tsc --noEmit -p tsconfig.json      # or: npm run typecheck

# Run the tests (Node built-in test runner, .ts run directly)
unset NODE_OPTIONS && node --test "tests/**/*.test.ts" "src/**/*.test.ts"   # or: npm test
```

A task is considered **done only when its tests pass**, not merely when it
type-checks.

## Presentation layer (layout + renderer)

The presentation layer is strictly separated from the logic:

- **`src/layout/`** — a PURE, deterministic layout engine. It receives the
  logical component/connection graph and returns a separate `LayoutResult`
  (positions, orientation, orthogonal line routing). It NEVER writes geometry
  back into the logical `Circuit`, so the layout can always be recomputed from
  the graph alone. Determinism, full placement and non-overlap are unit-tested
  (`tests/layout/`).
- **`src/renderer/`** — a reusable, framework-independent **SVG symbol
  library** returning SVG **strings** (no DOM/browser), with the 11 named
  classes: `CylinderSymbol`, `Valve52Symbol`, `Valve32NOSymbol`,
  `Valve32NCSymbol`, `MechanicalSensorSymbol`, `PneumaticANDSymbol`,
  `PneumaticORSymbol`, `SolenoidSymbol`, `RelayCoilSymbol`, `NOContactSymbol`,
  `NCContactSymbol` (port labels P=1, A=2, B=4, R=3, S=5, pilots 10/12/14).
  `renderer/pneumatic` draws the pneumatic diagram and `renderer/electrical`
  draws the ladder (+24V/0V rails, numbered rungs, coils/contacts). The
  renderer **refuses** to draw an unvalidated/invalid circuit (throws
  `RenderRefusedError`) — it only ever draws a validated `Circuit` and never
  decides logic. Structural SVG facts and the refusal path are unit-tested
  (`tests/renderer/`).
- **`src/pipeline.ts`** — a single pure `generate()` entrypoint (parser →
  solver → validator → layout → renderer → simulator/explanation). It has NO
  React/DOM and is the ONLY surface the UI calls (`tests/pipeline/`).

## User interface (React + Vite, best-effort)

`src/ui/` is a **React + TypeScript + Vite** front end implementing the
requested screen (title **GERADOR DE CIRCUITOS PMR3407**; a `Sequencia` input;
`Tipo` Pneumatico/Eletropneumatico; `Metodo` Intuitivo/Cascata/Passo a passo;
`Modo` Ciclo unico/Ciclo continuo; a `GERAR` button; result tabs
`Circuito` / `Funcionamento` / `Etapas` / `Componentes` / `Verificacao`; and
the later actions `Simular` / `Exportar SVG` / `Exportar PDF`). The UI calls
ONLY the pure pipeline facade (`src/ui/pipeline-facade.ts` → `generate()`).

> **Registry limitation.** The development sandbox is `INTEGRATIONS_ONLY`: the
> public npm registry returns **HTTP 403**, so **React, ReactDOM, Vite and
> their type packages CANNOT be installed here**. The UI is therefore
> **best-effort source**: it compiles against the pipeline API and is kept out
> of the core `tsconfig.json` (it has its own `src/ui/tsconfig.json`) so the
> core type-check/test stays green without the UI's dependencies.
>
> To run the UI, use a **networked environment**:
>
> ```sh
> npm install                 # installs react/react-dom + vite (needs network)
> npm run dev                 # start the Vite dev server
> npm run build:ui            # production build (dist/)
> npm run typecheck:ui        # type-check the UI against installed React types
> ```
>
> The **core** (`parser/engine/validator/layout/renderer as SVG strings/
> simulator/explanation/pipeline`) is fully runnable and testable **without**
> the UI via `npm test` — no install required.

## Language constraints (Node v22 strip-only)

Node's native TypeScript support strips types without transforming them, so the
code base avoids constructs that would need transformation:

- no `enum` / `const enum` (use string-literal unions + `as const`),
- no `namespace`,
- no TypeScript parameter properties (`constructor(private x)`),
- no experimental decorators,
- all relative imports include the explicit `.ts` extension.

## Layout

```
src/
  domain/      interface-independent types (Sequence, Circuit, ...)
  parser/      text -> canonical SequenceModel (tokenizer + parser)
  engine/      method solvers: intuitive/, cascade/, step-by-step/
  validator/   circuit rule checks
  layout/      geometry assignment (no logic)
  renderer/    SVG output: pneumatic/, electrical/ (never decides logic)
  simulator/   runtime stepping of state models
  ui/          React/Vite UI (best-effort; not installable in the sandbox)
tests/
  parser/      parser unit tests
  engine/      solver unit tests
  golden/      pinned circuit outputs for worked exercises
  properties/  hand-rolled property-based tests
docs/PMR3407_RULES.md                             formal rules + ambiguities
.kiro/specs/pmr3407-pneumatic-circuit-generator/  requirements / design / tasks
```
