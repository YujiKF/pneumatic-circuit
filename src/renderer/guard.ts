/**
 * Render guard.
 *
 * The renderer NEVER decides logic and MUST REFUSE to draw a circuit that has
 * not been validated (or that fails validation). This centralizes that policy:
 * `assertRenderable` runs the {@link validateCircuit} check and throws a
 * {@link RenderRefusedError} with the collected issue codes if the circuit is
 * invalid. Callers pass the optional logical model so the deeper logical checks
 * (seal presence, step exits, ...) also run.
 */

import type { Circuit } from '../domain/index.ts';
import type { CircuitLogicalModel } from '../engine/model.ts';
import { validateCircuit } from '../validator/index.ts';
import type { ValidationIssue } from '../validator/index.ts';

/** Thrown when the renderer refuses to draw an invalid/unvalidated circuit. */
export class RenderRefusedError extends Error {
  readonly issues: readonly ValidationIssue[];
  constructor(issues: readonly ValidationIssue[]) {
    const codes = issues.map((i) => i.code).join(', ');
    super(
      `Renderer refused to draw an invalid circuit (${issues.length} issue(s): ${codes}). ` +
        `The renderer only draws a VALIDATED circuit and never decides logic.`,
    );
    this.name = 'RenderRefusedError';
    this.issues = issues;
  }
}

/**
 * Validate `circuit` and throw {@link RenderRefusedError} if it is not
 * renderable. Returns nothing on success.
 */
export function assertRenderable(circuit: Circuit, model?: CircuitLogicalModel): void {
  // Route EVERY refusal reason through the validator (single validation path).
  // A missing/malformed circuit is handled inside validateCircuit, which emits
  // a real LOGICAL_CONFLICT issue rather than the guard fabricating a code.
  const report = validateCircuit(circuit, model);
  if (!report.ok) {
    throw new RenderRefusedError(report.issues);
  }
}
