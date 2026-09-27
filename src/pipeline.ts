/**
 * Pure pipeline API.
 *
 * A single, framework-independent entrypoint the UI (and tests) call to turn a
 * user request (sequence + type + method + cycle mode) into everything the
 * screen shows: the two SVG diagrams, the textual "funcionamento", the
 * step/component breakdowns and the validation report.
 *
 * This module contains NO React and NO DOM. It orchestrates the existing
 * layers only (parser -> solver -> validator -> layout -> renderer ->
 * simulator/explanation) and never re-derives logic.
 */

import { parseSequence } from './parser/index.ts';
import {
  solveStepByStep,
  toCircuit,
  solveCascade,
  toCascadeCircuit,
  explainCascade,
  analyzeSequence,
} from './engine/index.ts';
import type { CircuitLogicalModel, CascadeLogicalModel } from './engine/index.ts';
import type { Circuit } from './domain/index.ts';
import { nonReturningActuators } from './domain/index.ts';
import { validateCircuit } from './validator/index.ts';
import type { ValidationReport } from './validator/index.ts';
import { renderPneumatic, renderLadder } from './renderer/index.ts';
import { explain, runCycle, runCascadeCycle } from './simulator/index.ts';
import type { CascadeSimFault } from './simulator/index.ts';

/** Circuit technology chosen on screen. */
export type CircuitType = 'pneumatic' | 'electropneumatic';
/** Solution method chosen on screen. */
export type Method = 'intuitive' | 'cascade' | 'step-by-step';
/** Cycle mode chosen on screen. */
export type Mode = 'single' | 'continuous';

/** The request coming from the UI. */
export interface GenerateRequest {
  readonly sequence: string;
  readonly type: CircuitType;
  readonly method: Method;
  readonly mode: Mode;
  /** Explicit initial positions per actuator. Defaults to inferring 'extended' for '-' opening, 'retracted' otherwise. */
  readonly initialState?: Readonly<Record<string, 'retracted' | 'extended'>>;
}

/** A per-step summary for the "Etapas" tab. */
export interface StepSummary {
  readonly relayId: string;
  readonly movement: string;
  readonly solenoidId: string;
  readonly arrivalSensorId: string;
  readonly enabledBy: string;
  readonly hasTimer: boolean;
}

/** A per-component summary for the "Componentes" tab. */
export interface ComponentSummary {
  readonly id: string;
  readonly kind: string;
  readonly detail: string;
}

/** Everything the result panel needs. */
export interface GenerateResult {
  readonly ok: boolean;
  /** Error message when generation failed (parse/solve/validate). */
  readonly error?: string;
  /** SVG string of the pneumatic diagram (Circuito tab). */
  readonly pneumaticSvg?: string;
  /** SVG string of the ladder diagram (Circuito tab, electropneumatic). */
  readonly ladderSvg?: string;
  /** Chronological explanation lines (Funcionamento tab). */
  readonly funcionamento?: readonly string[];
  /** Per-step breakdown (Etapas tab). */
  readonly steps?: readonly StepSummary[];
  /** Component list (Componentes tab). */
  readonly components?: readonly ComponentSummary[];
  /** Validation report (Verificacao tab). */
  readonly verification?: ValidationReport;
  /** Non-blocking advisories (e.g. sequence does not return home). */
  readonly warnings?: readonly string[];
  /** Behavioral simulation report of one+ cycles (cascade). */
  readonly simulation?: SimulationSummary;
}

/** Result of the behavioral simulation shown on the Verificacao tab. */
export interface SimulationSummary {
  /** True only if every simulated cycle ran the full sequence without faults. */
  readonly completed: boolean;
  /** All cylinders back at their initial position. */
  readonly balanced: boolean;
  /** Control chain back at rest (ready for a new cycle). */
  readonly restored: boolean;
  /** Cycles simulated / completed. */
  readonly cycles: number;
  readonly cyclesCompleted: number;
  /** Movements physically executed (first cycle). */
  readonly executedMovements: readonly string[];
  readonly faults: readonly CascadeSimFault[];
}

/** Advisory limit on cascade lines (pressure drop through the chain, RULES C1). */
const CASCADE_LINE_ADVISORY = 10;

/**
 * Run the full pipeline for a UI request. Never throws for expected user
 * errors (bad sequence, invalid circuit); returns `{ ok: false, error }`.
 */
export function generate(req: GenerateRequest): GenerateResult {
  const parsed = parseSequence(req.sequence, req.initialState ? { initialState: req.initialState } : undefined);
  if (!parsed.ok) {
    return { ok: false, error: `Sequencia invalida: ${parsed.error.message}` };
  }

  const warnings: string[] = [];
  const nonReturning = nonReturningActuators(parsed.value);
  if (nonReturning.length > 0) {
    warnings.push(
      `A sequencia nao retorna ao estado inicial (${nonReturning.join(', ')}): o ciclo nao pode se repetir (RULES §3).`,
    );
  }

  if (req.method === 'intuitive') {
    const analysis = analyzeSequence(parsed.value);
    warnings.push(
      'O metodo intuitivo ainda nao possui solver proprio: o circuito exibido foi gerado pelo metodo passo a passo.',
    );
    if (!analysis.intuitiveApplicable) {
      const o = analysis.overlaps[0]!;
      warnings.push(
        `Sequencia ${analysis.kind === 'indirect' ? 'indireta' : 'com sobreposicao'}: o sensor ${o.sensorId} (que comanda ${o.commanded}) continua ativo quando ${o.blocked} deve ser comandado. O metodo intuitivo nao se aplica (use cascata ou passo a passo, RULES §3/§6).`,
      );
    }
  }

  // Solve with the requested method. The step-by-step solver produces the
  // electropneumatic model; cascade produces the pneumatic model. The
  // "intuitive" method reuses the step-by-step solver as a starting point.
  let model: CircuitLogicalModel | undefined;
  let cascadeModel: CascadeLogicalModel | undefined;
  let circuit: Circuit;
  try {
    if (req.method === 'cascade') {
      const cascade = solveCascade(parsed.value, { cycleMode: req.mode });
      cascadeModel = cascade;
      circuit = toCascadeCircuit(cascade);
      if (cascade.numberOfGroups > CASCADE_LINE_ADVISORY) {
        warnings.push(
          `${cascade.numberOfGroups} linhas de cascata: acima de ~${CASCADE_LINE_ADVISORY} a perda de carga na cadeia de memorias torna o circuito impraticavel (RULES C1).`,
        );
      }
    } else {
      model = solveStepByStep(parsed.value, { cycleMode: req.mode });
      circuit = toCircuit(model);
    }
  } catch (e) {
    return { ok: false, error: `Falha ao resolver o circuito: ${describe(e)}` };
  }

  const verification = validateCircuit(circuit, cascadeModel ?? model);
  if (!verification.ok) {
    return {
      ok: false,
      error: `O circuito gerado nao passou na verificacao (${verification.issues.length} problema(s)).`,
      verification,
      warnings,
    };
  }

  let pneumaticSvg: string | undefined;
  let ladderSvg: string | undefined;
  let funcionamento: readonly string[] | undefined;
  let steps: readonly StepSummary[] | undefined;
  let simulation: SimulationSummary | undefined;
  try {
    pneumaticSvg = renderPneumatic(
      circuit,
      cascadeModel ? { model: cascadeModel } : (model ? { model } : {}),
    );
    if (model !== undefined) {
      ladderSvg = renderLadder(circuit, model);
      funcionamento = explain(model);
      steps = summarizeSteps(model);
      // Confirm the model actually simulates one full cycle.
      runCycle(model, { pulseStart: true });
    } else if (cascadeModel !== undefined) {
      funcionamento = explainCascade(cascadeModel);
      steps = summarizeCascadeSteps(cascadeModel);
      // Behaviorally simulate the cascade circuit. A returning sequence must run
      // two consecutive cycles (proves the memory chain resets); a
      // non-returning one can only be checked for a single pass.
      const cycles = nonReturning.length > 0 ? 1 : 2;
      const sim = runCascadeCycle(cascadeModel, { cycles });
      simulation = {
        completed: sim.completed,
        balanced: sim.balanced,
        restored: sim.restored,
        cycles,
        cyclesCompleted: sim.cyclesCompleted,
        executedMovements: sim.executedMovements.slice(0, sim.expectedMovements.length),
        faults: sim.faults,
      };
    } else {
      funcionamento = circuit.explanation;
    }
  } catch (e) {
    return { ok: false, error: `Falha ao desenhar o circuito: ${describe(e)}`, verification, warnings };
  }

  if (simulation !== undefined && !simulation.completed) {
    const first = simulation.faults[0];
    return {
      ok: false,
      error: `O circuito gerado falhou na simulacao do ciclo${first ? `: ${first.message}` : '.'}`,
      verification,
      warnings,
      simulation,
    };
  }

  return {
    ok: true,
    pneumaticSvg,
    ladderSvg,
    funcionamento,
    steps,
    components: summarizeComponents(circuit),
    verification,
    warnings,
    ...(simulation !== undefined ? { simulation } : {}),
  };
}

function summarizeSteps(model: CircuitLogicalModel): StepSummary[] {
  return model.steps.map((s) => {
    const mv = s.movements[0];
    return {
      relayId: s.relayId,
      movement: s.movements.map((m) => `${m.actuator}${m.direction}`).join(' + '),
      solenoidId: mv?.solenoidId ?? '',
      arrivalSensorId: mv?.arrivalSensorId ?? '',
      enabledBy: s.enabledByStart ? model.startButtonId : (s.enableSensorId ?? ''),
      hasTimer: s.hasTimer,
    };
  });
}

function summarizeCascadeSteps(cascade: CascadeLogicalModel): StepSummary[] {
  const steps: StepSummary[] = [];
  for (const group of cascade.groups) {
    for (const mv of group.movements) {
      steps.push({
        relayId: group.lineId,
        movement: `${mv.actuator}${mv.direction}`,
        solenoidId: `${mv.mainValveId}:${mv.pilotPort}`,
        arrivalSensorId: mv.arrivalSensorId,
        enabledBy: mv.startSensorId ?? group.activationSensorId ?? cascade.startButtonId,
        hasTimer: false,
      });
    }
  }
  return steps;
}

function summarizeComponents(circuit: Circuit): ComponentSummary[] {
  return circuit.components.map((c) => ({ id: c.id, kind: c.kind, detail: detailOf(c) }));
}

function detailOf(c: Circuit['components'][number]): string {
  switch (c.kind) {
    case 'cylinder':
      return `Atuador ${c.actuator}`;
    case 'directional-valve':
      return `Valvula ${c.valveType} (${c.actuation})`;
    case 'sensor':
      return `Sensor ${c.position}`;
    case 'relay':
      return c.relayKind === 'timer' ? `Rele temporizador (${c.delaySeconds ?? 0}s)` : 'Rele de controle';
    case 'coil':
      return /^\d+Y\d+$/.test(c.id) ? 'Solenoide' : `Bobina de ${c.relayId}`;
    case 'contact':
      return `Contato ${c.contactType} de ${c.ownerId}`;
    case 'memory':
      return c.sealed ? 'Memoria selada' : 'Memoria';
    default:
      return '';
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
