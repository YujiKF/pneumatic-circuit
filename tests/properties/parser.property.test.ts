/**
 * Property-based parser invariants using the hand-rolled arbitrary/forAll
 * helper (fast-check is not installable).
 *
 * Invariants:
 *  1. Dialect independence: the four accepted surface dialects of the SAME
 *     structural sequence parse to the SAME canonical model.
 *  2. Round-trip: re-parsing a model's canonical string yields the same
 *     canonical string (idempotence).
 *  3. Actuator coverage: detected actuators equal the ground-truth set.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { forAll } from './_arbitrary.ts';
import {
  actuatorsOf,
  canonicalStringOf,
  renderDialect,
  sequenceArbitrary,
} from './sequence-arbitrary.ts';

test('property: all dialects of the same sequence share one canonical model', () => {
  forAll(
    sequenceArbitrary,
    (seq) => {
      const canonicals: string[] = [];
      for (let dialect = 0; dialect < 4; dialect++) {
        const raw = renderDialect(seq, dialect);
        const result = parseSequence(raw);
        assert.ok(result.ok, `dialect ${dialect} failed to parse "${raw}"`);
        canonicals.push(result.value.canonical);
      }
      for (const c of canonicals) {
        assert.equal(c, canonicals[0]);
      }
      assert.equal(canonicals[0], canonicalStringOf(seq));
    },
    { runs: 200, seed: 0xc0ffee },
  );
});

test('property: canonical string round-trips (idempotent re-parse)', () => {
  forAll(
    sequenceArbitrary,
    (seq) => {
      const first = parseSequence(canonicalStringOf(seq));
      assert.ok(first.ok);
      const second = parseSequence(first.value.canonical);
      assert.ok(second.ok);
      assert.equal(second.value.canonical, first.value.canonical);
    },
    { runs: 200, seed: 0xbeef },
  );
});

test('property: detected actuators equal the ground-truth actuator set', () => {
  forAll(
    sequenceArbitrary,
    (seq) => {
      const result = parseSequence(canonicalStringOf(seq));
      assert.ok(result.ok);
      assert.deepEqual([...result.value.actuators], actuatorsOf(seq));
    },
    { runs: 200, seed: 0x1357 },
  );
});
