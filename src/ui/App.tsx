/**
 * GERADOR DE CIRCUITOS PMR3407 - main screen.
 *
 * This React component implements EXACTLY the requested interface:
 *   - title "GERADOR DE CIRCUITOS PMR3407"
 *   - Sequencia input (e.g. "A+ B+ A- B-")
 *   - Tipo: Pneumatico / Eletropneumatico
 *   - Metodo: Intuitivo / Cascata / Passo a passo
 *   - Modo: Ciclo unico / Ciclo continuo
 *   - GERAR button
 *   - result tabs: Circuito / Funcionamento / Etapas / Componentes / Verificacao
 *   - later actions: Simular / Exportar SVG / Exportar PDF
 *
 * The component calls ONLY the pure pipeline facade (`generate`). All logic and
 * SVG generation happen in the framework-independent core; this file is thin
 * presentation glue. It is BEST-EFFORT: React/Vite cannot be installed in the
 * sandbox (npm registry blocked), so this file is not part of the core
 * typecheck/test. See README "User interface".
 */

import { useMemo, useState } from 'react';
import { generate } from './pipeline-facade.ts';
import type { CircuitType, GenerateResult, Method, Mode } from './pipeline-facade.ts';

type Tab = 'circuito' | 'funcionamento' | 'etapas' | 'componentes' | 'verificacao';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'circuito', label: 'Circuito' },
  { id: 'funcionamento', label: 'Funcionamento' },
  { id: 'etapas', label: 'Etapas' },
  { id: 'componentes', label: 'Componentes' },
  { id: 'verificacao', label: 'Verificacao' },
];

export function App(): JSX.Element {
  const [sequence, setSequence] = useState('A+ B+ A- B-');
  const [type, setType] = useState<CircuitType>('electropneumatic');
  const [method, setMethod] = useState<Method>('step-by-step');
  const [mode, setMode] = useState<Mode>('single');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [tab, setTab] = useState<Tab>('circuito');

  function onGenerate(): void {
    setResult(generate({ sequence, type, method, mode }));
    setTab('circuito');
  }

  return (
    <main className="app">
      <h1>GERADOR DE CIRCUITOS PMR3407</h1>

      <section className="controls">
        <label className="field">
          <span>Sequencia:</span>
          <input
            aria-label="Sequencia"
            value={sequence}
            onChange={(e) => setSequence(e.target.value)}
            placeholder="A+ B+ A- B-"
          />
        </label>

        <fieldset>
          <legend>Tipo</legend>
          <Radio name="tipo" checked={type === 'pneumatic'} onChange={() => setType('pneumatic')} label="Pneumatico" />
          <Radio name="tipo" checked={type === 'electropneumatic'} onChange={() => setType('electropneumatic')} label="Eletropneumatico" />
        </fieldset>

        <fieldset>
          <legend>Metodo</legend>
          <Radio name="metodo" checked={method === 'intuitive'} onChange={() => setMethod('intuitive')} label="Intuitivo" />
          <Radio name="metodo" checked={method === 'cascade'} onChange={() => setMethod('cascade')} label="Cascata" />
          <Radio name="metodo" checked={method === 'step-by-step'} onChange={() => setMethod('step-by-step')} label="Passo a passo" />
        </fieldset>

        <fieldset>
          <legend>Modo</legend>
          <Radio name="modo" checked={mode === 'single'} onChange={() => setMode('single')} label="Ciclo unico" />
          <Radio name="modo" checked={mode === 'continuous'} onChange={() => setMode('continuous')} label="Ciclo continuo" />
        </fieldset>

        <button type="button" className="generate" onClick={onGenerate}>
          GERAR
        </button>
      </section>

      {result !== null && <ResultPanel result={result} tab={tab} setTab={setTab} />}
    </main>
  );
}

function Radio(props: { name: string; checked: boolean; onChange: () => void; label: string }): JSX.Element {
  return (
    <label className="radio">
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onChange} />
      <span>{props.label}</span>
    </label>
  );
}

function ResultPanel(props: {
  result: GenerateResult;
  tab: Tab;
  setTab: (t: Tab) => void;
}): JSX.Element {
  const { result, tab, setTab } = props;

  const svgBlob = useMemo(() => {
    const svg = result.pneumaticSvg ?? result.ladderSvg ?? '';
    return svg;
  }, [result]);

  function exportSvg(): void {
    if (svgBlob.length === 0) return;
    const blob = new Blob([svgBlob], { type: 'image/svg+xml' });
    downloadBlob(blob, 'circuito-pmr3407.svg');
  }

  function exportPdf(): void {
    // Best-effort: open a print window; the user prints to PDF. A full PDF
    // encoder is out of scope for the sandbox (no npm deps).
    const w = window.open('', '_blank');
    if (w === null) return;
    w.document.write(`<html><body>${svgBlob}</body></html>`);
    w.document.close();
    w.print();
  }

  return (
    <section className="result">
      {!result.ok && <p className="error" role="alert">{result.error}</p>}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'tab active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === 'circuito' && <CircuitoTab result={result} />}
        {tab === 'funcionamento' && <ListTab items={result.funcionamento ?? []} />}
        {tab === 'etapas' && <EtapasTab result={result} />}
        {tab === 'componentes' && <ComponentesTab result={result} />}
        {tab === 'verificacao' && <VerificacaoTab result={result} />}
      </div>

      <nav className="actions">
        <button type="button" disabled title="Em breve">Simular</button>
        <button type="button" onClick={exportSvg} disabled={svgBlob.length === 0}>Exportar SVG</button>
        <button type="button" onClick={exportPdf} disabled={svgBlob.length === 0}>Exportar PDF</button>
      </nav>
    </section>
  );
}

function CircuitoTab(props: { result: GenerateResult }): JSX.Element {
  const { result } = props;
  return (
    <div className="circuito">
      {result.pneumaticSvg && (
        <figure>
          <figcaption>Circuito pneumatico</figcaption>
          <div dangerouslySetInnerHTML={{ __html: result.pneumaticSvg }} />
        </figure>
      )}
      {result.ladderSvg && (
        <figure>
          <figcaption>Diagrama eletrico (ladder)</figcaption>
          <div dangerouslySetInnerHTML={{ __html: result.ladderSvg }} />
        </figure>
      )}
    </div>
  );
}

function ListTab(props: { items: readonly string[] }): JSX.Element {
  return (
    <ol className="funcionamento">
      {props.items.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ol>
  );
}

function EtapasTab(props: { result: GenerateResult }): JSX.Element {
  const steps = props.result.steps ?? [];
  return (
    <table className="etapas">
      <thead>
        <tr>
          <th>Rele</th>
          <th>Movimento</th>
          <th>Solenoide</th>
          <th>Sensor</th>
          <th>Habilitado por</th>
          <th>Timer</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => (
          <tr key={s.relayId}>
            <td>{s.relayId}</td>
            <td>{s.movement}</td>
            <td>{s.solenoidId}</td>
            <td>{s.arrivalSensorId}</td>
            <td>{s.enabledBy}</td>
            <td>{s.hasTimer ? 'sim' : 'nao'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ComponentesTab(props: { result: GenerateResult }): JSX.Element {
  const comps = props.result.components ?? [];
  return (
    <table className="componentes">
      <thead>
        <tr>
          <th>Id</th>
          <th>Tipo</th>
          <th>Detalhe</th>
        </tr>
      </thead>
      <tbody>
        {comps.map((c) => (
          <tr key={c.id}>
            <td>{c.id}</td>
            <td>{c.kind}</td>
            <td>{c.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VerificacaoTab(props: { result: GenerateResult }): JSX.Element {
  const report = props.result.verification;
  if (report === undefined) return <p>Sem verificacao disponivel.</p>;
  return (
    <div className="verificacao">
      <p className={report.ok ? 'ok' : 'fail'}>
        {report.ok ? 'Circuito valido: nenhuma inconsistencia encontrada.' : `${report.issues.length} problema(s) encontrado(s).`}
      </p>
      <ul>
        {report.issues.map((issue, i) => (
          <li key={i}>
            <code>{issue.code}</code> {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
