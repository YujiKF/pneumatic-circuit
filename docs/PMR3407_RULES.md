# PMR3407 Pneumatic Circuit Rules — Formal Specification

This document formalizes the rules used to synthesize pneumatic and
electropneumatic circuits **as taught in PMR3407 — Sistemas Fluido-Mecânicos /
Pneumática** (Escola Politécnica da USP; Profs. Emílio C. N. Silva, Rafael T.
Moura, Arthur H. de A. Melani).

It is the source of truth for the deterministic solver. Every rule below is
attributed to the course material where the routing briefing states its origin
("deck N", "worked exercise"). Where the material is silent, inconsistent, or
ambiguous, the point is **recorded openly** in the [Ambiguities / Open
Questions](#ambiguities--open-questions) section rather than hidden, and a
**single deterministic convention is chosen and justified** so the generator
never behaves non-deterministically.

> Provenance note: the original course PDFs were not available to the authoring
> agent. The load-bearing facts below were extracted during task routing and
> are treated as authoritative. Any rule that could not be grounded in a
> specific deck/exercise is flagged as low-confidence in the Ambiguities
> section.

---

## 1. Sequence notation

Source: course sequence-notation convention; worked exercise sequences.

- A **movement** is a cylinder letter (`A`, `B`, `C`, `D`, …) followed by a
  **sign**:
  - `+` = advance (avanço, cylinder extends toward the end position),
  - `-` = retract (retorno, cylinder returns to the home position).
- Movements are written left to right in execution order, e.g. `A+B+A-B-`.
- **Timer prefix `T`**: an uppercase `T` written immediately before a movement
  or a group marks a **timer/temporizador delay** before that step. In
  electropneumatics this is a **time relay** with a delay value (e.g.
  `[0.3] s`, `[0.4] s`, `[0.5] s`). The sequence model records only that a
  timer precedes the step; the concrete delay value is attached later by the
  electropneumatic layer. Example: `A-B+B-B+B-TA+`.
- **Parentheses `( )` group SIMULTANEOUS movements in the SAME step**, e.g.
  `T(B+C+)`, `(A-B-)`. A step may therefore contain **more than one movement**.
  The domain model represents a step as one-or-more movements — never
  one-movement-per-step. Examples: `A+B-T(B+C+)C-A-`, `A+B-B+T(A-B-)B+`.
- **Accepted input dialects** (all normalize to one canonical model):
  - compact: `A+B+A-B-`
  - space-separated: `A+ B+ A- B-`
  - semicolon-separated: `A+;B+;A-;B-`
  - lowercase: `a+b+a-b-`

**Reserved letter:** `T` is reserved for the timer marker and is therefore not
usable as an actuator letter (see Ambiguities §A5). Actuators are drawn from
`A, B, C, D, E, …` excluding `T`.

**Canonical form (this project):** whitespace-free; single-movement steps as
`A+`; simultaneous steps wrapped in parentheses with movements ordered
alphabetically by actuator, e.g. `(A+B+)`; a timed step prefixed with `T`.
Example: `A+B-T(A-B-)B+`.

### 1.1 Rejection rules (invalid sequences)

The parser rejects, with a specific message, at least:

| Input   | Reason                                                        |
| ------- | ------------------------------------------------------------- |
| `A++`   | two signs on one movement (a movement has exactly one sign)   |
| `AB+`   | an actuator not followed by a sign (`A` has no direction)     |
| `A+X`   | trailing actuator with no direction                           |
| `++B`   | sign(s) not attached to any actuator                          |
| `(A+B+` | unbalanced parentheses                                        |
| `()`    | empty simultaneous group                                      |
| `A+T`   | dangling timer with nothing to delay                          |
| `(A+A-)`| same actuator twice in one simultaneous group                 |

---

## 2. Initial state

Source: worked intuitive/step-by-step diagrams (all cylinders drawn home).

- The **default** initial state in PMR3407 worked examples is that **every
  cylinder starts retracted** (denoted `A0`, `B0`, `C0`, …).
- This project makes the initial state **explicit and overridable**: the domain
  carries an `InitialState` map (actuator → `retracted` | `extended`). The
  parser does not silently assume "all retracted"; it fills the explicit map
  with the default, which a caller may override (e.g. for a sequence that
  begins with a `-` movement on a cylinder that starts extended).

---

## 3. Direct vs indirect sequences

Source: course definition; worked classification exercises.

- A cycle's **initial and final states are equal** (the circuit returns home).
- **Sequência direta:** the order of actuation "going out" equals the order of
  actuation "coming back". Otherwise the sequence is **indireta**.
- Worked examples:
  - `A+B+ | A-B-` → **direct**
  - `A+B+ | B-A-` → **indirect**
  - `A+C+B- | A-C-B+` → **direct**
  - `A+B+C+A- | D+B-D-C-` → **indirect**
- **Consequence:** indirect sequences cause **signal overlap (sobreposição de
  sinais)** — a limit valve/sensor keeps a pilot signal present when the
  opposite command is required. Overlap is what motivates the cascade and
  step-by-step methods (memories break the overlap). The intuitive method only
  works safely when there is no overlap.

---

## 4. Element numbering (pneumatic)

Source: deck 4, "Numeração dos elementos".

- **Cylinders/actuators** `A / B / C / D` → `1.0 / 2.0 / 3.0 / 4.0`.
- **Main directional valve** driving piston `N` → `N.1` (e.g. cylinder A's main
  valve is `1.1`).
- **Limit / signal valves** for piston `N` → `N.2`, `N.3` style.
- **Flow-control** valves: right-hand number `0`, e.g. `1.02`.
- **Supply / service**: first number `0` — `0.1` filtro/lubrificador region,
  `0.2` start region.
- **Rule (deck 4, p.59):** "**Não usar dois sensores na mesma posição**" — do
  not place two sensors at the same physical position. The generator must not
  emit two sensors for the same (actuator, end-position).

### 4.1 Port labels (for renderers)

Source: standard ISO port labelling used in the course diagrams.

- Service/working ports `A`, `B` → `2`, `4`.
- Pressure supply `P` → `1`.
- Exhausts `R`, `S` → `3`, `5`.
- Pilots `Z`, `X`, `Y` → `10`, `12`, `14`.

The renderer uses these labels only for drawing; it never derives logic from
them.

---

## 5. Electropneumatic naming

Source: electropneumatic decks; worked ladder diagrams.

- **Sensors:** `1S1 / 1S2` (cylinder A), `2S1 / 2S2` (B), `3S1 / 3S2` (C). `S1`
  vs `S2` distinguishes the two stroke ends (which end is which is **ambiguous**
  — see §A2, a convention is chosen).
- **Solenoids** on a double-solenoid `5/2` valve: `1Y1 / 1Y2` (A advance /
  retract), `2Y1 / 2Y2` (B), `3Y1 / 3Y2` (C).
- **Relays** `K1 … Kn` — one control relay per step in step-by-step.
- **Counter relay** `KC`.
- **Time relay** = a `K` relay with a boxed delay value, e.g. `[0.3]`.
- **Contacts:** `NO` (normally-open / fechador / NA) and `NC` (normally-closed
  / abridor / NF).
- **Rails:** `+24V` (top) and `0V` (bottom); **rungs** numbered `1 … N`.
- **Start button `E`** on rung 1.

---

## 6. Intuitive method (método intuitivo)

Source: course intuitive-method decks (5-phase presentation).

The intuitive method wires each end-of-stroke sensor directly to the pilot that
commands the next movement. It is valid only when there is **no signal
overlap** (direct sequences). Five phases (as presented in the course):

1. Draw the cylinders and their main valves.
2. Place the limit/signal valves at the stroke ends actually used.
3. Chain: each movement's completion sensor pilots the next movement.
4. Add the start element (`0.2`) in series with the trigger of the first
   movement.
5. Close the cycle (last sensor pilots the first movement for continuous mode).

If overlap is detected, the intuitive method is rejected in favour of cascade
or step-by-step.

---

## 7. Cascade method (método cascata)

Source: cascade decks; worked group-division exercises.

**Group division algorithm:**

1. Scan the sequence left to right, accumulating movements into the current
   group.
2. **A group may not contain the same actuator moving in both directions.** As
   soon as adding the next movement would put both `X+` and `X-` in one group,
   **close the current group and open a new one**.
3. The number of memories (pressure lines) required is `Nm = (number of groups)`
   and the number of switching memory elements is `groups − 1`.
4. **Last-into-first merge optimization:** if the last group and the first group
   do not conflict (no shared actuator with opposite signs across the wrap),
   they may be merged to reduce the memory count. (Exact edge cases — see §A3.)
5. Only **one group line is pressurized at a time.** A group line is activated
   by the **last event of the previous group**, which also **resets** the
   previous group's memory.

Each group's pressure line feeds the pilots of the movements inside that group;
the overlap is broken because a sensor's signal is only "live" while its group
line is pressurized.

---

## 8. Step-by-step method (método passo a passo)

Source: step-by-step decks; worked ladder/pneumatic exercises. This is the
first-milestone method (implemented end to end with tests).

One **memory per step** (a pneumatic double-pilot valve, or a sealed relay in
electropneumatics). The three governing rules, stated verbatim in spirit:

1. **A step may only be set when the previous step's line/memory is active**
   (prev line active).
2. **A step may only be set when the sensor of the previous movement has been
   tripped** (prev event sensor tripped).
3. **Setting a new step de-energizes (resets) the previous step's memory** (new
   line de-energizes previous).

**SELO / seal (self-holding) sub-circuit — critical:** each step's memory must
include a **seal/hold contact (selo)** so the step stays active after the
cylinder leaves the sensor that started it. Without the seal, the step drops as
soon as the actuator moves off the triggering sensor. This is a real, common
bug and the test suite must be able to catch a missing/mis-placed seal (see the
step-by-step solver feature).

**Arming the last line:** an **extra rung/branch** is required to arm the last
step's line so the first press (single cycle) or the wrap-around (continuous)
starts correctly.

---

## 9. Cycle mode

Source: course start-region / selector presentation.

- **Single cycle (ciclo único):** the sequence runs once; a **new start press**
  is required to run again.
- **Continuous / automatic (ciclo automático):** a start valve + selector loops
  the **last step back to the first** indefinitely.
- Selection is via a **start valve + selector** in the supply/start region
  (`0.2`).

## 10. Emergency

Source: course emergency presentation. (Out of scope for FEAT-001; recorded for
completeness.) An **emergency button** interrupts the cycle and drives the
circuit to a safe state. Its exact behaviour is specified in a later feature.

---

## Ambiguities / Open Questions

The material is inconsistent or silent on the points below. For each, a single
**deterministic convention is chosen** so the solver is reproducible. Revisit
these if the primary PDFs become available.

### A1. `.2` vs `.3` limit-valve position (retracted vs advanced)

**Problem:** across decks the association of the `N.2` / `N.3` limit valves to
the *retracted* vs *advanced* stroke end is **inconsistent**.

**Chosen convention (deterministic):** for cylinder `N`,

- **`N.2` = the RETRACTED (home) end sensor**, and
- **`N.3` = the ADVANCED (extended) end sensor.**

**Justification:** in the worked intuitive diagrams the drawn sensors for
cylinder A are `1.2` and `1.3` (for B `2.2/2.3`, for C `3.2/3.3`). Reading the
lower index as the "first"/home position and the higher index as the
"second"/advanced position gives an ordering (`.2` before `.3`) that matches the
natural advance direction of a cylinder starting home (the default initial
state, §2). This makes numbering monotonic with stroke progression.

### A2. `S1` vs `S2` end mapping (electropneumatic sensors)

**Problem:** `1S1` / `1S2` distinguish the two stroke ends, but which is the
*retracted* end is not stated unambiguously.

**Chosen convention (deterministic):** `S1` = RETRACTED (home) end, `S2` =
ADVANCED (extended) end — mirroring the `.2/.3` convention in A1 so pneumatic
and electropneumatic naming stay consistent (lower index → home end).

### A3. Cascade last-into-first group-merge edge cases

**Problem:** the exact conditions under which the last group may be merged into
the first (wrap-around) are not fully specified, especially when an actuator
appears at both the very end and the very beginning of the cycle.

**Chosen convention (deterministic):** merge the last group into the first
**only if** the union of the two groups still contains **no actuator with both
`+` and `-`**. If merging would create such a conflict, keep them separate.
This is conservative (never produces an invalid group) and deterministic. The
cascade solver feature will encode this as a testable rule and add golden
exercises.

### A4. Timer delay defaults

**Problem:** the numeric delay of a `T` step (e.g. `[0.3]` s) is not encoded in
the textual sequence.

**Chosen convention:** the sequence model records only the presence of a timer
(`hasTimer`). A default delay value is assigned by the electropneumatic layer
(a later feature) and is configurable; it is **not** invented at parse time.

### A5. `T` as a reserved letter

**Problem:** `T` is the timer marker, which would collide with a hypothetical
cylinder named `T`.

**Chosen convention:** `T` is **reserved** and cannot name an actuator. This is
safe for all worked examples (which use `A`–`E`) and keeps parsing
unambiguous. If a course example ever needs a `T` cylinder, revisit by
requiring an explicit timer syntax (e.g. `T[..]`).

### A6. Simultaneous-group ordering

**Problem:** `(A+B+)` and `(B+A+)` denote the same simultaneous step.

**Chosen convention:** movements inside a group are **canonicalized in
alphabetical order** so equivalent inputs compare equal. Physical simultaneity
is unaffected.

### A7. Source-attribution confidence

Several rules above are attributed to "decks" whose exact page could not be
verified without the PDFs. These are treated as authoritative per the routing
briefing but flagged here as **medium-confidence** pending direct verification:
the intuitive 5-phase breakdown (§6), the `Nm = groups` vs `groups − 1`
memory-count phrasing (§7), and the verbatim wording of the three step-by-step
rules (§8).
