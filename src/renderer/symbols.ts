/**
 * Reusable SVG symbol library for PMR3407 circuits.
 *
 * Each symbol is a small class whose `render()` returns an SVG `<g>` string
 * (no DOM/browser required). Symbols follow PMR3407 conventions:
 *  - pneumatic port labels: P=1, service A=2 / B=4, exhausts R=3 / S=5,
 *    pilots 10 / 12 / 14 (docs/PMR3407_RULES.md, "Port labels").
 *  - ladder elements: NO (fechador) / NC (abridor) contacts, relay coils,
 *    solenoids (1Y1, 1Y2, ...).
 *
 * All classes accept a plain options object (no TS parameter properties, which
 * Node strip-only mode forbids) and expose the exact names required:
 *   CylinderSymbol, Valve52Symbol, Valve32NOSymbol, Valve32NCSymbol,
 *   MechanicalSensorSymbol, PneumaticANDSymbol, PneumaticORSymbol,
 *   SolenoidSymbol, RelayCoilSymbol, NOContactSymbol, NCContactSymbol.
 *
 * A symbol only KNOWS how to draw itself at a given (x,y); it never decides
 * logic or global placement (that is the layout engine's job).
 */

import { circle, esc, group, line, polyline, rect, text } from './svg.ts';

/** Common options shared by every symbol. */
export interface SymbolOptions {
  /** Top-left x of the symbol footprint. */
  readonly x: number;
  /** Top-left y of the symbol footprint. */
  readonly y: number;
  /** Footprint width. */
  readonly width?: number;
  /** Footprint height. */
  readonly height?: number;
  /** Element id/label shown near the symbol (e.g. "1.1", "K1", "1Y1"). */
  readonly label?: string;
}

const DEFAULT_W = 90;
const DEFAULT_H = 90;
const STROKE = '#111';
const STROKE_W = 2;

/** Base helper resolving footprint + a stable group class/id. */
function frame(opts: SymbolOptions): {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
} {
  const w = opts.width ?? DEFAULT_W;
  const h = opts.height ?? DEFAULT_H;
  return { x: opts.x, y: opts.y, w, h, cx: opts.x + w / 2, cy: opts.y + h / 2 };
}

const baseAttrs = { stroke: STROKE, 'stroke-width': STROKE_W, fill: 'none' } as const;

function labelText(f: { cx: number; y: number }, label?: string): string {
  if (label === undefined) return '';
  return text(f.cx, f.y - 6, label, {
    'text-anchor': 'middle',
    'font-size': 12,
    fill: STROKE,
    stroke: 'none',
    class: 'symbol-label',
  });
}

/** Small port marker + its numeric/letter label. */
function port(px: number, py: number, name: string): string {
  return (
    circle(px, py, 2.5, { fill: STROKE, stroke: 'none', class: `port port-${esc(name)}` }) +
    text(px + 4, py - 4, name, { 'font-size': 9, fill: '#555', stroke: 'none', class: 'port-label' })
  );
}

// ---------------------------------------------------------------------------
// Pneumatic symbols
// ---------------------------------------------------------------------------

/** Double-acting cylinder (atuador de dupla acao). */
export class CylinderSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    const barrelH = f.h * 0.5;
    const barrelY = f.y + (f.h - barrelH) / 2;
    const pistonX = f.x + f.w * 0.45;
    const rodY = barrelY + barrelH / 2;
    return group(
      'CylinderSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'cylinder' },
      rect(f.x, barrelY, f.w * 0.7, barrelH, baseAttrs),
      // piston + rod extending to the right (rod port).
      line(pistonX, barrelY, pistonX, barrelY + barrelH, baseAttrs),
      line(pistonX, rodY, f.x + f.w, rodY, baseAttrs),
      port(f.x, rodY, '-'),
      port(f.x + f.w, rodY, '+'),
      labelText(f, this.opts.label),
    );
  }
}

/** 5/2 directional valve (two boxes, five ports, two positions). */
export class Valve52Symbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    const halfW = f.w / 2;
    return group(
      'Valve52Symbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'directional-valve', 'data-valve': '5/2' },
      rect(f.x, f.y, halfW, f.h, baseAttrs),
      rect(f.x + halfW, f.y, halfW, f.h, baseAttrs),
      // service ports on top (2,4), supply+exhausts on bottom (1,3,5), pilots.
      port(f.x + f.w * 0.25, f.y, '2'),
      port(f.x + f.w * 0.75, f.y, '4'),
      port(f.x + f.w * 0.5, f.y + f.h, '1'),
      port(f.x + f.w * 0.2, f.y + f.h, '3'),
      port(f.x + f.w * 0.8, f.y + f.h, '5'),
      port(f.x, f.y + f.h / 2, '14'),
      port(f.x + f.w, f.y + f.h / 2, '12'),
      labelText(f, this.opts.label),
    );
  }
}

/** 3/2 normally-open directional valve (NA / normalmente aberta). */
export class Valve32NOSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    const halfW = f.w / 2;
    return group(
      'Valve32NOSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'directional-valve', 'data-valve': '3/2', 'data-normal': 'open' },
      rect(f.x, f.y, halfW, f.h, baseAttrs),
      rect(f.x + halfW, f.y, halfW, f.h, baseAttrs),
      port(f.x + f.w * 0.5, f.y, '2'),
      port(f.x + f.w * 0.35, f.y + f.h, '1'),
      port(f.x + f.w * 0.7, f.y + f.h, '3'),
      port(f.x, f.y + f.h / 2, '12'),
      labelText(f, this.opts.label),
    );
  }
}

/** 3/2 normally-closed directional valve (NF / normalmente fechada). */
export class Valve32NCSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    const halfW = f.w / 2;
    return group(
      'Valve32NCSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'directional-valve', 'data-valve': '3/2', 'data-normal': 'closed' },
      rect(f.x, f.y, halfW, f.h, baseAttrs),
      rect(f.x + halfW, f.y, halfW, f.h, baseAttrs),
      port(f.x + f.w * 0.5, f.y, '2'),
      port(f.x + f.w * 0.35, f.y + f.h, '1'),
      port(f.x + f.w * 0.7, f.y + f.h, '3'),
      port(f.x, f.y + f.h / 2, '12'),
      labelText(f, this.opts.label),
    );
  }
}

/** Mechanical roller/limit sensor (fim-de-curso mecanico). */
export class MechanicalSensorSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    const boxH = f.h * 0.5;
    const boxY = f.y + (f.h - boxH) / 2;
    const rollerR = f.w * 0.12;
    return group(
      'MechanicalSensorSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'sensor' },
      rect(f.x + f.w * 0.2, boxY, f.w * 0.6, boxH, baseAttrs),
      // roller actuator on top.
      line(f.cx, boxY, f.cx, f.y + rollerR, baseAttrs),
      circle(f.cx, f.y + rollerR, rollerR, baseAttrs),
      port(f.x + f.w * 0.2, boxY + boxH / 2, 'in'),
      port(f.x + f.w * 0.8, boxY + boxH / 2, 'out'),
      labelText(f, this.opts.label),
    );
  }
}

/** Pneumatic AND (dupla pressao / elemento E). */
export class PneumaticANDSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    return group(
      'PneumaticANDSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'pneumatic-and' },
      rect(f.x + f.w * 0.25, f.y + f.h * 0.25, f.w * 0.5, f.h * 0.5, baseAttrs),
      text(f.cx, f.cy + 4, '&', { 'text-anchor': 'middle', 'font-size': 16, fill: STROKE, stroke: 'none' }),
      port(f.x + f.w * 0.25, f.cy, '1'),
      port(f.x + f.w * 0.75, f.cy, '1(2)'),
      port(f.cx, f.y + f.h * 0.75, '2'),
      labelText(f, this.opts.label),
    );
  }
}

/** Pneumatic OR (elemento OU / valvula alternadora / shuttle). */
export class PneumaticORSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    return group(
      'PneumaticORSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'pneumatic-or' },
      circle(f.cx, f.cy, f.w * 0.28, baseAttrs),
      text(f.cx, f.cy + 5, '\u22651', { 'text-anchor': 'middle', 'font-size': 14, fill: STROKE, stroke: 'none' }),
      port(f.x + f.w * 0.22, f.cy, '1'),
      port(f.x + f.w * 0.78, f.cy, '1(3)'),
      port(f.cx, f.y + f.h * 0.78, '2'),
      labelText(f, this.opts.label),
    );
  }
}

// ---------------------------------------------------------------------------
// Electropneumatic / ladder symbols
// ---------------------------------------------------------------------------

/** Solenoid coil driving a valve pilot (e.g. 1Y1, 1Y2). */
export class SolenoidSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    const boxW = f.w * 0.5;
    const boxH = f.h * 0.4;
    const bx = f.cx - boxW / 2;
    const by = f.cy - boxH / 2;
    return group(
      'SolenoidSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'solenoid' },
      rect(bx, by, boxW, boxH, baseAttrs),
      // diagonal slash denoting a solenoid.
      line(bx, by + boxH, bx + boxW, by, baseAttrs),
      line(bx, f.cy, f.x, f.cy, baseAttrs),
      line(bx + boxW, f.cy, f.x + f.w, f.cy, baseAttrs),
      port(f.x, f.cy, 'in'),
      port(f.x + f.w, f.cy, 'out'),
      labelText(f, this.opts.label),
    );
  }
}

/** Relay coil (bobina de rele, e.g. K1). Drawn as a rung element. */
export class RelayCoilSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    const boxW = f.w * 0.5;
    const boxH = f.h * 0.4;
    const bx = f.cx - boxW / 2;
    const by = f.cy - boxH / 2;
    return group(
      'RelayCoilSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'coil' },
      circle(f.cx, f.cy, boxH / 2, baseAttrs),
      line(bx, f.cy, f.x, f.cy, baseAttrs),
      line(bx + boxW, f.cy, f.x + f.w, f.cy, baseAttrs),
      port(f.x, f.cy, 'a1'),
      port(f.x + f.w, f.cy, 'a2'),
      labelText(f, this.opts.label),
    );
  }
}

/** Normally-open contact (contato fechador / NA). */
export class NOContactSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    const gap = f.w * 0.22;
    const leftX = f.cx - gap / 2;
    const rightX = f.cx + gap / 2;
    return group(
      'NOContactSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'contact', 'data-contact': 'NO' },
      line(f.x, f.cy, leftX, f.cy, baseAttrs),
      line(rightX, f.cy, f.x + f.w, f.cy, baseAttrs),
      // hinged bar (open, angled up-left).
      line(leftX, f.cy, rightX - gap * 0.15, f.cy - gap * 0.7, baseAttrs),
      port(f.x, f.cy, 'in'),
      port(f.x + f.w, f.cy, 'out'),
      labelText(f, this.opts.label),
    );
  }
}

/** Normally-closed contact (contato abridor / NF). */
export class NCContactSymbol {
  private readonly opts: SymbolOptions;
  constructor(opts: SymbolOptions) {
    this.opts = opts;
  }
  render(): string {
    const f = frame(this.opts);
    const gap = f.w * 0.22;
    const leftX = f.cx - gap / 2;
    const rightX = f.cx + gap / 2;
    return group(
      'NCContactSymbol',
      { 'data-id': this.opts.label ?? '', 'data-kind': 'contact', 'data-contact': 'NC' },
      line(f.x, f.cy, leftX, f.cy, baseAttrs),
      line(rightX, f.cy, f.x + f.w, f.cy, baseAttrs),
      // hinged bar crossing the gap (closed) with the NC cross-bar.
      line(leftX, f.cy, rightX, f.cy - gap * 0.7, baseAttrs),
      line(rightX, f.cy - gap * 0.9, rightX, f.cy + gap * 0.3, baseAttrs),
      port(f.x, f.cy, 'in'),
      port(f.x + f.w, f.cy, 'out'),
      labelText(f, this.opts.label),
    );
  }
}
