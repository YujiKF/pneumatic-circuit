/**
 * Sequence domain types.
 *
 * These types are the interface-independent representation of an actuation
 * sequence as taught in PMR3407. A raw textual sequence (e.g. "A+B-T(A-B-)B+")
 * is parsed into a {@link SequenceModel}: an ordered list of {@link Step}s,
 * where each step contains one OR MORE simultaneous {@link Movement}s and an
 * optional timer flag.
 *
 * No enums are used: Node v22 native type-stripping forbids them. All closed
 * sets are expressed as string-literal union types.
 */

/**
 * Direction of a single cylinder movement.
 * '+' = advance (avanco), '-' = retract (retorno).
 * See docs/PMR3407_RULES.md, "Sequence notation".
 */
export type Direction = '+' | '-';

/**
 * Identifier of an actuator/cylinder. Uppercase single letter A, B, C, D, ...
 * The parser normalizes lowercase input to uppercase.
 */
export type ActuatorId = string;

/**
 * A single elementary movement of one cylinder in one direction.
 * Example: { actuator: 'A', direction: '+' } is "A+".
 */
export interface Movement {
  readonly actuator: ActuatorId;
  readonly direction: Direction;
}

/**
 * A step of the sequence. A step is executed as a unit. When it contains more
 * than one movement, those movements are SIMULTANEOUS (parenthesized group in
 * the notation, e.g. "(A-B-)"). See docs/PMR3407_RULES.md, "Simultaneous
 * movements" and "Timers".
 */
export interface Step {
  /** 0-based index of the step within the sequence. */
  readonly index: number;
  /** One or more simultaneous movements executed in this step. */
  readonly movements: readonly Movement[];
  /**
   * Whether a timer/temporizador delay precedes this step (notation prefix
   * "T"). The concrete delay value belongs to the electropneumatic layer; the
   * sequence model only records that a delay exists.
   */
  readonly hasTimer: boolean;
}

/**
 * The canonical, normalized representation of a sequence produced by the
 * parser. Independent of any solver method or renderer.
 */
export interface SequenceModel {
  /** Ordered steps, index 0..n-1. */
  readonly steps: readonly Step[];
  /**
   * Actuators auto-detected from the sequence, sorted alphabetically. Every
   * actuator that appears in any movement is listed exactly once.
   */
  readonly actuators: readonly ActuatorId[];
  /**
   * The explicit initial state of every actuator (see {@link InitialState}).
   * The parser fills this with the default (all retracted) but the model
   * carries it explicitly so nothing downstream assumes it.
   */
  readonly initialState: InitialState;
  /**
   * Canonical, whitespace-free textual form used for equality comparison and
   * for regenerating source. Example: "A+B+A-B-" or "A+B-T(A-B-)B+".
   */
  readonly canonical: string;
}

/**
 * Physical state a cylinder can rest in (not a transient motion state).
 * See docs/PMR3407_RULES.md, "Initial state".
 */
export type RestState = 'retracted' | 'extended';

/**
 * Explicit initial state of the circuit: for each actuator, the resting
 * position before the sequence begins.
 *
 * The DEFAULT convention in PMR3407 worked examples is that all cylinders
 * start retracted (A0/B0/C0). This representation is explicit so the default
 * is never assumed silently; a caller may supply extended starts for actuators
 * whose sequences begin with a "-" movement.
 */
export interface InitialState {
  readonly positions: Readonly<Record<ActuatorId, RestState>>;
}
