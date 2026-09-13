# Auditoria Final — Milestone 1: Passo a Passo Eletropneumático

**Data:** 2026-09  
**Escopo:** verificação de consistência lógica do Milestone 1 (eletropneumático +
passo a passo) contra Kiro Specs, `docs/PMR3407_RULES.md`, materiais originais da
PMR3407, golden tests, solver, simulator, validator e renderer SVG.

**Estado dos testes na auditoria:** `tsc --noEmit` limpo; `node --test` = **120/120
passando**.

---

## Veredito: ✅ APROVADO

Nenhum problema **crítico** de lógica foi encontrado. O núcleo determinístico é
coerente de ponta a ponta e fiel à metodologia PMR3407 para o método passo a passo
eletropneumático. Foram registradas **3 observações não-bloqueantes** (abaixo) para
acompanhamento — nenhuma impede o avanço para o Milestone 2.

---

## O que foi verificado e está correto

### Parser → Sequence Model
- Aceita todos os dialetos (`A+B+A-B-`, espaçado, `;`, `/`, minúsculas) e
  canonicaliza de forma idêntica. Rejeições (`A++`, `AB+`, `A+X`, `++B`, parênteses
  desbalanceados, grupo vazio, timer pendente, ator duplicado no grupo) retornam
  `Result` com código específico, sem lançar exceção. Coerente com REQ-PARSE-*.
- Grupos simultâneos `( )` viram **um** passo com múltiplos movimentos.
- Timer `T` marca `hasTimer=true` sem inventar delay numérico (RULES §A4).

### Estado inicial
- Explícito e sobrescrevível (`InitialState`), nunca assumido silenciosamente no
  downstream. Default = recuado. **Inferência adicional:** se o primeiro movimento
  de um cilindro é `-`, ele é inferido como iniciando `extended` — usado corretamente
  em `A-B+B-B+B-TA+` (A extended) e `B-C+A+B+C-A-` (B extended). Ver Observação 1.

### Solver passo a passo
- **Uma memória (relé Ki) por passo** — REQ-SBS-MEMORY. ✔
- **Regra 1 (linha anterior ativa)** → contato NO `prev-line` de Ki-1. ✔
- **Regra 2 (sensor do movimento anterior)** → contato(s) NO `prev-sensor`. ✔
- **Regra 3 (nova linha desativa a anterior)** → contato NC `reset` de Ki+1. ✔
- **SELO (selo/auto-retenção)** → ramo paralelo com o **próprio** contato NO de Ki
  (`role:'seal'`, `driverId===relayId`, `type:'NO'`). Topologia correta: a memória
  sobrevive à abertura do sensor transitório. É exatamente o bug que o usuário pediu
  para ser detectável — e é (`seal-regression.test.ts` falha sob mutação). ✔
- **Grupo simultâneo antecessor:** o passo seguinte só habilita quando **TODOS** os
  sensores de chegada dos membros estão ativos (AND em série), não apenas o último
  listado (`enableSensorIds`). ✔
- **Solenóides em paralelo:** quando o mesmo solenóide (ex. 2Y1) é comandado por
  vários passos (K2, K4), eles alimentam a mesma bobina em ramos paralelos (OR). ✔
- **Nomenclatura** (RULES §4/§5, A1/A2): `+`→Y1/S2/avanço, `-`→Y2/S1/retorno; N.2
  recuado, N.3 avançado; Ki por passo. Consistente entre solver/validator/simulator. ✔

### Validator
- Uma classe de erro por checagem, com código estável: componente/porta inexistente,
  porta obrigatória sem conexão, componente duplicado, sensor/relé inexistente,
  bobina sem componente, transição impossível, passo sem saída, conflito lógico,
  passo inalcançável, solenóide inexistente. ✔
- Checagens lógicas reais no `CircuitLogicalModel`: **selo ausente/mal-posicionado**
  vira `LOGICAL_CONFLICT`; passo comandando avanço+retorno do mesmo cilindro vira
  conflito; `IMPOSSIBLE_TRANSITION` exige que todo sensor habilitante seja produzível
  por um movimento anterior; `UNREACHABLE_STEP` faz varredura de alcançabilidade. ✔
- Circuito malformado (sem arrays) é recusado via `LOGICAL_CONFLICT` pelo caminho
  normal do validator (sem código fabricado no renderer). ✔

### Simulator
- Alternância determinística: **assentar ladder → um evento físico** por rodada.
  O selo latcheia o relé; ao mover, o sensor de partida abre (o transitório que o
  selo sobrevive) e o de chegada ativa. Multi-solenóide resolvido como OR explícito. ✔
- Todos os 5 golden sequences completam o ciclo e retornam ao estado inicial correto
  (inclusive B/A começando estendidos). ✔
- `runCycle` com `pulseStart` solta o START após o primeiro settle → prova que K1
  é sustentado pelo selo, não pelo START. ✔

### Explicação automática
- Derivada do **mesmo** trace do simulador (uma única lógica), no estilo do exemplo
  do curso (START → Ki → solenóide → válvula → cilindro → sensor → próximo passo). ✔

### Golden + Challenger tests
- Resolvem sequências reais pelo parser + solver de verdade e afirmam o modelo lógico
  produzido (contagem de passos/relés, mapeamento por passo de solenóide+sensor, relé
  de tempo, topologia do selo, contato de armar, modo de ciclo, paralelismo de
  solenóides). Não são tautológicos. Cobrem os exercícios PMR3407:
  `A+B+A-B-`, `A+B+B-A-`, `A+B+C+A-B-C-`, `B-C+A+B+C-A-`, `A-B+B-B+B-TA+`. ✔

### Renderer SVG
- Recebe um `Circuit` já validado; recusa circuito inválido; SVG sem `NaN`/
  `undefined`/`null`; escapa caracteres XML. Não decide lógica. ✔

---

## Observações não-bloqueantes (para acompanhamento)

### Obs. 1 — Inferência de estado inicial não está documentada em RULES §2
O parser infere `extended` quando o primeiro movimento de um cilindro é `-`. O
comportamento é **explícito e sobrescrevível** (não viola a regra do usuário de "não
assumir silenciosamente"), e os golden tests dependem dele. Porém RULES §2 documenta
apenas "default recuado, sobrescrevível" — a **regra de inferência** em si não está
escrita lá. *Ação sugerida:* acrescentar um parágrafo em RULES §2 formalizando a
inferência (com atribuição/hipótese), para que a fonte-de-verdade cubra o
comportamento real. Não urgente.

### Obs. 2 — "Armar a última linha" (ciclo único): equivalência a documentar
Os materiais (deck 2, "extra para armar última linha") mostram um ramo extra
alimentado pelo START para armar a última linha em repouso. A implementação usa, no
modo **single**, um contato NC do último relé **em série com o START na linha 1**
(a primeira linha fica armada enquanto a última está OFF, garantindo um ciclo por
pressão). É logicamente coerente e passa nos testes de simulação single/contínuo, mas
é uma **realização diferente** da topologia do slide. *Ação sugerida:* documentar em
RULES §8 a equivalência (ou adotar a topologia do deck) e cobrir com um teste que
compare o comportamento observável, não a fiação. Não urgente.

### Obs. 3 — `enable-next` na explicação usa só o sensor "último listado"
Na explicação, o evento `enable-next` reporta apenas `enableSensorId` (o último
sensor listado do grupo antecessor), enquanto o **gating** correto usa o conjunto
completo `enableSensorIds`. É um detalhe **apenas de narrativa** (a lógica de gating
está certa), mas para um passo que segue um grupo simultâneo a explicação pode citar
só um dos sensores. *Ação sugerida:* enriquecer a linha de explicação para listar
todos os sensores habilitantes. Cosmético.

---

## Conclusão

Milestone 1 **aprovado**. As três observações são de documentação/cosmética e podem
ser tratadas em paralelo ao Milestone 2 sem bloquear o avanço. A Spec do Milestone 2
(Cascata Pneumática) segue em `.kiro/specs/pmr3407-cascade-pneumatic/`.
