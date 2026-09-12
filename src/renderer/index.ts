/**
 * Renderer barrel.
 *
 * A framework-independent SVG symbol library + two renderers that consume a
 * VALIDATED, laid-out {@link Circuit} and produce SVG STRINGS (no DOM/browser).
 * The renderer never decides logic; it refuses to draw an invalid circuit.
 */

export { renderPneumatic } from './pneumatic/index.ts';
export type { PneumaticRenderOptions } from './pneumatic/index.ts';
export { renderLadder } from './electrical/index.ts';
export { assertRenderable, RenderRefusedError } from './guard.ts';

// SVG symbol library (the 11 named classes).
export {
  CylinderSymbol,
  Valve52Symbol,
  Valve32NOSymbol,
  Valve32NCSymbol,
  MechanicalSensorSymbol,
  PneumaticANDSymbol,
  PneumaticORSymbol,
  SolenoidSymbol,
  RelayCoilSymbol,
  NOContactSymbol,
  NCContactSymbol,
} from './symbols.ts';
export type { SymbolOptions } from './symbols.ts';

// Low-level SVG string helpers (useful for tests and custom renderers).
export { svgRoot, group, el, rect, circle, line, polyline, text, esc } from './svg.ts';
