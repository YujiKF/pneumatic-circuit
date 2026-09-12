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
- Solvers, validator, layout, renderer, simulator and UI follow in later
  features.

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
