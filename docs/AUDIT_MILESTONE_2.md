# Auditoria Adversarial — Milestone 2: Cascata Pneumática

**Data:** 2026-09  
**Commit auditado:** `65aef80` (implementação do Antigravity, tasks 2.0–2.10)  
**Escopo:** auditoria adversarial completa da cascata pneumática antes de avançar
para outro método — código, Kiro Specs, `docs/PMR3407_RULES.md` +
`docs/PMR3407_CASCADE_RULES.md`, materiais PMR3407, golden tests, testes
unitários, solver, validator, simulator, renderer SVG e explicação cronológica.

> Princípio aplicado: **não assumir que está correto só porque os testes
> passam.** Os testes atuais são majoritariamente **estruturais** (afirmam a
> forma do modelo e a validação estrutural), não **comportamentais**.

---

## Veredito: ❌ MILESTONE NÃO APROVADO

A **divisão em grupos** e a **contagem de linhas/memórias** estão corretas e são
genéricas (sem hardcode). Porém foram encontrados **2 problemas CRÍTICOS** que
afetam a correção lógica do circuito de cascata gerado — a prioridade nº 1 do
projeto. Não se deve avançar para outro método até que sejam resolvidos.

Suíte após a auditoria: `tsc` limpo; **152 testes, 149 passam, 0 falham, 3
todo** (os 3 `todo` são marcadores de regressão dos defeitos, em
`tests/golden/cascade-adversarial.test.ts`).

---

## 1. Suíte de testes executada

- `npx tsc --noEmit` → limpo.
- `node --test` (antes da auditoria): **144/144**.
- `node --test` (após adicionar a suíte adversarial): **149 pass / 0 fail / 3
  todo** de 152.

## 2. Diffs do Antigravity revisados

`65aef80` adicionou ~1786 linhas: `solver.ts` (+transitions), `model.ts`
(CascadeTransition), `circuit.ts` (projeção), `explanation.ts` (novo),
`layout/cascade.ts` (novo), `validator/cascade.ts` (novo), renderer pneumático,
e 6 arquivos de teste (golden, validator, layout, renderer, property, pipeline).
Sem alterações no núcleo do Milestone 1. `groups.ts` e o merge permaneceram
como na spec.

## 3-6. Casos adversariais, hardcodes, inconsistências e comparação com os materiais

### ✅ O que está correto (confirmado)
- **Divisão em grupos genérica** — regra "letras iguais com sinal oposto não
  ficam no mesmo grupo" implementada corretamente; testada com sequência nova
  (`C+A+C-A-C+A-`) sem hardcode. **[SANITY passa]**
- **Nm = NG − 1**, uma linha por grupo, cadeia de memórias em ordem crescente.
- **Merge último-no-primeiro** conservador e determinístico; `A+B+D-A-B-C+C-D+`
  não funde (conflito em D), documentado como divergência intencional do deck.
- **Comparação com exercícios PMR3407:** divisão de `B-C+A+B+C-A-` (deck 1
  Ex3a) → `[B- C+ A+][B+ C- A-]`, Nm=1 ✔; `A+B+/B-A-` (deck 4 p.63) →
  `[A+ B+][B- A-]` ✔; `A+B-B+T(A-B-)B+` (deck 5) → 4 grupos, Nm=3 ✔. As
  **divisões** batem com os materiais.

### ❌ Problemas encontrados (classificados)

#### CRÍTICO-1 (Finding D) — sensores de ativação religados crus aos pilotos de memória, sem gating pela linha do grupo
A projeção (`circuit.ts`) liga `sensor.out → memoria.14/12` **diretamente**. Em
cascata, o sinal de um sensor só pode estar "vivo" enquanto a **linha do seu
grupo** está pressurizada — é isso que quebra a sobreposição de sinais. Quando
uma **posição de fim de curso se repete** como sensor de ativação de vários
grupos (comum), o mesmo sensor físico pilotaria várias memórias ao mesmo tempo.

Evidência (`A+B-B+T(A-B-)B+`): `2S1` é SET de **M1 e M3**; `2S2` é SET de M2 e
RESET de M1; `2S1` é RESET de M2. Sem gating por linha, ao B recuar para `2S1` o
circuito tenta simultaneamente SET M1, SET M3 e RESET M2 → comportamento
indefinido. Os materiais (deck 4 p.72–73, deck 5) colocam o sensor de ativação
**alimentado pela linha do grupo corrente**. **Defeito de lógica real.**
Marcado por `FINDING D (fix target)` (todo).

#### CRÍTICO-2 (Finding B) — não existe simulador de cascata; correção comportamental não é provada
O passo-a-passo tem `runCycle` provando que o circuito reproduz a sequência e
retorna ao estado inicial. A **cascata não tem simulador nenhum**. Nenhum teste
prova que o circuito pneumático projetado, se simulado, executa de fato
`A+B+A-B-` e volta para casa. Os golden só afirmam estrutura + validação
estrutural. Este é exatamente o risco que o usuário alertou. Sem isso,
CRÍTICO-1 passou despercebido pela suíte. Marcado por `FINDING B (fix target)`
(todo).

#### MÉDIO-1 (Finding A) — sensor de fim de curso duplicado dentro de um grupo
Quando o mesmo atuador se move duas vezes na **mesma direção** dentro de um
grupo (`A+B+B+A-B-B-`), o 2º `B+` fica "gated" por `2S2`, que é o **próprio
sensor que ele aciona** → gate degenerado e violação de RULES §4 ("não usar dois
sensores na mesma posição") no nível lógico. O solver emite sem alertar.
Marcado por `FINDING A (fix target)` (todo).

#### MÉDIO-2 (Finding C) — reset da cadeia de memórias para retorno de ciclo não é provado
A última memória tem `resetSensorId` indefinido e é resetada pela linha de
suprimento na projeção, mas nada verifica que a cadeia inteira volta ao repouso
para um segundo ciclo. É resolvido de fato pelo simulador (CRÍTICO-2). Pinado por
`FINDING C`.

#### BAIXO-1 — sequências não-retornantes são aceitas silenciosamente
`A+B+` (sem `A-/B-`) e `A+A+` produzem um modelo de cascata "válido" com 1 grupo,
sem aviso de que o ciclo não retorna ao estado inicial. Um circuito pneumático
pressupõe estados inicial e final iguais (RULES §3). Baixo impacto (o usuário
tende a fornecer ciclos balanceados), mas deveria ao menos avisar.

#### BAIXO-2 — inconsistência solver ↔ explicação em grupos simultâneos
O modelo grava só o sensor "último listado" como `activationSensorId` do grupo
(embora `transitions.conditionSensorIds` liste todos). A explicação cronológica
usa `transitions` (correto), mas `group.activationSensorId` e a projeção da
memória usam só um — mesma classe do Obs.3 do Milestone 1, aqui com efeito
lógico potencial na projeção (liga-se ao CRÍTICO-1).

## 5. Consistência entre solver / modelo lógico / SVG / simulador / explicação

- **solver ↔ modelo:** consistentes (transitions derivados corretamente).
- **modelo ↔ SVG:** o renderer desenha o circuito projetado; herda o CRÍTICO-1
  (desenha os pilotos crus sem gating).
- **modelo ↔ simulador:** **inexistente** (CRÍTICO-2).
- **modelo ↔ explicação:** a narrativa cronológica é coerente com o modelo, mas
  descreve um circuito que (por CRÍTICO-1) não se comportaria assim na prática —
  ou seja, a explicação está "correta em relação ao modelo" mas o modelo está
  errado. Isso é pior que uma divergência: a explicação **mascara** o defeito.

## 7. Testes adicionais criados

`tests/golden/cascade-adversarial.test.ts` (novo): 5 testes que pinam
comportamento correto/observado + 3 `todo` que documentam os defeitos
(CRÍTICO-1, CRÍTICO-2, MÉDIO-1) como ganchos de regressão. Também estendi
`types/node-shims.d.ts` com `TestContext.todo()/skip()` (extensão zero-dep,
prevista pelo próprio arquivo de shims).

## 8. Classificação resumida

| # | Achado | Classe |
|---|--------|--------|
| CRÍTICO-1 | Sensores de ativação sem gating por linha (pilotam múltiplas memórias) | **Crítico** |
| CRÍTICO-2 | Sem simulador de cascata; correção comportamental não provada | **Crítico** |
| MÉDIO-1 | Sensor de fim de curso duplicado no grupo (gate auto-referente) | Médio |
| MÉDIO-2 | Reset da cadeia de memórias / retorno de ciclo não provado | Médio |
| BAIXO-1 | Sequências não-retornantes aceitas sem aviso | Baixo |
| BAIXO-2 | `activationSensorId` único vs. `conditionSensorIds` (grupo simultâneo) | Baixo |

## 9. Decisão final

**MILESTONE NÃO APROVADO.** Corrigir CRÍTICO-1 e CRÍTICO-2 (e idealmente
MÉDIO-1/2) e revalidar antes de qualquer novo método. Recomendação de correção:
1. **Simulador de cascata** (`runCascadeCycle`) que assenta pilotos por
   linha ativa e move um cilindro por rodada, provando reprodução da sequência e
   retorno ao estado inicial — espelhando o `runCycle` do passo-a-passo. Isso
   transforma os golden estruturais em golden comportamentais.
2. **Gating por linha na projeção:** o sensor de ativação deve chegar ao piloto
   da memória **através da linha do grupo corrente** (E lógico com a linha), não
   cru. Idem para os sensores intra-grupo já gated corretamente.
3. Tratar sensor duplicado no grupo (MÉDIO-1) e provar o retorno da cadeia
   (MÉDIO-2) via o simulador de (1).

Os 3 `todo` viram `pass` quando as correções entrarem.

---

## Próximo milestone (proposta) — apenas após CRÍTICO-1/2 resolvidos

Sua ordem de preferência e o ajuste sugerido pelos materiais:

1. Passo a Passo Eletropneumático ✅ (Milestone 1 — aprovado)
2. Cascata Pneumática ⛔ (Milestone 2 — **não aprovado**, corrigir primeiro)
3. **Passo a Passo Pneumático** ← próximo recomendado
4. Intuitivo Pneumático/Eletropneumático
5. Simulação mais completa

**Ajuste sugerido:** manter sua ordem, mas com uma dependência: o **Milestone 2
precisa ganhar um simulador** como parte da correção. Esse simulador de cascata
é o mesmo motor pneumático (assentar pilotos → mover cilindro → sensor → comutar
linha) que o **Passo a Passo Pneumático** (Milestone 3) vai reutilizar — os dois
compartilham a física pneumática pura (válvulas 5/2 dupla-pilotagem, sensores de
fim de curso, memórias biestáveis), enquanto o eletropneumático usa relés/ladder.
Portanto: **corrigir M2 (incl. simulador pneumático) habilita M3 quase de graça.**
A Spec de M3 (Passo a Passo Pneumático) só deve ser escrita depois que M2 for
aprovado, para reaproveitar o simulador pneumático então existente.
