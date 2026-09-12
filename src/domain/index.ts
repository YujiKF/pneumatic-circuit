/**
 * Domain barrel. Interface-independent types + small constructors for the
 * PMR3407 circuit generator. Importing from here keeps the rest of the code
 * decoupled from the individual type modules.
 */

export type {
  ActuatorId,
  Direction,
  Movement,
  Step,
  SequenceModel,
  RestState,
  InitialState,
} from './sequence.ts';

export {
  defaultInitialState,
  initialStateFrom,
  restStateOf,
} from './initial-state.ts';

export type {
  ComponentKind,
  CylinderState,
  RelayState,
  SensorState,
  ValveState,
  Cylinder,
  Sensor,
  SensorPosition,
  ValveType,
  ValveActuation,
  DirectionalValve,
  RelayKind,
  Relay,
  Coil,
  ContactType,
  Contact,
  Memory,
  CascadeGroup,
  SignalType,
  Connection,
  CircuitDomain,
  CircuitComponent,
  Circuit,
  SolverMethod,
} from './components.ts';

export type { Result, Ok, Err, DomainError } from './result.ts';
export { ok, err } from './result.ts';
