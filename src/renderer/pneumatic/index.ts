/**
 * Pneumatic circuit renderer.
 *
 * Consumes a VALIDATED, laid-out {@link Circuit} and produces the pneumatic
 * diagram as an SVG STRING. It draws:
 *  - cylinders (CylinderSymbol),
 *  - 5/2 main + memory valves (Valve52Symbol),
 *  - 3/2 supply/limit valves (Valve32NC/NOSymbol),
 *  - mechanical sensors (MechanicalSensorSymbol),
 *  - solenoids feeding pilots (SolenoidSymbol),
 *  - the routed pneumatic connections (pipes).
 *
 * It NEVER decides logic. If the circuit is invalid/unvalidated it REFUSES via
 * {@link assertRenderable} (throws {@link RenderRefusedError}).
 */

import type { Circuit, CircuitComponent } from '../../domain/index.ts';
import type { CircuitLogicalModel } from '../../engine/model.ts';
import { layoutCircuit } from '../../layout/index.ts';
import type { LayoutResult, PlacedComponent } from '../../layout/index.ts';
import { assertRenderable } from '../guard.ts';
import { group, polyline, svgRoot } from '../svg.ts';
import {
  CylinderSymbol,
  MechanicalSensorSymbol,
  SolenoidSymbol,
  Valve32NCSymbol,
  Valve32NOSymbol,
  Valve52Symbol,
} from '../symbols.ts';

export interface PneumaticRenderOptions {
  /** Optional logical model enabling deeper validation before rendering. */
  readonly model?: CircuitLogicalModel;
}

/**
 * Render a pneumatic circuit to an SVG string.
 * @throws RenderRefusedError if the circuit is invalid/unvalidated.
 */
export function renderPneumatic(circuit: Circuit, opts: PneumaticRenderOptions = {}): string {
  assertRenderable(circuit, opts.model);

  const layout = layoutCircuit(circuit);
  const compById = new Map<string, CircuitComponent>();
  for (const c of circuit.components) compById.set(c.id, c);

  const symbols: string[] = [];
  for (const placed of layout.components) {
    const comp = compById.get(placed.id);
    if (comp === undefined) continue;
    const svg = renderComponent(comp, placed);
    if (svg.length > 0) symbols.push(svg);
  }

  const pipes = renderPipes(layout);

  const body =
    group('pneumatic-wires', {}, ...pipes) + group('pneumatic-symbols', {}, ...symbols);
  return svgRoot(layout.width, layout.height, 'pneumatic-diagram', body);
}

/** Map one logical component to the correct pneumatic symbol. */
function renderComponent(comp: CircuitComponent, placed: PlacedComponent): string {
  const base = { x: placed.x, y: placed.y, width: placed.width, height: placed.height, label: comp.id };
  switch (comp.kind) {
    case 'cylinder':
      return new CylinderSymbol(base).render();
    case 'directional-valve':
      if (comp.valveType === '3/2') {
        return comp.actuation === 'spring-return'
          ? new Valve32NCSymbol(base).render()
          : new Valve32NOSymbol(base).render();
      }
      return new Valve52Symbol(base).render();
    case 'sensor':
      return new MechanicalSensorSymbol(base).render();
    case 'coil':
      // Only pneumatic solenoid pilots (ids like "1Y1") belong on the
      // pneumatic diagram; relay coils (e.g. "coil-K1-r1") are ladder-only.
      return /^\d+Y\d+$/.test(comp.id) ? new SolenoidSymbol(base).render() : '';
    default:
      // relays/contacts/memories are not part of the pneumatic diagram.
      return '';
  }
}

/** Draw every pneumatic connection as a pipe polyline. */
function renderPipes(layout: LayoutResult): string[] {
  const pipes: string[] = [];
  for (const conn of layout.connections) {
    if (conn.signalType !== 'pneumatic') continue;
    pipes.push(
      polyline(conn.points, {
        stroke: '#1a56db',
        'stroke-width': 1.5,
        class: `pipe pipe-${conn.sourceComponent}-${conn.targetComponent}`,
      }),
    );
  }
  return pipes;
}
