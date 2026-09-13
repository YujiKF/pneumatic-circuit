/**
 * Chronological explanation for the pneumatic cascade method (PMR3407 §7, §C4.2, §C5).
 *
 * Derived directly from the {@link CascadeLogicalModel} and its group execution order.
 * Follows the cycle-ordered progression:
 *  1. Line 1 pressurized via start valve E.
 *  2. Intra-group movements driven by the current line and gated by intra-group sensors.
 *  3. Last event of a group trips the group activation sensor(s).
 *  4. Activation sensor pilots memory valve Mk (SET port 14).
 *  5. Memory valve Mk sets line L(k+1) live and resets previous line Lk.
 *  6. Control continues through all groups.
 *  7. Wrap back to line 1 at cycle completion.
 */

import type { CascadeLogicalModel, CascadeMemoryValve, CascadeTransition } from './model.ts';

/** Map an actuator letter to its human label ("cylinder A"). */
function cylinderLabel(actuator: string): string {
  return `cylinder ${actuator}`;
}

/**
 * Generate chronological narrative lines for a cascade model.
 * `numbered` prefixes "N. " to each line (default true).
 */
export function explainCascade(
  model: CascadeLogicalModel,
  options: { numbered?: boolean } = {},
): string[] {
  const numbered = options.numbered ?? true;
  const lines: string[] = [];

  lines.push(`Start valve ${model.startButtonId} is actuated, pressurizing line L1.`);

  const groups = model.groups;
  const memoriesByToGroup = new Map<number, CascadeMemoryValve>();
  for (const mem of model.memories) {
    const targetGroup = parseInt(mem.activatesLineId.slice(1), 10);
    memoriesByToGroup.set(targetGroup, mem);
  }

  const transitionsByToGroup = new Map<number, CascadeTransition>();
  for (const tr of model.transitions) {
    transitionsByToGroup.set(tr.toGroup, tr);
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;

    // Group transition (for groups after the first)
    if (group.number > 1) {
      const mem = memoriesByToGroup.get(group.number);
      const tr = transitionsByToGroup.get(group.number);
      const condSensors = tr?.conditionSensorIds ?? (group.activationSensorId ? [group.activationSensorId] : []);
      const condText = condSensors.join(' and ');

      lines.push(`Last event of previous group trips activation sensor ${condText}.`);
      if (mem) {
        lines.push(`Sensor ${condText} pilots SET (port 14) of memory valve ${mem.id} (${mem.valveId}).`);
        lines.push(`Memory valve ${mem.id} sets line ${mem.activatesLineId} live.`);
        lines.push(`Memory valve ${mem.id} resets previous line ${mem.deactivatesLineId}.`);
      } else {
        lines.push(`Line ${group.lineId} is pressurized.`);
      }
    }

    // Movements of this group (excluding merged tail of group 1 if merged)
    const movementsToRun =
      group.number === 1 && model.merged && model.division
        ? group.movements.slice(
            0,
            group.movements.length - (model.division.groups[0]?.mergedTailCount ?? 0),
          )
        : group.movements;

    for (const mv of movementsToRun) {
      const verb = mv.direction === '+' ? 'advances' : 'retracts';
      if (mv.startSensorId) {
        lines.push(
          `Sensor ${mv.startSensorId} passes line ${group.lineId} pressure to pilot ${mv.pilotPort} of valve ${mv.mainValveId}.`,
        );
      } else {
        lines.push(
          `Line ${group.lineId} pressure feeds pilot ${mv.pilotPort} of valve ${mv.mainValveId}.`,
        );
      }
      lines.push(`The valve of ${cylinderLabel(mv.actuator)} switches.`);
      lines.push(`${cylinderLabel(mv.actuator)} ${verb} (${mv.actuator}${mv.direction}).`);
      lines.push(`Sensor ${mv.arrivalSensorId} becomes active.`);
    }
  }

  // If merged, run trailing movements of group 1
  if (model.merged && model.division) {
    const tailCount = model.division.groups[0]?.mergedTailCount ?? 0;
    if (tailCount > 0) {
      const firstGroup = groups[0]!;
      const tailMovements = firstGroup.movements.slice(firstGroup.movements.length - tailCount);
      lines.push(`Control wraps back to line L1 to execute trailing movements.`);
      for (const mv of tailMovements) {
        const verb = mv.direction === '+' ? 'advances' : 'retracts';
        if (mv.startSensorId) {
          lines.push(
            `Sensor ${mv.startSensorId} passes line L1 pressure to pilot ${mv.pilotPort} of valve ${mv.mainValveId}.`,
          );
        } else {
          lines.push(
            `Line L1 pressure feeds pilot ${mv.pilotPort} of valve ${mv.mainValveId}.`,
          );
        }
        lines.push(`The valve of ${cylinderLabel(mv.actuator)} switches.`);
        lines.push(`${cylinderLabel(mv.actuator)} ${verb} (${mv.actuator}${mv.direction}).`);
        lines.push(`Sensor ${mv.arrivalSensorId} becomes active.`);
      }
    }
  }

  // Cycle completion and wrap
  lines.push(`Control wraps to line L1, resetting the memory chain.`);
  lines.push(`The cycle for ${model.sequence} is complete.`);

  if (!numbered) return lines;
  return lines.map((l, i) => `${i + 1}. ${l}`);
}
