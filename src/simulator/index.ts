/** Simulator barrel: state model + executor + explanation generator. */

export { runCycle, initialSimState, settleLadder } from './simulator.ts';
export type { SimEvent, SimResult } from './simulator.ts';
export { runCascadeCycle, initialCascadeSimState } from './cascade.ts';
export type { CascadeSimResult, CascadeSimState, CascadeSimOptions } from './cascade.ts';
export { explain } from './explanation.ts';
export type { SimState } from './state.ts';
export { relayOn, sensorActive, solenoidOn } from './state.ts';
