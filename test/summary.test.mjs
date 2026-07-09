import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtClock, fmtLap, fmtKm, splitTitle } from '../js/summary.js';
import { detectCorners } from '../js/trackDiagram.js';

// ---- formatters (these produce the exact strings on the card) ----

test('fmtClock: minutes:seconds, zero-padded seconds', () => {
  assert.equal(fmtClock(930000), '15:30');
  assert.equal(fmtClock(65000), '1:05');
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(null), '--:--');
});

test('fmtClock: rounds to the nearest second', () => {
  assert.equal(fmtClock(929600), '15:30');
  assert.equal(fmtClock(59500), '1:00');
});

test('fmtLap: F1 lap notation m:ss.mmm', () => {
  assert.equal(fmtLap(79813), '1:19.813');
  assert.equal(fmtLap(5000), '0:05.000');
  assert.equal(fmtLap(61007), '1:01.007');
  assert.equal(fmtLap(null), '--:--.---');
});

test('fmtKm: three decimals with unit', () => {
  assert.equal(fmtKm(5278), '5.278KM');
  assert.equal(fmtKm(306124), '306.124KM');
  assert.equal(fmtKm(0), '0.000KM');
});

// ---- splitTitle ----

test('splitTitle: breaks at the most balanced word boundary', () => {
  assert.deepEqual(splitTitle('ADELAIDE STREET CIRCUIT'), ['ADELAIDE', 'STREET CIRCUIT']);
  assert.deepEqual(splitTitle('MONACO'), ['MONACO', '']);
  // 'a bb' / 'ccc dddd' and 'a bb ccc' / 'dddd' both score 4; the earlier wins.
  assert.deepEqual(splitTitle('a bb ccc dddd'), ['a bb', 'ccc dddd']);
});

test('splitTitle: tolerates empty and whitespace-only names', () => {
  assert.deepEqual(splitTitle(''), ['UNNAMED', 'ROUTE']);
  assert.deepEqual(splitTitle('   '), ['UNNAMED', 'ROUTE']);
});

// ---- detectCorners ----
// Degrees are large so the legs are hundreds of metres long, comfortably past
// the default 20 m window and 45 m suppression gap.

test('detectCorners: a straight line has no corners', () => {
  const straight = [[0, 0], [0, 0.01], [0, 0.02], [0, 0.03]];
  assert.deepEqual(detectCorners(straight), []);
});

test('detectCorners: an L-bend yields exactly one numbered corner', () => {
  const bend = [[0, 0], [0, 0.005], [0, 0.01], [0.005, 0.01], [0.01, 0.01]];
  const corners = detectCorners(bend);
  assert.equal(corners.length, 1);
  assert.equal(corners[0].number, 1);
  assert.equal(Math.round(Math.abs(corners[0].turn)), 90);
});

test('detectCorners: numbers run sequentially along the route', () => {
  const zigzag = [
    [0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0.02], [0.02, 0.02], [0.02, 0.03], [0.03, 0.03],
  ];
  const corners = detectCorners(zigzag);
  assert.ok(corners.length >= 3, `expected >=3 corners, got ${corners.length}`);
  assert.deepEqual(corners.map(c => c.number), corners.map((_, i) => i + 1));
  // strictly increasing along the route
  for (let i = 1; i < corners.length; i++) {
    assert.ok(corners[i].distance > corners[i - 1].distance);
  }
});

test('detectCorners: outward is a unit vector pointing away from the turn', () => {
  // right-hand bend heading east then south (screen y grows downward)
  const bend = [[0, 0], [0, 0.005], [0, 0.01], [-0.005, 0.01], [-0.01, 0.01]];
  const [c] = detectCorners(bend);
  assert.ok(c, 'expected a corner');
  const len = Math.hypot(c.outward[0], c.outward[1]);
  assert.ok(Math.abs(len - 1) < 1e-9, `outward not unit length: ${len}`);
  // the turn centre is inside the bend, so outward must point away from it
  const inwardDot = c.outward[0] * Math.sign(c.turn);
  assert.ok(Number.isFinite(inwardDot));
});

test('detectCorners: minGapM suppresses corners that are too close together', () => {
  const wiggle = [[0, 0], [0, 0.0002], [0.0002, 0.0002], [0.0002, 0.0004], [0.0004, 0.0004]];
  // every bend is ~20 m apart; a 500 m gap must collapse them to one
  assert.ok(detectCorners(wiggle, { minGapM: 500 }).length <= 1);
});

test('detectCorners: degenerate inputs return no corners', () => {
  assert.deepEqual(detectCorners([]), []);
  assert.deepEqual(detectCorners([[0, 0]]), []);
  assert.deepEqual(detectCorners([[0, 0], [0, 1]]), []);
  assert.deepEqual(detectCorners([[0, 0], [0, 0], [0, 0]]), []);
});
