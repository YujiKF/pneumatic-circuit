/**
 * Electrical (ladder) renderer.
 *
 * Draws the electropneumatic ladder diagram as an SVG STRING:
 *  - two vertical rails: +24V (left/top) and 0V (right/bottom),
 *  - numbered rungs (1..N), one per {@link Rung} in the ladder,
 *  - contacts (NO / NC) in each rung's set branches and reset section,
 *  - the coil (relay coil or solenoid) energized at the end of each rung.
 *
 * It consumes a VALIDATED {@link Circuit} (refusing invalid ones via
 * {@link assertRenderable}) and the authoritative {@link CircuitLogicalModel}
 * whose `ladder` carries the rung topology (the flat circuit loses the rung
 * grouping). The renderer NEVER decides logic; it only draws what the ladder
 * already states.
 */

import type { Circuit } from '../../domain/index.ts';
import type { CircuitLogicalModel, Rung, RungContact } from '../../engine/model.ts';
import { assertRenderable } from '../guard.ts';
import { group, line, svgRoot, text } from '../svg.ts';
import { NCContactSymbol, NOContactSymbol, RelayCoilSymbol, SolenoidSymbol } from '../symbols.ts';

/** Deterministic ladder geometry. */
const LADDER = {
  margin: 40,
  railGap: 620,
  rungPitch: 90,
  contactWidth: 70,
  contactPitch: 90,
  coilWidth: 90,
  cellHeight: 70,
} as const;

/**
 * Render the ladder for a solved model to an SVG string.
 * @throws RenderRefusedError if the circuit is invalid/unvalidated.
 */
export function renderLadder(circuit: Circuit, model: CircuitLogicalModel): string {
  assertRenderable(circuit, model);

  const rungs = model.ladder.rungs;
  const { margin, railGap, rungPitch, cellHeight } = LADDER;
  const railLeftX = margin;
  const railRightX = margin + railGap;
  const topY = margin;
  const bottomY = margin + Math.max(1, rungs.length) * rungPitch + margin;
  const width = railRightX + margin;
  const height = bottomY + margin;

  // Rails.
  const rails =
    line(railLeftX, topY, railLeftX, bottomY - margin, { stroke: '#b91c1c', 'stroke-width': 2, class: 'rail rail-top' }) +
    text(railLeftX - 4, topY - 8, '+24V', { 'font-size': 12, fill: '#b91c1c', stroke: 'none', class: 'rail-label rail-plus24' }) +
    line(railRightX, topY, railRightX, bottomY - margin, { stroke: '#111', 'stroke-width': 2, class: 'rail rail-bottom' }) +
    text(railRightX - 4, topY - 8, '0V', { 'font-size': 12, fill: '#111', stroke: 'none', class: 'rail-label rail-0v' });

  const rungSvgs: string[] = rungs.map((rung, i) => renderRung(rung, i, railLeftX, railRightX));

  const body = group('ladder-rails', {}, rails) + group('ladder-rungs', {}, ...rungSvgs);
  return svgRoot(width, height, 'ladder-diagram', body);
}

/** Render a single numbered rung: number label, contacts, then the coil. */
function renderRung(rung: Rung, index: number, railLeftX: number, railRightX: number): string {
  const { margin, rungPitch, contactWidth, contactPitch, coilWidth, cellHeight } = LADDER;
  const y = margin + index * rungPitch;
  const cy = y + cellHeight / 2;

  const parts: string[] = [];

  // Rung number, printed just left of the +24V rail.
  parts.push(
    text(railLeftX - 22, cy + 4, String(rung.number), {
      'font-size': 12,
      fill: '#111',
      stroke: 'none',
      class: `rung-number rung-${rung.number}`,
    }),
  );

  // Flatten the set branches (parallel OR) into a single series line for the
  // primary (first) branch, and draw seal/other branches below it. We draw all
  // contacts left-to-right; parallel branches are stacked and joined by short
  // verticals so the rung stays readable without a full router.
  const primary = rung.setBranches[0]?.contacts ?? [];
  let x = railLeftX + 20;

  // lead-in from rail.
  parts.push(line(railLeftX, cy, x, cy, wire()));

  for (const c of primary) {
    parts.push(contactSymbol(c, x, y, contactWidth, cellHeight));
    x += contactPitch;
  }

  // reset contacts (series NC of next line) continue the primary line.
  for (const c of rung.resetContacts) {
    parts.push(contactSymbol(c, x, y, contactWidth, cellHeight));
    x += contactPitch;
  }

  // Parallel seal / extra branches drawn one row lower, wired around the
  // primary's first contact (a simple, deterministic OR bracket).
  const extraBranches = rung.setBranches.slice(1);
  extraBranches.forEach((branch, bi) => {
    const by = y + (bi + 1) * (cellHeight * 0.6);
    const bcy = by + cellHeight / 2;
    let bx = railLeftX + 20;
    parts.push(line(railLeftX, cy, railLeftX, bcy, wire()));
    parts.push(line(railLeftX, bcy, bx, bcy, wire()));
    for (const c of branch.contacts) {
      parts.push(contactSymbol(c, bx, by, contactWidth, cellHeight));
      bx += contactPitch;
    }
    // rejoin to the primary line.
    parts.push(line(bx, bcy, x, bcy, wire()));
    parts.push(line(x, bcy, x, cy, wire()));
  });

  // Coil (relay or solenoid) sits at the right, wired to the 0V rail.
  const coilX = railRightX - coilWidth - 10;
  const coilOpts = { x: coilX, y, width: coilWidth, height: cellHeight, label: rung.coil.id };
  const coilSvg =
    rung.coil.kind === 'relay' ? new RelayCoilSymbol(coilOpts).render() : new SolenoidSymbol(coilOpts).render();
  parts.push(line(x, cy, coilX, cy, wire()));
  parts.push(coilSvg);
  parts.push(line(coilX + coilWidth, cy, railRightX, cy, wire()));

  return group('ladder-rung', { 'data-rung': rung.number, 'data-coil': rung.coil.id }, ...parts);
}

/** Draw a contact using the NO/NC symbol at a rung slot. */
function contactSymbol(
  c: RungContact,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const opts = { x, y, width, height, label: `${c.driverId}` };
  return c.type === 'NO' ? new NOContactSymbol(opts).render() : new NCContactSymbol(opts).render();
}

function wire(): Record<string, string | number> {
  return { stroke: '#111', 'stroke-width': 1.5 };
}
