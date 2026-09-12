/**
 * Tiny, dependency-free SVG string helpers.
 *
 * The renderer produces SVG as PLAIN STRINGS (no DOM, no browser), so it runs
 * and is unit-tested headless under `node --test`. These helpers keep element
 * construction terse and escape attribute/text values.
 */

/** Escape a value for safe inclusion in an XML attribute or text node. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Attribute bag -> ` k="v" ...` (stable key order = insertion order). */
export function attrs(map: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    parts.push(`${k}="${esc(v)}"`);
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

/** An open/closed element with children. */
export function el(
  tag: string,
  attributes: Record<string, string | number | undefined>,
  ...children: string[]
): string {
  const body = children.join('');
  if (body.length === 0) return `<${tag}${attrs(attributes)}/>`;
  return `<${tag}${attrs(attributes)}>${body}</${tag}>`;
}

/** A `<g>` group with a class + optional transform. */
export function group(
  className: string,
  attributes: Record<string, string | number | undefined>,
  ...children: string[]
): string {
  return el('g', { class: className, ...attributes }, ...children);
}

/** A polyline through the given points. */
export function polyline(
  points: readonly { x: number; y: number }[],
  attributes: Record<string, string | number | undefined> = {},
): string {
  const pts = points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
  return el('polyline', { points: pts, fill: 'none', ...attributes });
}

export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  attributes: Record<string, string | number | undefined> = {},
): string {
  return el('line', {
    x1: round(x1),
    y1: round(y1),
    x2: round(x2),
    y2: round(y2),
    ...attributes,
  });
}

export function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  attributes: Record<string, string | number | undefined> = {},
): string {
  return el('rect', { x: round(x), y: round(y), width: round(w), height: round(h), ...attributes });
}

export function circle(
  cx: number,
  cy: number,
  r: number,
  attributes: Record<string, string | number | undefined> = {},
): string {
  return el('circle', { cx: round(cx), cy: round(cy), r: round(r), ...attributes });
}

export function text(
  x: number,
  y: number,
  content: string,
  attributes: Record<string, string | number | undefined> = {},
): string {
  return el('text', { x: round(x), y: round(y), ...attributes }, esc(content));
}

/** Round to 2 decimals so string output is stable and compact. */
export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Wrap body in a root `<svg>` with a viewBox. */
export function svgRoot(width: number, height: number, className: string, body: string): string {
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${round(width)} ${round(height)}`,
      width: round(width),
      height: round(height),
      class: className,
    },
    body,
  );
}
