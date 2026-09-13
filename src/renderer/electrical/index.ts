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
import { circle, group, line, svgRoot, text } from '../svg.ts';
import { NCContactSymbol, NOContactSymbol, RelayCoilSymbol, SolenoidSymbol } from '../symbols.ts';

/** Deterministic ladder geometry. */
const LADDER = {
  margin: 40,
  railGap: 620,
  rungPitch: 100,
  contactWidth: 90,
  contactPitch: 90,
  coilWidth: 90,
  cellHeight: 70,
  branchSpacing: 70,
} as const;

/**
 * Render the ladder for a solved model to an SVG string.
 * @throws RenderRefusedError if the circuit is invalid/unvalidated.
 */
export function renderLadder(circuit: Circuit, model: CircuitLogicalModel): string {
  assertRenderable(circuit, model);

  const rungs = model.ladder.rungs;
  const { margin, railGap, rungPitch, branchSpacing } = LADDER;
  const railLeftX = margin;
  const railRightX = margin + railGap;
  const topY = margin;

  // Calculate dynamic vertical positions for each rung so that multi-branch rungs
  // (with seal and wrap) never overlap adjacent rungs.
  let currentY = margin;
  const rungYs: number[] = [];
  for (const rung of rungs) {
    rungYs.push(currentY);
    const extraBranchesCount = Math.max(0, rung.setBranches.length - 1);
    currentY += rungPitch + extraBranchesCount * branchSpacing;
  }
  const bottomY = currentY + margin;
  const width = railRightX + margin;
  const height = bottomY;

  // Rails.
  const rails =
    line(railLeftX, topY, railLeftX, bottomY - margin, { stroke: '#b91c1c', 'stroke-width': 2, class: 'rail rail-top' }) +
    text(railLeftX - 4, topY - 8, '+24V', { 'font-size': 12, fill: '#b91c1c', stroke: 'none', class: 'rail-label rail-plus24' }) +
    line(railRightX, topY, railRightX, bottomY - margin, { stroke: '#111', 'stroke-width': 2, class: 'rail rail-bottom' }) +
    text(railRightX - 4, topY - 8, '0V', { 'font-size': 12, fill: '#111', stroke: 'none', class: 'rail-label rail-0v' });

  const rungSvgs: string[] = rungs.map((rung, i) => renderRung(rung, rungYs[i]!, railLeftX, railRightX));

  const body = group('ladder-rails', {}, rails) + group('ladder-rungs', {}, ...rungSvgs);
  return svgRoot(width, height, 'ladder-diagram', body);
}

/** Render a single numbered rung: number label, contacts, then the coil. */
function renderRung(rung: Rung, y: number, railLeftX: number, railRightX: number): string {
  const { contactWidth, contactPitch, coilWidth, cellHeight, branchSpacing } = LADDER;
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

  const primary = rung.setBranches[0]?.contacts ?? [];
  const extraBranches = rung.setBranches.slice(1);
  const setStartX = railLeftX + 20;

  // lead-in from rail to set branches start
  parts.push(line(railLeftX, cy, setStartX, cy, wire()));

  // Render primary branch contacts
  let primaryX = setStartX;
  for (const c of primary) {
    parts.push(contactSymbol(c, primaryX, y, contactWidth, cellHeight));
    if (contactWidth < contactPitch) {
      parts.push(line(primaryX + contactWidth, cy, primaryX + contactPitch, cy, wire()));
    }
    primaryX += contactPitch;
  }

  // Render extra branches (SELO, wrap) in parallel
  let maxExtraX = setStartX;
  extraBranches.forEach((branch, bi) => {
    const by = y + (bi + 1) * branchSpacing;
    const bcy = by + cellHeight / 2;
    let bx = setStartX;
    for (const c of branch.contacts) {
      parts.push(contactSymbol(c, bx, by, contactWidth, cellHeight));
      if (contactWidth < contactPitch) {
        parts.push(line(bx + contactWidth, bcy, bx + contactPitch, bcy, wire()));
      }
      bx += contactPitch;
    }
    maxExtraX = Math.max(maxExtraX, bx);
  });

  // Junction where all parallel set branches merge
  const setJoinX = Math.max(primaryX, maxExtraX);

  // Extend primary branch to setJoinX
  if (primaryX < setJoinX) {
    parts.push(line(primaryX, cy, setJoinX, cy, wire()));
  }

  // Wire extra branches without duplicate vertical lines
  if (extraBranches.length > 0) {
    const maxBcy = y + extraBranches.length * branchSpacing + cellHeight / 2;
    // Single vertical bus dropping from primary rail to bottom branch
    parts.push(line(setStartX, cy, setStartX, maxBcy, wire()));
    // Single vertical bus rising from bottom branch to primary rail
    parts.push(line(setJoinX, cy, setJoinX, maxBcy, wire()));

    // Top junction dots where buses meet the primary branch wire
    parts.push(circle(setStartX, cy, 2.5, { fill: '#111', stroke: 'none' }));
    parts.push(circle(setJoinX, cy, 2.5, { fill: '#111', stroke: 'none' }));

    extraBranches.forEach((branch, bi) => {
      const by = y + (bi + 1) * branchSpacing;
      const bcy = by + cellHeight / 2;
      const branchEndX = setStartX + branch.contacts.length * contactPitch;
      if (branchEndX < setJoinX) {
        parts.push(line(branchEndX, bcy, setJoinX, bcy, wire()));
      }
      // Intermediate T-junction dots for branches above the lowest
      if (bi < extraBranches.length - 1) {
        parts.push(circle(setStartX, bcy, 2.5, { fill: '#111', stroke: 'none' }));
        parts.push(circle(setJoinX, bcy, 2.5, { fill: '#111', stroke: 'none' }));
      }
    });
  }

  // Render series reset contacts starting AT setJoinX
  let currentX = setJoinX;
  for (const c of rung.resetContacts) {
    parts.push(contactSymbol(c, currentX, y, contactWidth, cellHeight));
    if (contactWidth < contactPitch) {
      parts.push(line(currentX + contactWidth, cy, currentX + contactPitch, cy, wire()));
    }
    currentX += contactPitch;
  }

  // Coil (relay or solenoid) sits at the right, wired to the 0V rail.
  const coilX = railRightX - coilWidth - 10;
  const coilOpts = { x: coilX, y, width: coilWidth, height: cellHeight, label: rung.coil.id };
  const coilSvg =
    rung.coil.kind === 'relay' ? new RelayCoilSymbol(coilOpts).render() : new SolenoidSymbol(coilOpts).render();
  parts.push(line(currentX, cy, coilX, cy, wire()));
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
