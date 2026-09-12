/** Simulator barrel: state model + executor + explanation generator. */

export { runCycle, initialSimState } from './simulator.ts';
export type { SimEvent, SimResult } from './simulator.ts';
export { explain } from './explanation.ts';
export type { SimState } from './state.ts';
export { relayOn, sensorActive, solenoidOn } from './state.ts';
