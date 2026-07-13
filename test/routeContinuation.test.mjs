import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeDistances } from '../js/geo.js';
import { createRun, feedFix } from '../js/timing.js';
import { createContinuationRoute } from '../js/routeContinuation.js';

const points = [[25, 121.5], [25.005, 121.5], [25.01, 121.5], [25.015, 121.5]];
const cum = cumulativeDistances(points);

test('continuation route keeps the traveled prefix and future sector count', () => {
  const original = {
    id: 'old', name: 'Commute', points, cum, sectorBoundaries: [500, 1100],
    lights: [], timingVersion: 3,
  };
  const run = createRun(original);
  feedFix(run, { lat: points[0][0], lng: points[0][1], t: 0 });
  feedFix(run, { lat: points[1][0], lng: points[1][1], t: 30000 });
  const current = [25.006, 121.502];
  const road = [current, [25.012, 121.503], points.at(-1)];
  const result = createContinuationRoute(original, run, current, road, 'new');

  assert.equal(result.route.id, 'new');
  assert.equal(result.route.name, 'Commute — alternate');
  assert.deepEqual(result.route.points.at(-1), points.at(-1));
  assert.equal(result.route.sectorBoundaries.length, original.sectorBoundaries.length);
  assert.ok(result.resumeProgress > run.maxProgress);
  assert.equal(result.route.timingVersion, 1);
});
