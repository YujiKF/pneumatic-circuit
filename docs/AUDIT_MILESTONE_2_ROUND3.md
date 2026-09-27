# Milestone 2 — Registro de correções (Rodada 3)

**Base:** `06242ec` (re-auditoria rodada 2, "AINDA NÃO APROVADO").
**Natureza deste documento:** registro das correções + auto-verificação. **Não é
uma aprovação independente**: a decisão final cabe a uma nova auditoria
adversarial, que pode reproduzir tudo abaixo com `npm test`.

Suíte: `tsc` limpo; **180 testes, 180 pass, 0 fail, 0 todo** (antes: 155/153/2 todo).

---

## CRÍTICO-2 — simulador comportamental real

`src/simulator/cascade.ts::runCascadeCycle` foi reescrito. Ele **não percorre
`model.groups`**. A cada rodada de assentamento:

1. **linha viva = f(memórias)**: nenhuma SET → L1; Mk SET → L(k+1). Duas linhas
   estáveis → `LINE_EXCLUSIVITY`;
2. **piloto SET de Mk** só é pressurizado se a **linha k** estiver viva **e todos**
   os sensores de ativação estiverem ativos (o gating do CRÍTICO-1 agora é
   *exercitado*). O piloto RESET é a saída de M(k+1), ou, na última memória, o(s)
   sensor(es) de retorno gated pela última linha. As memórias assentam até ponto
   fixo antes das válvulas principais;
3. **piloto de válvula principal** só com a linha do grupo viva **e** todos os
   sensores de gate ativos (mais START no 1º passo). Os dois pilotos ao mesmo
   tempo → `PILOT_CONFLICT` (sobreposição de sinais);
4. **no máximo um cilindro por evento físico**, depois reassenta.

`completed` é **derivado**: sem falhas, movimentos executados == ordem física
alvo, última linha atingida, cadeia em repouso, em **todos** os ciclos pedidos.
Há também um **preflight** contra o circuito projetado (`toCascadeCircuit`):
sensores/válvulas inexistentes, modelo inconsistente, piloto não ligado.

**Tabela de mutações da rodada 2, agora** (`tests/golden/cascade-simulator.test.ts`):

| Mutação | Resultado |
|---|---|
| `M1.setSensorId → ZZZ` | `completed=false`, `UNKNOWN_SENSOR` + `DEADLOCK` |
| `grupo2.activationSensor → BOGUS` | `completed=false`, `INCONSISTENT_MODEL` |
| `mainValveId → 9.9` | `completed=false`, `UNKNOWN_VALVE` + `WIRING_MISSING` + `DEADLOCK` |
| gate → `NEVER_ACTIVE` | `completed=false`, `UNKNOWN_SENSOR` + `DEADLOCK` (executa só `A+`) |
| gate auto-referente em sensor **real** (`2S2`) | `completed=false`, `DEADLOCK` detectado só na simulação (sem preflight), executa só `A+` |
| memória setada por sensor real errado | `completed=false` |
| remoção do retorno (reset da última memória) | `completed=false`, `restored=false` |
| membro simultâneo que nunca chega | linha 2 nunca ativa |

`FINDING B3` e `FINDING B4` deixaram de ser `todo` e passam de verdade.

### Goldens reconferidos pela execução física

| Sequência | Ordem física executada (2 ciclos) | Linhas visitadas |
|---|---|---|
| `B-C+A+B+C-A-` (deck 1 Ex3a) | `B- C+ A+ B+ C- A-` ×2 | L1, L2 |
| `A+B+/B-A-` (deck 4 p.63) | `A+ B+ B- A-` ×2 | L1, L2 |
| `A+B-B+T(A-B-)B+` (deck 5) | `A+ B- B+ A- B- B+` ×2 | L1..L4 |

## Defeito novo exposto pelo simulador real (corrigido)

**Merge último→primeiro:** a passagem para o grupo 2 usava o sensor do último
movimento da lista do grupo 1, que inclui a *cauda* mesclada (executada só no fim
do ciclo). Resultado: o ciclo oscilava (`C+ C- C+ …`, por exemplo em
`A+B-A-C+B+C-`). Correção em `solver.ts`: a passagem acontece no fim da **cabeça**
do grupo 1. O primeiro passo da cauda passa a ser gated pelo sensor de retorno.
O simulador antigo nunca teria mostrado isso.

## MÉDIO-2 — retorno da cadeia

A última memória agora tem `resetSensorId` = sensor de chegada do último passo
do último grupo, e o modelo tem `returnTransition`. Na projeção, o piloto 12 da
última memória é alimentado por uma instância do sensor dedicada à última linha
(ex. `2S2_L4`), não pela alimentação. Provado por simulação de **3 ciclos
consecutivos** (`FINDING C (behavioral)`): todas as memórias RESET e L1 viva no
fim de cada ciclo.

## BAIXO-1 — sequência que não retorna

`nonReturningActuators()` (domínio) + `GenerateResult.warnings`: o pipeline
avisa, por exemplo, em `A+B+`. Na cascata, uma sequência que não retorna é
simulada por um único ciclo. Um circuito que falha na simulação (ex.
`C+A+C-A-C+A-`) é **recusado** pelo pipeline.

## BAIXO-2 — grupo simultâneo

O gating é por **passo**. `CascadeMovement.startSensorIds` contém os sensores de
chegada de **todos** os membros do passo anterior, ligados em série (AND) na
projeção. Os membros de um mesmo passo simultâneo compartilham o gate e partem
juntos. O SET da memória é o AND de `conditionSensorIds`; um teste confere que
`0.1` só é SET depois de `2S2` **e** `3S2`.

## Observações do Milestone 1

- **Obs.1:** a regra de inferência do estado inicial foi escrita em RULES §2.
- **Obs.2:** a equivalência do armar-última-linha está documentada em RULES §8,
  com um teste comportamental.
- **Obs.3:** `enable-next` agora lista todos os sensores habilitantes.

## Extra: tarefa 1.1 da spec original

`src/engine/analysis.ts` implementa a classificação direta/indireta (exemplos
de RULES §3) e a detecção de sobreposição de sinais. O pipeline usa isso no
método **intuitivo**, que continua **sem solver próprio**: ele avisa que usa o
passo a passo e explica a sobreposição.

## Limitações conhecidas (honestas)

- O simulador executa a lógica de fiação **do modelo**, com um preflight
  estrutural contra o circuito projetado. Ele não interpreta o grafo de
  conexões como uma rede pneumática genérica.
- Na projeção, START não aparece em série no 1º passo (é modelado por
  `gatedByStart`), e a linha L1 continua desenhada a partir de `E:2`.
- Os movimentos são atômicos (sem estado intermediário no curso). Corridas
  entre válvulas acionadas no mesmo assentamento são resolvidas em FIFO
  determinístico.
- Um comando repetido no mesmo sentido (o 2º `B+` de `A+B+B+…`) não move nada
  e não conta como movimento físico.
