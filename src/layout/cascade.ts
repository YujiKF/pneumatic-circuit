import type { Circuit } from '../domain/index.ts';
import { LAYOUT_METRICS, naturalCompare } from './engine.ts';
import type { LayoutResult, PlacedBus, PlacedComponent, Point, RoutedConnection } from './types.ts';

/**
 * Deterministic layout for cascade pneumatic circuits (PMR3407).
 *
 * Places:
 *  - Row 0: Cylinders (1.0, 2.0, ...)
 *  - Row 1: Main command valves (1.1, 2.1, ...)
 *  - Row 2: Limit sensors (1S1, 1S2, 2S1, ...)
 *  - Middle: Group pressure lines L1..Ln as horizontal buses
 *  - Bottom row: Start valve (E) and memory valves (0.1, 0.2, ...)
 */
export function layoutCascadeCircuit(circuit: Circuit): LayoutResult {
  const { margin, cellWidth, cellHeight } = LAYOUT_METRICS;
  const colPitch = 160;
  const bandPitch = 140;

  const cylinders = circuit.components
    .filter((c) => c.kind === 'cylinder')
    .sort((a, b) => naturalCompare(a.id, b.id));

  const mainValves = circuit.components
    .filter((c) => c.kind === 'directional-valve' && c.actuator !== undefined)
    .sort((a, b) => naturalCompare(a.id, b.id));

  const sensors = circuit.components
    .filter((c) => c.kind === 'sensor')
    .sort((a, b) => naturalCompare(a.id, b.id));

  const memoryValves = circuit.components
    .filter((c) => c.kind === 'directional-valve' && /^0\.\d+$/.test(c.id))
    .sort((a, b) => naturalCompare(a.id, b.id));

  const startValves = circuit.components
    .filter((c) => c.kind === 'directional-valve' && !c.actuator && !/^0\.\d+$/.test(c.id))
    .sort((a, b) => naturalCompare(a.id, b.id));

  const bottomComponents = [...startValves, ...memoryValves];

  const maxCols = Math.max(
    cylinders.length,
    mainValves.length,
    bottomComponents.length,
    Math.ceil(sensors.length / 2),
    2,
  );

  const placed: PlacedComponent[] = [];
  const byId = new Map<string, PlacedComponent>();

  // Row 0: Cylinders
  cylinders.forEach((c, idx) => {
    const p: PlacedComponent = {
      id: c.id,
      kind: c.kind,
      x: margin + idx * colPitch,
      y: margin,
      width: cellWidth,
      height: cellHeight,
      orientation: 'horizontal',
      row: 0,
      col: idx,
    };
    placed.push(p);
    byId.set(c.id, p);
  });

  // Row 1: Main Valves
  mainValves.forEach((c, idx) => {
    const p: PlacedComponent = {
      id: c.id,
      kind: c.kind,
      x: margin + idx * colPitch,
      y: margin + bandPitch,
      width: cellWidth,
      height: cellHeight,
      orientation: 'horizontal',
      row: 1,
      col: idx,
    };
    placed.push(p);
    byId.set(c.id, p);
  });

  // Row 2: Sensors
  const sensorPitch = Math.max(80, (maxCols * colPitch) / Math.max(1, sensors.length));
  sensors.forEach((c, idx) => {
    const p: PlacedComponent = {
      id: c.id,
      kind: c.kind,
      x: margin + idx * sensorPitch,
      y: margin + 2 * bandPitch,
      width: 60,
      height: 50,
      orientation: 'vertical',
      row: 2,
      col: idx,
    };
    placed.push(p);
    byId.set(c.id, p);
  });

  // Pressure Lines (Buses)
  const ng = circuit.groups && circuit.groups.length > 0 ? circuit.groups.length : 2;
  const busStartY = margin + 2 * bandPitch + 70;
  const busSpacing = 28;
  const busX1 = margin;
  const busX2 = margin + maxCols * colPitch;
  const buses: PlacedBus[] = [];

  for (let k = 0; k < ng; k++) {
    const groupNum = k + 1;
    const busY = busStartY + k * busSpacing;
    buses.push({
      id: `L${groupNum}`,
      label: `L${groupNum}`,
      groupNumber: groupNum,
      y: busY,
      x1: busX1,
      x2: busX2,
    });
  }

  // Row 3 (below buses): Start valve and Memory valves
  const bottomY = busStartY + ng * busSpacing + 40;
  bottomComponents.forEach((c, idx) => {
    const p: PlacedComponent = {
      id: c.id,
      kind: c.kind,
      x: margin + idx * colPitch,
      y: bottomY,
      width: cellWidth,
      height: cellHeight,
      orientation: 'horizontal',
      row: 3,
      col: idx,
    };
    placed.push(p);
    byId.set(c.id, p);
  });

  const width = margin * 2 + maxCols * colPitch;
  const height = bottomY + cellHeight + margin;

  // Fallback placement for any unhandled component
  for (const c of circuit.components) {
    if (!byId.has(c.id)) {
      const p: PlacedComponent = {
        id: c.id,
        kind: c.kind,
        x: margin,
        y: height - margin - cellHeight,
        width: cellWidth,
        height: cellHeight,
        orientation: 'horizontal',
        row: 4,
        col: 0,
      };
      placed.push(p);
      byId.set(c.id, p);
    }
  }

  // Route connections
  const connections: RoutedConnection[] = circuit.connections.map((conn) => {
    const fromComp = byId.get(conn.sourceComponent);
    const toComp = byId.get(conn.targetComponent);
    const fromPoint: Point = fromComp
      ? { x: fromComp.x + fromComp.width / 2, y: fromComp.y + fromComp.height }
      : { x: margin, y: margin };
    const toPoint: Point = toComp
      ? { x: toComp.x + toComp.width / 2, y: toComp.y }
      : { x: margin, y: margin };

    return {
      sourceComponent: conn.sourceComponent,
      sourcePort: conn.sourcePort,
      targetComponent: conn.targetComponent,
      targetPort: conn.targetPort,
      signalType: conn.signalType,
      points: [
        fromPoint,
        { x: fromPoint.x, y: (fromPoint.y + toPoint.y) / 2 },
        { x: toPoint.x, y: (fromPoint.y + toPoint.y) / 2 },
        toPoint,
      ],
    };
  });

  return {
    width,
    height,
    components: placed,
    byId,
    connections,
    buses,
  };
}
