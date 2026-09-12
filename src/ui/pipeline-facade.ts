/**
 * UI facade over the pure pipeline API.
 *
 * The UI imports ONLY from here (and the domain types), so the React layer has
 * a single, framework-independent surface to call and never reaches into the
 * solver/renderer internals. This keeps the "logic" and "presentation" split
 * intact: swapping the UI never touches the core.
 *
 * NOTE: relative imports use the `.ts` extension per the project's Node native
 * TS convention; Vite is configured to resolve these.
 */

export { generate } from '../pipeline.ts';
export type {
  GenerateRequest,
  GenerateResult,
  CircuitType,
  Method,
  Mode,
  StepSummary,
  ComponentSummary,
} from '../pipeline.ts';
