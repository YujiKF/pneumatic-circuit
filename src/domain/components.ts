/**
 * Circuit component domain types (pneumatic + electropneumatic).
 *
 * These describe the LOGICAL circuit produced by a solver method. They are
 * intentionally free of layout/geometry: the LayoutEngine and SVGRenderer add
 * positions later, and the renderer never decides logic.
 *
 * No enums (Node strip-only forbids them); closed sets are string-literal
 * unions. Naming conventions (1.0, 1.1, 1S1, 1Y1, K1, ...) are documented in
 * docs/PMR3407_RULES.md, "Element numbering" and "Electropneumatic naming".
 */

import type { ActuatorId, Direction } from './sequence.ts';

/** Discriminant tag for a component kind. */
export type ComponentKind =
  | 'cylinder'
  | 'sensor'
  | 'directional-valve'
  | 'relay'
  | 'contact'
  | 'coil'
  | 'memory';

// ---------------------------------------------------------------------------
// Runtime state models (used by the future Simulator; declared here so the
// domain is the single source of truth).
// ---------------------------------------------------------------------------

/** Motion/rest state of a cylinder during simulation. */
export type CylinderState =
  | 'RETRACTED'
  | 'MOVING_FORWARD'
  | 'EXTENDED'
  | 'MOVING_BACKWARD';

/** Energized state of a relay/coil during simulation. */
export type RelayState = 'ON' | 'OFF';

/** Whether a sensor is currently tripped. */
export type SensorState = 'ACTIVE' | 'INACTIVE';

/** Which of the two positions a directional valve currently occupies. */
export type ValveState = 'STATE_1' | 'STATE_2';

// ---------------------------------------------------------------------------
// Pneumatic components
// ---------------------------------------------------------------------------

/**
 * A double-acting cylinder / actuator.
 * `id` is the course number, e.g. "1.0" for cylinder A. See
 * docs/PMR3407_RULES.md, "Element numbering".
 */
export interface Cylinder {
  readonly kind: 'cylinder';
  /** Course element id, e.g. "1.0", "2.0". */
  readonly id: string;
  /** Actuator letter this cylinder implements, e.g. "A". */
  readonly actuator: ActuatorId;
}

/**
 * End-of-stroke position a sensor watches.
 * 'retracted' = cylinder home (recuado), 'extended' = cylinder out (avancado).
 * See docs/PMR3407_RULES.md, "Ambiguities" for the chosen .2/.3 and S1/S2
 * mapping.
 */
export type SensorPosition = 'retracted' | 'extended';

/**
 * A limit/signal element that reports when a cylinder reaches an end position.
 * In pneumatic circuits it is a limit valve numbered N.2 / N.3; in
 * electropneumatic circuits it is an electrical sensor named e.g. "1S1"/"1S2".
 */
export interface Sensor {
  readonly kind: 'sensor';
  /** Course id, e.g. "1.2"/"1.3" (pneumatic) or "1S1"/"1S2" (electric). */
  readonly id: string;
  /** Actuator whose stroke the sensor watches. */
  readonly actuator: ActuatorId;
  /** End position the sensor detects. */
  readonly position: SensorPosition;
}

/** Number of ports / switching positions of a directional valve. */
export type ValveType = '3/2' | '5/2' | '5/3';

/** How the valve is returned/held: spring, single or double pilot/solenoid. */
export type ValveActuation = 'spring-return' | 'single-pilot' | 'double-pilot';

/**
 * A directional control valve. The MAIN valve driving cylinder N is numbered
 * N.1 (e.g. "1.1"). See docs/PMR3407_RULES.md, "Element numbering" and
 * "Port labels".
 */
export interface DirectionalValve {
  readonly kind: 'directional-valve';
  /** Course id, e.g. "1.1". */
  readonly id: string;
  readonly valveType: ValveType;
  readonly actuation: ValveActuation;
  /** Actuator this valve drives (undefined for supply/cascade valves). */
  readonly actuator?: ActuatorId;
}

// ---------------------------------------------------------------------------
// Electropneumatic components
// ---------------------------------------------------------------------------

/** Kind of control relay. K = control, KC = counter, timer = boxed delay. */
export type RelayKind = 'control' | 'counter' | 'timer';

/**
 * A control relay (contactor). `id` is e.g. "K1". For a timer relay,
 * `delaySeconds` holds the boxed delay value (e.g. 0.3). See
 * docs/PMR3407_RULES.md, "Electropneumatic naming".
 */
export interface Relay {
  readonly kind: 'relay';
  readonly id: string;
  readonly relayKind: RelayKind;
  /** Delay in seconds for timer relays; undefined otherwise. */
  readonly delaySeconds?: number;
}

/** A relay coil (the energizing element of a relay, drawn on a rung). */
export interface Coil {
  readonly kind: 'coil';
  readonly id: string;
  /** Relay id this coil belongs to, e.g. "K1". */
  readonly relayId: string;
}

/** Contact behaviour: normally-open (fechador/NA) or normally-closed (abridor/NF). */
export type ContactType = 'NO' | 'NC';

/**
 * A relay/sensor/button contact placed on a rung.
 * `ownerId` is the element that drives the contact (a relay "K1", a sensor
 * "1S1", or a button). See docs/PMR3407_RULES.md, "Electropneumatic naming".
 */
export interface Contact {
  readonly kind: 'contact';
  readonly id: string;
  readonly contactType: ContactType;
  /** Id of the driving element (relay/sensor/button). */
  readonly ownerId: string;
}

/**
 * A logical memory (bistable). In pneumatics it maps to a double-pilot 5/2
 * valve; in electropneumatics to a sealed relay. Used by cascade and
 * step-by-step to hold a group/step active.
 */
export interface Memory {
  readonly kind: 'memory';
  readonly id: string;
  /** Whether a seal/hold (SELO) contact keeps this memory latched. */
  readonly sealed: boolean;
}

// ---------------------------------------------------------------------------
// Aggregates used by solver methods
// ---------------------------------------------------------------------------

/**
 * A cascade group: a maximal run of steps that contains no actuator moving in
 * both directions. See docs/PMR3407_RULES.md, "Cascade method".
 */
export interface CascadeGroup {
  /** 1-based group number (Grupo 1, Grupo 2, ...). */
  readonly number: number;
  /** Indices (into SequenceModel.steps) belonging to this group. */
  readonly stepIndices: readonly number[];
  /** Id of the pressure line/memory feeding this group, e.g. "L1". */
  readonly lineId: string;
}

// ---------------------------------------------------------------------------
// Connections and the assembled circuit
// ---------------------------------------------------------------------------

/** Nature of a connection. */
export type SignalType = 'pneumatic' | 'electric';

/**
 * A directed connection between two component ports.
 * Port labels follow docs/PMR3407_RULES.md, "Port labels" for pneumatic
 * (1,2,3,4,5,10,12,14) and rung/rail names for electric.
 */
export interface Connection {
  readonly sourceComponent: string;
  readonly sourcePort: string;
  readonly targetComponent: string;
  readonly targetPort: string;
  readonly signalType: SignalType;
}

/** Domain of a circuit: purely pneumatic or electropneumatic. */
export type CircuitDomain = 'pneumatic' | 'electropneumatic';

/** Any logical component that can appear in a circuit. */
export type CircuitComponent =
  | Cylinder
  | Sensor
  | DirectionalValve
  | Relay
  | Coil
  | Contact
  | Memory;

/**
 * The complete logical circuit produced by a solver method and consumed by the
 * validator, layout engine, renderer and simulator. Contains no geometry.
 */
export interface Circuit {
  readonly domain: CircuitDomain;
  /** The method that produced this circuit. */
  readonly method: SolverMethod;
  readonly components: readonly CircuitComponent[];
  readonly connections: readonly Connection[];
  /** Cascade groups, when the method is cascade; empty otherwise. */
  readonly groups: readonly CascadeGroup[];
  /** Human-readable, ordered explanation lines derived by the solver. */
  readonly explanation: readonly string[];
}

/** The PMR3407 solution methods. */
export type SolverMethod = 'intuitive' | 'cascade' | 'step-by-step';

/** Re-exported for convenience in the barrel. */
export type { ActuatorId, Direction };
