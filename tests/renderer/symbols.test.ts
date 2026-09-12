/**
 * SVG symbol library tests.
 *
 * Assert STRUCTURAL facts about the SVG STRING each of the 11 named symbol
 * classes produces (no DOM, no pixel comparison): the correct group class,
 * the presence of PMR3407 port labels, and that a label is emitted. These
 * guarantee the library renders headless and follows the port conventions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CylinderSymbol,
  Valve52Symbol,
  Valve32NOSymbol,
  Valve32NCSymbol,
  MechanicalSensorSymbol,
  PneumaticANDSymbol,
  PneumaticORSymbol,
  SolenoidSymbol,
  RelayCoilSymbol,
  NOContactSymbol,
  NCContactSymbol,
} from '../../src/renderer/index.ts';

const at = { x: 10, y: 10, label: 'X1' };

test('all 11 symbols render a non-empty <g> with their class name', () => {
  const cases: Array<[string, string]> = [
    ['CylinderSymbol', new CylinderSymbol(at).render()],
    ['Valve52Symbol', new Valve52Symbol(at).render()],
    ['Valve32NOSymbol', new Valve32NOSymbol(at).render()],
    ['Valve32NCSymbol', new Valve32NCSymbol(at).render()],
    ['MechanicalSensorSymbol', new MechanicalSensorSymbol(at).render()],
    ['PneumaticANDSymbol', new PneumaticANDSymbol(at).render()],
    ['PneumaticORSymbol', new PneumaticORSymbol(at).render()],
    ['SolenoidSymbol', new SolenoidSymbol(at).render()],
    ['RelayCoilSymbol', new RelayCoilSymbol(at).render()],
    ['NOContactSymbol', new NOContactSymbol(at).render()],
    ['NCContactSymbol', new NCContactSymbol(at).render()],
  ];
  for (const [name, svg] of cases) {
    assert.ok(svg.startsWith('<g'), `${name} renders a <g>`);
    assert.ok(svg.includes(`class="${name}`), `${name} carries its class`);
    assert.ok(svg.includes('X1'), `${name} emits its label`);
  }
});

test('Valve52Symbol exposes all 5/2 ports and both pilots (1,2,3,4,5,12,14)', () => {
  const svg = new Valve52Symbol(at).render();
  for (const p of ['1', '2', '3', '4', '5', '12', '14']) {
    assert.ok(svg.includes(`port-${p}`), `5/2 valve has port ${p}`);
  }
});

test('NO contact is marked NO and NC contact is marked NC', () => {
  assert.ok(new NOContactSymbol(at).render().includes('data-contact="NO"'));
  assert.ok(new NCContactSymbol(at).render().includes('data-contact="NC"'));
});

test('cylinder exposes + and - service ports', () => {
  const svg = new CylinderSymbol(at).render();
  assert.ok(svg.includes('port--'), 'cylinder has - port');
  assert.ok(svg.includes('port-+'), 'cylinder has + port');
});

test('SVG output is XML-attribute-safe (escapes special chars in labels)', () => {
  const svg = new RelayCoilSymbol({ x: 0, y: 0, label: 'K1 & <cap>' }).render();
  assert.ok(svg.includes('K1 &amp; &lt;cap&gt;'), 'label is escaped');
  assert.ok(!svg.includes('<cap>'), 'no raw angle brackets from label');
});
