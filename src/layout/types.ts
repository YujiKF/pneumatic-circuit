/**
 * Layout types.
 *
 * The layout engine assigns GEOMETRY (positions, orientation, line routing) to
 * a logical {@link Circuit}. It never writes geometry back into the logical
 * circuit: the {@link LayoutResult} is a SEPARATE, immutable structure keyed by
 * component id. This keeps "logic" and "visual position" strictly separated as
 * required (LAYOUT AUTOMATICO): the circuit graph carries no x/y, and the
 * layout can be recomputed deterministically from the graph alone.
 *
 * No enums (Node strip-only): closed sets are string-literal unions.
 */

/** Orientation a symbol is drawn in. */
export type Orientation = 'horizontal' | 'vertical';

/** A 2D point in the diagram coordinate space (SVG user units). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned bounding box of a placed component (top-left origin). */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Geometry assigned to a single component. */
export interface PlacedComponent {
  /** Logical component id (e.g. "1.1", "K1", "C3"). */
  readonly id: string;
  /** Logical component kind (mirrored for the renderer's convenience). */
  readonly kind: string;
  /** Top-left position of the component's bounding box. */
  readonly x: number;
  readonly y: number;
  /** Bounding box size (symbol footprint). */
  readonly width: number;
  readonly height: number;
  /** Drawing orientation. */
  readonly orientation: Orientation;
  /**
   * Row/column indices in the abstract grid the engine assigned. Exposed so
   * tests and renderers can reason about structure without pixel math.
   */
  readonly row: number;
  readonly col: number;
}

/** A routed connection: an ordered polyline between two component ports. */
export interface RoutedConnection {
  readonly sourceComponent: string;
  readonly sourcePort: string;
  readonly targetComponent: string;
  readonly targetPort: string;
  readonly signalType: 'pneumatic' | 'electric';
  /** Ordered waypoints (>= 2 points) describing the wire/pipe path. */
  readonly points: readonly Point[];
}

/** A pressure line bus (in cascade pneumatic circuits). */
export interface PlacedBus {
  readonly id: string;
  readonly label: string;
  readonly groupNumber: number;
  readonly y: number;
  readonly x1: number;
  readonly x2: number;
}

/** The complete geometric layout of a circuit. */
export interface LayoutResult {
  /** Overall diagram size (used for the SVG viewBox). */
  readonly width: number;
  readonly height: number;
  /** Placed components in a stable order (by id). */
  readonly components: readonly PlacedComponent[];
  /** Fast lookup of a placed component by id. */
  readonly byId: ReadonlyMap<string, PlacedComponent>;
  /** Routed connections in the input order. */
  readonly connections: readonly RoutedConnection[];
  /** Group pressure lines when method is cascade. */
  readonly buses?: readonly PlacedBus[];
}
