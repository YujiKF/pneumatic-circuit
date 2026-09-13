/**
 * Cascade-specific circuit validation pass (método cascata, PMR3407 §7).
 *
 * Checks:
 *  - Memory-count coherence: Nm = max(0, NG - 1) and memories.length == Nm
 *  - Mutual-exclusivity invariant (CASCADE §C7): exactly one line at a time;
 *    memories form a coherent handover chain (no memory activates and
 *    deactivates the same line; all referenced lines exist).
 *  - Transition validity (CASCADE §C5): every group transition's condition
 *    sensor(s) are producible by movements of the predecessor group.
 */

import type { CascadeLogicalModel } from '../engine/cascade/model.ts';
import { ValidationCode, type ValidationIssue } from './validator.ts';

export function validateCascadeModel(
  model: CascadeLogicalModel,
  issues: ValidationIssue[],
): void {
  // 1. Memory-count coherence (Nm = max(0, NG - 1))
  const expectedMemories = Math.max(0, model.numberOfGroups - 1);
  if (
    model.numberOfMemories !== expectedMemories ||
    model.memories.length !== expectedMemories
  ) {
    issues.push({
      code: ValidationCode.LOGICAL_CONFLICT,
      message: `Cascade memory count ${model.numberOfMemories} is incoherent with group count ${model.numberOfGroups} (expected ${expectedMemories}).`,
      subject: `Nm=${model.numberOfMemories}`,
    });
  }

  // 2. Line definitions and mutual exclusivity
  const groupLineIds = new Set<string>();
  for (const g of model.groups) {
    if (groupLineIds.has(g.lineId)) {
      issues.push({
        code: ValidationCode.LOGICAL_CONFLICT,
        message: `Duplicate pressure line id "${g.lineId}" across groups.`,
        subject: g.lineId,
      });
    }
    groupLineIds.add(g.lineId);
  }

  const activatedLines = new Set<string>();
  for (const mem of model.memories) {
    if (mem.activatesLineId === mem.deactivatesLineId) {
      issues.push({
        code: ValidationCode.LOGICAL_CONFLICT,
        message: `Memory "${mem.id}" violates mutual exclusivity: activates and deactivates the same line "${mem.activatesLineId}".`,
        subject: mem.id,
      });
    }
    if (!groupLineIds.has(mem.activatesLineId)) {
      issues.push({
        code: ValidationCode.LOGICAL_CONFLICT,
        message: `Memory "${mem.id}" activates nonexistent line "${mem.activatesLineId}".`,
        subject: mem.id,
      });
    }
    if (!groupLineIds.has(mem.deactivatesLineId)) {
      issues.push({
        code: ValidationCode.LOGICAL_CONFLICT,
        message: `Memory "${mem.id}" deactivates nonexistent line "${mem.deactivatesLineId}".`,
        subject: mem.id,
      });
    }
    if (activatedLines.has(mem.activatesLineId)) {
      issues.push({
        code: ValidationCode.LOGICAL_CONFLICT,
        message: `Multiple memories activate the same line "${mem.activatesLineId}".`,
        subject: mem.id,
      });
    }
    activatedLines.add(mem.activatesLineId);
  }

  // 3. Producible transitions
  const groupById = new Map<number, typeof model.groups[number]>();
  for (const g of model.groups) groupById.set(g.number, g);

  if (model.transitions) {
    for (const tr of model.transitions) {
      const fromGrp = groupById.get(tr.fromGroup);
      if (!fromGrp) {
        issues.push({
          code: ValidationCode.IMPOSSIBLE_TRANSITION,
          message: `Transition references nonexistent source group ${tr.fromGroup}.`,
          subject: tr.memoryId,
        });
        continue;
      }
      for (const sensorId of tr.conditionSensorIds) {
        const producible = fromGrp.movements.some((m) => m.arrivalSensorId === sensorId);
        if (!producible) {
          issues.push({
            code: ValidationCode.IMPOSSIBLE_TRANSITION,
            message: `Transition from Group ${tr.fromGroup} to Group ${tr.toGroup} waits on sensor "${sensorId}" that is not produced by any movement in Group ${tr.fromGroup}.`,
            subject: tr.memoryId,
          });
        }
      }
    }
  }
}
