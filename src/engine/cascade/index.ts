/** Cascade engine barrel (método cascata). */

export { divideIntoGroups, cascadeExecutionOrder } from './groups.ts';
export type {
  DividedGroup,
  GroupDivision,
  DivideOptions,
} from './groups.ts';

export { solveCascade } from './solver.ts';
export type { CascadeOptions } from './solver.ts';

export { toCascadeCircuit } from './circuit.ts';
export { explainCascade } from './explanation.ts';

export type {
  CascadeLogicalModel,
  CascadeGroupModel,
  CascadeMemoryValve,
  CascadeMovement,
  CascadeTransition,
} from './model.ts';
