import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProjection, normalizeToViewBox, splitIntoSectors } from '../js/trackDiagram.js';
import { cumulativeDistances, pointAtDistance } from '../js/geo.js';

// ---- normalizeToViewBox / computeProjection ----
// 3 points straddling lat 0 so meanLat = 0 exactly (cosLat = 1), which keeps
// the expected coordinates exact integers instead of float-rounded.
const triangle = [[-5, 0], [5, 0], [0, 10]];

test('normalizeToViewBox: known 3-point input maps to expected viewBox coords', () => {
  const { viewBox, points } = normalizeToViewBox(triangle);
  assert.deepEqual(viewBox, [0, 0, 1000, 700]);
  // spanX=10, spanY=10, innerW=880, innerH=580 -> scale is height-constrained (58)
  assert.deepEqual(points, [[210, 640], [210, 60], [790, 350]]);
});

test('normalizeToViewBox: aspect ratio is preserved (uniform scale on both axes)', () => {
  const { points } = normalizeToViewBox(triangle);
  // P0->P1 spans the full 10-degree lat range; P2->P0/P1 spans the full 10-degree lng range.
  // Equal source spans must produce equal projected spans if aspect is preserved.
  const vSpan = Math.abs(points[1][1] - points[0][1]);
  const hSpan = Math.abs(points[2][0] - points[0][0]);
  assert.equal(vSpan, hSpan);
});

test('computeProjection: degenerate (single point) does not throw or divide by zero into Infinity', () => {
  const { project } = computeProjection([[25, 121.5]]);
  const [x, y] = project([25, 121.5]);
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
});

// ---- splitIntoSectors ----
// straight 1 km route, one point every 250 m (mirrors OSRM/straight-line route.points shape)
const M_PER_DEG_LAT = 111195;
const straight = Array.from({ length: 5 }, (_, i) => [(i * 250) / M_PER_DEG_LAT, 121.5]);
const cum = cumulativeDistances(straight);

test('splitIntoSectors: 0 boundaries returns a single segment with all points', () => {
  const segs = splitIntoSectors(straight, []);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], straight);
});

test('splitIntoSectors: boundaries land on interpolated split points at the right indices', () => {
  const segs = splitIntoSectors(straight, [300, 700]);
  assert.equal(segs.length, 3);

  const split300 = pointAtDistance(straight, cum, 300);
  const split700 = pointAtDistance(straight, cum, 700);

  // seg1: start .. split(300)
  assert.deepEqual(segs[0], [straight[0], straight[1], split300]);
  // seg2: split(300) .. mid point (500m) .. split(700), shared endpoints with neighbors
  assert.deepEqual(segs[1], [split300, straight[2], split700]);
  // seg3: split(700) .. end
  assert.deepEqual(segs[2], [split700, straight[3], straight[4]]);
});

test('splitIntoSectors: boundaries outside (0, total) are ignored', () => {
  const segs = splitIntoSectors(straight, [0, 1000, -50, 5000]);
  assert.equal(segs.length, 1);
});

test('splitIntoSectors: fewer than 2 points is a no-op (single segment or none)', () => {
  assert.deepEqual(splitIntoSectors([straight[0]], [100]), [[straight[0]]]);
  assert.deepEqual(splitIntoSectors([], [100]), []);
});
