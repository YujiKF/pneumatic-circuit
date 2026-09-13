# PMR3407 Cascade Method — Formal Rules (Milestone 2)

This document formalizes the rules used to synthesize a **pneumatic cascade**
circuit (**método cascata**) as taught in **PMR3407 — Sistemas
Fluido-Mecânicos / Pneumática** (Escola Politécnica da USP; Profs. Emílio C. N.
Silva, Rafael T. Moura, Arthur H. de A. Melani).

It is a companion to [`PMR3407_RULES.md`](./PMR3407_RULES.md) and does **not**
contradict it. Where a cascade point is already stated there (notably §7 "Cascade
method" and §A3 "Cascade last-into-first group-merge edge cases"), this document
**cross-links and refines** rather than restates a divergent rule. If a
refinement narrows or clarifies §7/§A3, the refinement is called out explicitly.

> **Provenance note.** As with the parent rules doc, the original course PDFs
> were not available to the authoring agent. The load-bearing facts below were
> extracted during task routing from the PMR3407 decks and worked exercises and
> are treated as authoritative per the routing briefing. Every rule is
> **attributed** to a deck/exercise. Where evidence is thin or the material is
> silent, the point is marked **HYPOTHESIS** (per the user instruction "Cada
> regra deve ser sustentada pelos materiais ou marcada como hipótese") and a
> single deterministic convention is chosen so the generator stays
> reproducible.

Confidence tags used below: **[MATERIAL]** = stated in the decks/worked
exercises; **[REFINES §7/§A3]** = a deterministic clarification of an
already-recorded rule; **[HYPOTHESIS]** = not directly grounded, a chosen
convention pending PDF verification.

---

## C1. Method definition and purpose

**Source:** deck 4 "Circuitos Pneumáticos" (Aulas 4/5/6); deck 5 "Exemplos
Cascata". **[MATERIAL]**

- The cascade method is presented as an **optimization of step-by-step** that
  **minimizes the number of valves**. Instead of one pressure line per **step**,
  the sequence is divided into **groups of movements**; a group may hold **more
  than one movement**, and there is **one pressure line per group**.
- The construction (cascade) and the valve type used to activate a line are
  **sufficient to also deactivate the previous line** — a single bistable memory
  valve both hands pressure to the next line and cuts the previous one.
- Cascade resolves **signal overlap (sobreposição de sinais)** exactly as
  step-by-step does: a limit sensor's signal is only "live" while its group's
  line is pressurized, so the same sensor cannot simultaneously hold two
  opposite commands.
- **Practical limit (~10 lines):** because the first line's pressure passes in
  series through every memory valve, pressure drop across many memories bounds
  the useful number of groups to roughly ten (deck 4 p.66). **[MATERIAL]** This
  is a **documented advisory limit**, not a hard synthesis error; the generator
  MAY warn but SHALL still produce the circuit.

Cross-link: this restates and expands [`PMR3407_RULES.md` §7](./PMR3407_RULES.md#7-cascade-method-método-cascata)
("Cascade method") with the deck-level provenance the parent doc summarized.

---

## C2. Group division

**Source:** deck 4 p.62-65; deck 5 p.2. The governing sentence is stated
**verbatim** in the materials. **[MATERIAL]**

> "Letras iguais com sinal algébrico oposto não podem ficar numa mesma linha
> (grupo)."

### C2.1 When a group starts / ends

- Walk the sequence **left to right**, accumulating **steps** (a step is one
  movement, or several simultaneous movements from a parenthesized group, or a
  timer step) into the **current group**.
- **A group ENDS (and a new one STARTS)** at the moment adding the next step
  would place, **within the same group**, the **same cylinder letter with the
  opposite sign** (i.e. the same cylinder both `+` and `-`). At that boundary,
  close the current group and open a new one that begins with the offending
  step. **[MATERIAL]**
- **The first group STARTS** at the first step of the sequence. **The last group
  ENDS** at the last step (subject to the last-into-first merge, C4). **[MATERIAL]**

### C2.2 When an actuator may reappear in the same group

- An actuator MAY appear **more than once in the same group** as long as **every
  appearance has the SAME sign** (e.g. two `A+` in one group is allowed; `A+`
  then `A-` is NOT). **[REFINES §7/§A3]** — this is the direct contrapositive of
  the verbatim rule; the existing algorithm already implements it
  (`conflicts()` in `src/engine/cascade/groups.ts` keys a per-actuator set of
  seen directions and only flags when the OPPOSITE sign is already present).
- A **simultaneous parenthesized step** `(A- B-)` is treated as one step; both
  its movements land in the **same group** (the parser already rejects the same
  actuator twice within one parenthesized group, so a single step never
  self-conflicts). **[MATERIAL]** (deck 5 worked `A+B-B+T(A-B-)B+`).
- A **timer step** `T…` is a normal step in the scan; the timer marker does not
  affect the division. **[MATERIAL]** (deck 5, same worked example).

### C2.3 How `+` and `-` of the same cylinder affect the division

- Only an **opposite-sign reappearance of the same cylinder** forces a new
  group. Different cylinders never force a division by themselves; a group can
  contain `A+ B+ C-` freely. **[MATERIAL]**
- Because a balanced cycle usually re-drives the opening cylinders in the
  reverse direction near the end, the **canonical textbook shape** `A+B+ | B-A-`
  produces exactly two groups. **[MATERIAL]** (deck 4 p.63).

### C2.4 Worked division examples (pinned as expectations)

All from the materials; used as golden expectations (see
[`golden-tests.md`](../.kiro/specs/pmr3407-cascade-pneumatic/golden-tests.md)):

| Sequence            | Groups                       | NG | Source                 |
| ------------------- | ---------------------------- | -- | ---------------------- |
| `A+B+/B-A-`         | `[A+ B+] [B- A-]`            | 2  | deck 4 p.63, deck 5    |
| `B-C+A+B+C-A-`      | `[B- C+ A+] [B+ C- A-]`      | 2  | deck 1 Ex3a, deck 4    |
| `A+B-B+T(A-B-)B+`   | `[A+ B-] [B+] [A- B-] [B+]`  | 4  | deck 5 p.2 (worked)    |
| `A+B+D-A-B-C+C-D+`  | `[A+ B+ D-] [A- B- C+] [C- D+]` (pre-merge) | 3 | deck 4 p.65 |

The algorithm is **generic**: no exercise's grouping is hardcoded (see the
module docstring in `src/engine/cascade/groups.ts`).

---

## C3. Pressure-line count and memory-valve count

**Source:** deck 4 p.64, stated **verbatim**. **[MATERIAL]**

> "Número de válvulas memória = número de grupos − 1."

- **Pressure lines:** exactly **one line per group**, so `lines = NG` (number of
  groups). **[MATERIAL]**
- **Memory valves:** `Nm = NG − 1`. **[MATERIAL]** A single-group sequence needs
  **zero** memory valves. Two groups need `Nm = 1`; four groups need `Nm = 3`.
- Memory valves are generally **bistable double-pilot 4/2 or 5/2** valves.
  **[MATERIAL]** The existing projection emits them as `5/2 double-pilot`
  (`src/engine/cascade/circuit.ts`), a deterministic choice consistent with the
  main-valve type used elsewhere. **[REFINES §7/§A3]**

Cross-link: matches [`PMR3407_RULES.md` §7.3](./PMR3407_RULES.md#7-cascade-method-método-cascata),
which already fixes the convention that `Nm` (the count asserted by golden tests)
is `groups − 1` and the line count is `numberOfGroups`.

---

## C4. Last group handling and last-into-first merge

**Source:** deck 4 p.65; deck 5. The merge rule **does** appear in the
materials (so it is **[MATERIAL]**, not a mere hypothesis), stated as:

> "Quando o último grupo é composto por movimentos que, se unidos ao primeiro
> grupo, não desobedecem à regra da primeira etapa … pode-se unir o último grupo
> ao primeiro, reduzindo o número de linhas e memórias."

### C4.1 How to treat the last group

- By default the last group is a normal group closing at the last step. **[MATERIAL]**
- The **first line is the default/rest live line**: at cycle start (and after a
  full cycle) control sits on line 1. The last group's completion is what wraps
  control back to line 1. **[MATERIAL]** (deck 4 p.67 line rules; see C5).

### C4.2 When the last group may be merged into the first

- **Merge condition [MATERIAL, edge cases REFINES §A3]:** merge the last group
  into the first **only if** the **union** of the first and last groups contains
  **no actuator with both `+` and `-`**. If merging would create such a
  conflict, keep them separate. This is the **conservative, deterministic** rule
  already fixed in [`PMR3407_RULES.md` §A3](./PMR3407_RULES.md#a3-cascade-last-into-first-group-merge-edge-cases)
  and implemented by `canMerge()` / `divideIntoGroups(..., {mergeLastIntoFirst})`
  in `src/engine/cascade/groups.ts` (default on).
- **Order preservation under merge [REFINES §A3]:** merging appends the last
  group's movements to the first group's movement list, but those movements
  physically execute at the **END** of the cycle (when control wraps back to
  line 1), NOT at the start. `DividedGroup.mergedTailCount` records how many
  trailing movements were wrapped in, and `cascadeExecutionOrder(division)`
  reconstructs the true physical order, which MUST equal the original sequence.
  This guarantees the merge never reorders execution.

### C4.3 Worked merge / non-merge cases (pinned)

- **Merge case:** `A+A-A+` → raw `[A+] [A-] [A+]` (3 groups, `Nm = 2`); first
  `[A+]` and last `[A+]` share only `A+` → merge into `[A+ A+] [A-]` (2 groups,
  `Nm = 1`). **[REFINES §A3]** (algorithm's canonical merge fixture).
- **Merge case (deck example):** `A+B+D-A-B-C+C-D+` → pre-merge
  `[A+ B+ D-] [A- B- C+] [C- D+]`; the deck labels this "1 2 1", i.e. the last
  group unites with the first. Record both the pre-merge 3-group division and
  the post-merge outcome; treat the exact post-merge line count as the deck's
  "1 2 1" (**[MATERIAL]** for the fact that it merges; the precise merged shape
  is **[REFINES §A3]** via the conservative union rule). deck 4 p.65.
- **Non-merge case:** `A+B+B-A-` → `[A+ B+] [B- A-]`; wrap union conflicts on
  **both** A and B → **no merge**, stays `Nm = 1`. **[MATERIAL]** (deck 4 p.63).

---

## C5. Group-to-group transition (line switching)

**Source:** deck 4 p.67 "Grupos de comando"; deck 5 p.5-10. Three line rules,
stated in the materials. **[MATERIAL]**

1. **First-line pressurization passes through all memory valves.** The
   pressurization of the FIRST line is fed through the chain of memory valves in
   their rest state; line 1 is therefore the default live line at rest.
2. **A group is activated only when the LAST event of the PREVIOUS group
   completes** — its end-of-course (arrival) sensor trips and pilots the memory
   valve that hands pressure to the next line.
3. **Activating a group resets/de-pilots the memory valve that had activated the
   PREVIOUS group.** The act of switching lines forward is what returns the
   earlier memory to rest.

### C5.1 Sensor placement

- **Intra-group sensors (action change INSIDE a group):** placed **between the
  group pressure line and the cylinder's main-valve pilot** (deck 4 p.72, step
  4a). Such a sensor's signal is only live while its group line is pressurized.
  In the model, the **first** movement of a group has **no** intra-group gating
  sensor (line pressurization starts it); each **subsequent** movement is gated
  by the **arrival sensor of the previous movement in the same group**
  (`CascadeMovement.startSensorId` in `src/engine/cascade/model.ts`). **[MATERIAL + REFINES §7]**
- **Group-activation sensors (activate the NEXT group):** the arrival sensor of
  the **last** movement of a group **drives a memory valve** (deck 4 p.73, step
  4b), never a main valve directly (`CascadeGroupModel.activationSensorId`,
  `CascadeMemoryValve.setSensorId`). **[MATERIAL]**

### C5.2 Simultaneous-group predecessor

- When the previous group ends on a **simultaneous** step (e.g. `(A- B-)`), the
  activation of the next line logically requires **all** members to have
  arrived. **[REFINES §A6]** The existing model records the activation sensor as
  the arrival sensor of the **last-listed** member (cosmetic, mirrors Milestone-1
  Obs.3); a Milestone-2 task SHALL make the transition **condition** gate on the
  full set (see tasks). The gating **logic** must use all members even if the
  narrative cites one.

### C5.3 Construction steps taught by the materials

**Source:** deck 4 p.70-75; deck 5 p.3-14. **[MATERIAL]** Used to order the
tasks:

1. Divide into groups (C2).
2. Place group lines + memory valves + AND (válvula E) + start element.
3. Place actuators and main command valves (5/2 double-pilot, one per cylinder).
4. (a) Place sensors for action-change **inside** a group (between line and main
   valve); (b) place sensors for **group activation** (driving the memory
   valves).
5. Test.

There is also an "**E com menos válvulas**" optimization and an
**emergency-button variant** (deck 5 p.16). Both are **out of scope for the
Milestone-2 core** and recorded here only for completeness. **[MATERIAL]**

---

## C6. Initial state (cascade must not assume all-retracted)

**Source:** parent-doc §2; Milestone-1 audit Obs.1. **[REFINES §2]**

- Cascade SHALL reuse the **explicit, overridable** `InitialState` from the
  parser (default retracted, inferable `extended` when a cylinder's first
  movement is `-`). It SHALL **not** silently assume every cylinder starts
  retracted. The golden `B-C+A+B+C-A-` (B starts extended) exercises this and is
  already relied upon by the existing tests.
- **Doc-gap note (Milestone-1 Obs.1):** the `extended`-inference rule itself is
  not yet written in parent-doc §2. The cascade spec depends on the same
  behavior; if §2 is later amended to formalize the inference, this section and
  the golden expectations stay consistent.

---

## C7. Mutual-exclusivity invariant (core cascade invariant)

**Source:** deck 4 p.64-67 (one line pressurized at a time). **[MATERIAL]**

- **Only ONE group line is pressurized at any instant.** This is a load-bearing
  cascade invariant and a required property test (see golden-tests.md): no two
  group lines may be permanently co-active when the method requires exclusivity.
- Structurally this follows from: line 1 fed through the memory chain at rest;
  each memory hands control from line `k` to line `k+1` and (rule 3) resets the
  prior memory, so exactly one line is selected at a time.

---

## Cross-reference summary

| Cascade rule (this doc) | Parent `PMR3407_RULES.md` | Relationship        |
| ----------------------- | ------------------------- | ------------------- |
| C1 method definition    | §7                        | expands provenance  |
| C2 group division       | §7 step 1-2               | verbatim + refines  |
| C3 line/memory count    | §7.3                      | matches (`Nm=NG−1`) |
| C4 last-into-first merge | §7.4, §A3                 | matches + refines   |
| C5 transition mechanics | §7.5                      | expands (steps 4a/b)|
| C6 initial state        | §2, audit Obs.1           | refines / flags gap |
| C7 mutual exclusivity   | §7 (one-hot line)         | names the invariant |
