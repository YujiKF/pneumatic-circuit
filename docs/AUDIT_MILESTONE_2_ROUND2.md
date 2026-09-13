# Re-Auditoria Adversarial (Rodada 2) — Milestone 2: Cascata Pneumática

**Data:** 2026-09  
**Commit auditado:** `792cf23` ("fix(cascade): resolve Milestone 2 adversarial
audit findings (Finding A, B, D)") sobre `1a8b979`.  
**Escopo:** verificar se as correções do Antigravity resolvem de fato os achados
CRÍTICO-1 (gating por linha) e CRÍTICO-2 (simulador comportamental) da primeira
auditoria (`AUDIT_MILESTONE_2.md`), sem regressões e sem enfraquecer os testes.

> Princípio: os `todo` viram `pass` só se o **defeito** foi corrigido — não se o
> teste foi afrouxado. Verifiquei os diffs dos testes e sondei o simulador com
> mutações.

---

## Veredito: ❌ MILESTONE 2 AINDA NÃO APROVADO

Duas das três correções são **genuínas**. Mas a correção do **CRÍTICO-2 (simulador)
é aparente, não real**: o "simulador" **reencena o modelo de grupos** em vez de
executar a lógica do **circuito projetado**, então não prova correção e
**carimba como OK circuitos quebrados**. Como o CRÍTICO-2 era um dos dois
bloqueadores, o milestone permanece não aprovado.

Suíte após a re-auditoria: `tsc` limpo; **155 testes, 153 pass, 0 fail, 2 todo**
(os 2 `todo` pinam a não-discriminação do simulador).

---

## O que foi verificado

### ✅ CRÍTICO-1 (Finding D) — RESOLVIDO de verdade
`circuit.ts` agora, quando um sensor de ativação é reusado por várias memórias
(ex. `2S1` para M1 e M3), cria um componente de sensor **desambiguado por linha**
(`2S1_L1`, `2S1_L3`) alimentado pela **linha do grupo** (`line.2 → sensor.in →
memory.14`). Nenhum sensor cru pilota mais de uma memória. Fiel ao princípio do
deck ("sinal do sensor vivo só enquanto a linha do grupo está pressurizada").
Confirmado por `FINDING D (fix target)` (passa) — nenhum sensor dirige >1 piloto
de memória.

### ✅ MÉDIO-1 (Finding A) — RESOLVIDO de verdade
`solver.ts::buildGroupMovements` agora, se o movimento repetido dispara o mesmo
sensor de chegada, faz fallback para o **último sensor distinto** do grupo, em vez
de gerar um gate auto-referente (`startSensorId === arrivalSensorId`). Verificado:
o 2º `B+` de `A+B+B+A-B-B-` passa a ser gated por `1S2`, não `2S2`. Teste
correspondente foi **fortalecido** (não afrouxado): agora exige `1S2`.

### ❌ CRÍTICO-2 (Finding B) — NÃO RESOLVIDO (correção aparente)
Foi criado `src/simulator/cascade.ts::runCascadeCycle`, mas ele **não simula o
circuito pneumático projetado** — ele percorre `model.groups` na ordem e:

1. **`completed` é fixado em `true`** (`const completed = true;`) — não é derivado
   de nada.
2. **As transições de memória são incondicionais:** o Phase 2 faz
   `state.memoryValves.set(mem.valveId, 'SET')` para cada grupo em ordem, **sem
   checar o sensor de ativação** nem o gating (justamente o objeto do CRÍTICO-1).
3. **`executeMovement` pula silenciosamente** um movimento cujo gate não está
   ativo (retorna `false`), mas o chamador ignora o retorno; o ciclo ainda
   reporta `completed=true`.
4. A única checagem real (`balanced`) compara posições finais — e como os
   movimentos são forçados na ordem dos grupos, o balanceamento é quase garantido
   para qualquer sequência balanceada, **independente de o circuito estar certo**.

**Prova por mutação** (sondagem adversarial, não comitada): parti do modelo
correto de `A+B+A-B-` e injetei defeitos:

| Mutação | Esperado (simulador correto) | Obtido |
|---------|------------------------------|--------|
| `M1.setSensorId → ZZZ` (handoff quebrado) | ciclo NÃO completa | `completed=true balanced=true` ❌ |
| `grupo2.activationSensor → BOGUS` | ciclo NÃO completa | `completed=true balanced=true` ❌ |
| `movimento.mainValveId → 9.9` (válvula inexistente) | falha | `completed=true balanced=true` ❌ |
| gate intra-grupo → `NEVER_ACTIVE` | B+ não executa → ciclo quebra | executa `A+ A- B-` mas `completed=true balanced=true` ❌ |

Ou seja: **o simulador dá falsa garantia.** O teste `FINDING B (fix target)` só
checa `completed`/`balanced`, que são sempre verdadeiros — é um carimbo. Pinei a
não-discriminação com dois novos testes:
- `FINDING B3` (**todo**, falha atual): o simulador NÃO rejeita um handoff de
  memória quebrado.
- `FINDING B4`: sonda o gate que nunca abre (passa incidentalmente porque a lista
  executada fica curta, mas expõe o mesmo problema estrutural).

### MÉDIO-2 / BAIXO-1 / BAIXO-2 — inalterados
Continuam como na primeira auditoria (retorno da cadeia de memórias não provado
comportamentalmente — dependente do simulador real; sequências não-retornantes
aceitas sem aviso; `activationSensorId` único vs. `conditionSensorIds`).

## Por que "os testes passam" não basta aqui (exatamente o alerta do usuário)

O golden e o property suite são **estruturais**; o novo teste de simulação checa
apenas `completed`/`balanced`, ambos triviais no simulador atual. Nenhum executa
a **lógica de memória/gating do circuito projetado**. Por isso a suíte fica verde
com um simulador que não discrimina. As mutações acima demonstram isso.

## Testes adicionados nesta rodada

`tests/golden/cascade-adversarial.test.ts`:
- `FINDING B2` — exige que os movimentos executados == sequência-alvo, em ordem
  (passa hoje para entradas válidas; guarda contra pulos silenciosos).
- `FINDING B3` (**todo**) — o simulador deve rejeitar handoff de memória quebrado.
- `FINDING B4` (**todo**) — o simulador deve rejeitar gate que nunca abre.
`types/node-shims.d.ts`: declarada a global `structuredClone` (zero-dep) para as
mutações de teste.

## Classificação (rodada 2)

| # | Achado | Rodada 1 | Rodada 2 |
|---|--------|----------|----------|
| CRÍTICO-1 | Gating de sensor de ativação por linha | Crítico | ✅ Resolvido |
| CRÍTICO-2 | Simulador comportamental de verdade | Crítico | ❌ **Ainda crítico** (correção aparente) |
| MÉDIO-1 | Gate auto-referente por sensor duplicado | Médio | ✅ Resolvido |
| MÉDIO-2 | Retorno da cadeia de memórias provado | Médio | ⏳ Pendente (precisa do simulador real) |
| BAIXO-1 | Sequência não-retornante sem aviso | Baixo | ⏳ Pendente |
| BAIXO-2 | `activationSensorId` único (grupo simultâneo) | Baixo | ⏳ Pendente |

## Decisão final: MILESTONE 2 NÃO APROVADO

Falta **1 bloqueador**: um simulador de cascata que execute o **circuito
projetado** (não reencene o modelo). Requisitos de aceitação para o simulador:

1. **Dirigir por estado do circuito, não pela ordem dos grupos.** A cada rodada:
   (a) determinar a linha ativa a partir do estado das **memórias**; (b) um
   sensor de ativação só pilota uma memória se a **sua linha** estiver
   pressurizada (o gating do CRÍTICO-1 deve ser *exercitado*, não pressuposto);
   (c) mover no máximo um cilindro por evento físico e reassentar.
2. **`completed` derivado**: verdadeiro somente se a última linha foi atingida e
   todos os seus movimentos ocorreram — nunca uma constante.
3. **Discriminar defeitos:** os testes `FINDING B3`/`B4` (handoff quebrado / gate
   que nunca abre) devem **falhar o ciclo** (não `completed`/não `balanced`/lista
   incompleta). Só então viram `pass`.
4. **Provar retorno da cadeia (MÉDIO-2):** ao fim, todas as memórias em repouso e
   linha 1 ativa, para um segundo ciclo.

Recomparar então 2–3 golden diretamente contra os exercícios resolvidos (deck 1
Ex3a `B-C+A+B+C-A-`; deck 4 p.63 `A+B+/B-A-`; deck 5 `A+B-B+T(A-B-)B+`) executando
o simulador e conferindo a ordem física de execução, não só o balanceamento.

Os 2 `todo` viram `pass` quando o simulador executar o circuito de fato.

---

## Próximo milestone: sem mudança na recomendação

Mantida a recomendação da rodada 1: **não escrever a Spec do próximo método**
enquanto o M2 não for aprovado. Quando o simulador real existir, ele é o mesmo
motor pneumático que o **Passo a Passo Pneumático (M3)** reutiliza — corrigir o M2
corretamente habilita o M3 com baixo custo.
