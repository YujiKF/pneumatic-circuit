/** Engine barrel: solver + logical model + circuit projection + naming. */

export { solveStepByStep } from './step-by-step/index.ts';
export type { StepByStepOptions } from './step-by-step/index.ts';
export {
  divideIntoGroups,
  cascadeExecutionOrder,
  solveCascade,
  toCascadeCircuit,
  explainCascade,
} from './cascade/index.ts';
export type {
  DividedGroup,
  GroupDivision,
  DivideOptions,
  CascadeOptions,
  CascadeLogicalModel,
  CascadeGroupModel,
  CascadeMemoryValve,
  CascadeMovement,
  CascadeTransition,
} from './cascade/index.ts';
export { toCircuit } from './circuit.ts';
export * as naming from './naming.ts';

export type {
  CircuitLogicalModel,
  CycleMode,
  Ladder,
  PlanStep,
  PlanMovement,
  PneumaticModel,
  PneumaticCylinder,
  PneumaticValve,
  Rung,
  RungBranch,
  RungContact,
  RungCoil,
} from './model.ts';
