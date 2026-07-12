import test from 'node:test';
import assert from 'node:assert/strict';
import { courseWaypoints } from '../js/homeMap.js';

test('courseWaypoints: loop closes back at its first point', () => {
  const points = courseWaypoints([25, 121.5], 'loop', () => 0.25);
  assert.equal(points.length, 5);
  assert.deepEqual(points.at(-1), points[0]);
  assert.notDeepEqual(points[1], points[0]);
});

test('courseWaypoints: line remains open with four finite points', () => {
  const points = courseWaypoints([25, 121.5], 'line', () => 0.25);
  assert.equal(points.length, 4);
  assert.notDeepEqual(points.at(-1), points[0]);
  assert.ok(points.flat().every(Number.isFinite));
});
