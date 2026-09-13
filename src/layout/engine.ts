/**
 * Automatic layout engine.
 *
 * PURE and DETERMINISTIC: given the same logical {@link Circuit} it always
 * produces the same {@link LayoutResult}. It receives only the logical
 * component/connection graph and decides x, y, orientation and line routing.
 * It NEVER mutates the circuit and stores no geometry back into it.
 *
 * Strategy (grid based, no randomness):
 *  - Components are grouped into horizontal BANDS by kind, in a fixed reading
 *    order that matches PMR3407 diagrams:
 *      cylinders (top) -> directional valves -> sensors -> relays ->
 *      contacts -> coils/solenoids -> memories.
 *  - Within a band, components are ordered by a stable key (natural id order)
 *    and placed left-to-right on a fixed pitch, so no two components overlap.
 *  - Ladder (electric) rows are laid out relative to two rails (+24V top / 0V
 *    bottom); the electrical renderer uses the same band metrics.
 *  - Connections are routed as orthogonal (Manhattan) polylines from the
 *    source port anchor to the target port anchor. Rail/rung implicit nodes
 *    ("+24V", "0V", "R<n>") get synthetic anchors so wires still route.
 *
 * The geometry constants live in one place so the renderer and the tests can
 * import them and reason about structure without magic numbers.
 */

import type { Circuit } from '../domain/index.ts';
import type {
  Box,
  LayoutResult,
  Orientation,
  PlacedComponent,
  Point,
  RoutedConnection,
} from './types.ts';
import { layoutCascadeCircuit } from './cascade.ts';

/** Tunable, deterministic geometry. All units are SVG user units. */
export const LAYOUT_METRICS = {
  /** Outer margin around the whole diagram. */
  margin: 40,
  /** Horizontal pitch between successive components in a band. */
  colPitch: 140,
  /** Vertical pitch between bands. */
  bandPitch: 160,
  /** Default symbol footprint. */
  cellWidth: 90,
  cellHeight: 90,
} as const;

/** Fixed band order (row index) by component kind. */
const BAND_ORDER: Readonly<Record<string, number>> = {
  cylinder: 0,
  'directional-valve': 1,
  sensor: 2,
  relay: 3,
  contact: 4,
  coil: 5,
  memory: 6,
};

/** Default orientation by kind. */
function orientationFor(kind: string): Orientation {
  // Cylinders are drawn horizontally (rod travels left-right); the ladder
  // elements sit on horizontal rungs; valves are drawn as horizontal blocks.
  return kind === 'sensor' ? 'vertical' : 'horizontal';
}

/**
 * Natural comparison so "K2" sorts before "K10" and "C2" before "C10".
 * Splits into alternating non-digit / digit chunks and compares chunk-wise.
 */
export function naturalCompare(a: string, b: string): number {
  const ax = a.match(/\d+|\D+/g) ?? [a];
  const bx = b.match(/\d+|\D+/g) ?? [b];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const as = ax[i]!;
    const bs = bx[i]!;
    const an = /^\d/.test(as);
    const bn = /^\d/.test(bs);
    if (an && bn) {
      const d = Number(as) - Number(bs);
      if (d !== 0) return d;
    } else if (as !== bs) {
      return as < bs ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

/**
 * Compute the deterministic layout of a circuit.
 *
 * @param circuit the logical circuit (never mutated).
 * @returns an immutable {@link LayoutResult}.
 */
export function layoutCircuit(circuit: Circuit): LayoutResult {
  if (circuit.method === 'cascade') {
    return layoutCascadeCircuit(circuit);
  }

  const { margin, colPitch, bandPitch, cellWidth, cellHeight } = LAYOUT_METRICS;

  // 1) Bucket components into bands by kind, keeping a stable natural order.
  const bands = new Map<number, string[]>();
  const kindById = new Map<string, string>();
  for (const c of circuit.components) {
    kindById.set(c.id, c.kind);
    const band = BAND_ORDER[c.kind] ?? 99;
    let list = bands.get(band);
    if (list === undefined) {
      list = [];
      bands.set(band, list);
    }
    list.push(c.id);
  }
  for (const list of bands.values()) list.sort(naturalCompare);

  // 2) Assign a contiguous visual row to each occupied band (skip empty bands
  //    so the diagram has no blank rows, but keep the deterministic order).
  const occupiedBands = [...bands.keys()].sort((a, b) => a - b);
  const rowOfBand = new Map<number, number>();
  occupiedBands.forEach((band, i) => rowOfBand.set(band, i));

  // 3) Place each component left-to-right on its band's row.
  const placed: PlacedComponent[] = [];
  const byId = new Map<string, PlacedComponent>();
  let maxCols = 0;
  for (const band of occupiedBands) {
    const row = rowOfBand.get(band)!;
    const ids = bands.get(band)!;
    maxCols = Math.max(maxCols, ids.length);
    ids.forEach((id, col) => {
      const kind = kindById.get(id)!;
      const p: PlacedComponent = {
        id,
        kind,
        x: margin + col * colPitch,
        y: margin + row * bandPitch,
        width: cellWidth,
        height: cellHeight,
        orientation: orientationFor(kind),
        row,
        col,
      };
      placed.push(p);
      byId.set(id, p);
    });
  }

  const rows = occupiedBands.length;
  const width = margin * 2 + Math.max(1, maxCols) * colPitch;
  const height = margin * 2 + Math.max(1, rows) * bandPitch;

  // 4) Route connections as orthogonal polylines between port anchors.
  const connections: RoutedConnection[] = circuit.connections.map((conn) => {
    const from = anchor(conn.sourceComponent, conn.sourcePort, byId, height, margin);
    const to = anchor(conn.targetComponent, conn.targetPort, byId, height, margin);
    return {
      sourceComponent: conn.sourceComponent,
      sourcePort: conn.sourcePort,
      targetComponent: conn.targetComponent,
      targetPort: conn.targetPort,
      signalType: conn.signalType,
      points: manhattan(from, to),
    };
  });

  return {
    width,
    height,
    components: placed,
    byId,
    connections,
  };
}

/**
 * Resolve the anchor point of a (component, port) endpoint. Real components use
 * their placed box + a port offset; implicit electric nodes (+24V / 0V / R<n>)
 * are given synthetic anchors along the top/bottom rails so electric wires can
 * still be drawn.
 */
function anchor(
  compId: string,
  port: string,
  byId: ReadonlyMap<string, PlacedComponent>,
  height: number,
  margin: number,
): Point {
  const p = byId.get(compId);
  if (p !== undefined) return portAnchor(p, port);

  // Implicit electric nodes.
  if (compId === '+24V') return { x: margin, y: margin };
  if (compId === '0V') return { x: margin, y: height - margin };
  const m = /^R(\d+)$/.exec(compId);
  if (m !== null) {
    const n = Number(m[1]);
    // Rung nodes step down the diagram deterministically.
    return { x: margin, y: margin + n * LAYOUT_METRICS.bandPitch * 0.5 };
  }
  // Unknown node: pin to origin (still deterministic).
  return { x: margin, y: margin };
}

/** Port offset within a placed component's box. Deterministic per port name. */
export function portAnchor(p: PlacedComponent, port: string): Point {
  const box: Box = { x: p.x, y: p.y, width: p.width, height: p.height };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  switch (port) {
    // Pneumatic valve ports (5/2): P=1 bottom-center, A=2/B=4 top, R=3/S=5
    // bottom, pilots 14 (left), 12 (right), 10 (left-lower).
    case '1':
      return { x: cx, y: box.y + box.height };
    case '3':
      return { x: box.x + box.width * 0.25, y: box.y + box.height };
    case '5':
      return { x: box.x + box.width * 0.75, y: box.y + box.height };
    case '2':
      return { x: box.x + box.width * 0.25, y: box.y };
    case '4':
      return { x: box.x + box.width * 0.75, y: box.y };
    case '14':
      return { x: box.x, y: cy };
    case '12':
      return { x: box.x + box.width, y: cy };
    case '10':
      return { x: box.x, y: box.y + box.height * 0.75 };
    // Electric two-terminal ports.
    case 'in':
    case 'L':
    case 'a1':
      return { x: box.x, y: cy };
    case 'out':
    case 'a2':
      return { x: box.x + box.width, y: cy };
    case 'signal':
      return { x: cx, y: box.y };
    // Cylinder ports.
    case '+':
      return { x: box.x + box.width, y: cy };
    case '-':
      return { x: box.x, y: cy };
    case 'rod':
      return { x: box.x + box.width, y: cy };
    default:
      return { x: cx, y: cy };
  }
}

/**
 * Orthogonal (Manhattan) route between two points: a horizontal-then-vertical
 * two-segment path. Deterministic and free of diagonal wires. When the points
 * already share an axis the middle point collapses (still >= 2 points).
 */
function manhattan(a: Point, b: Point): Point[] {
  if (a.x === b.x || a.y === b.y) return [a, b];
  const mid: Point = { x: b.x, y: a.y };
  return [a, mid, b];
}
