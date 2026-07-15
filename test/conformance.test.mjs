import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeDistances } from '../js/geo.js';
import { computeConformance, isDisqualified, CONFORMANCE_DQ_THRESHOLD }
  from '../js/conformance.js';

// ---- fixture: 3 km straight route heading north, points every 100 m ----
const M_PER_DEG_LAT = 111195;
const points = Array.from({ length: 31 },
  (_, i) => [25.0 + (i * 100) / M_PER_DEG_LAT, 121.5]);
const cum = cumulativeDistances(points);

// A longitude offset that lands a fix ~metres east of the north-south route,
// i.e. that many metres off-route.
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos(25 * Math.PI / 180);
const eastOffset = m => m / M_PER_DEG_LNG;
const at = (northM, eastM = 0) =>
  [25.0 + northM / M_PER_DEG_LAT, 121.5 + eastOffset(eastM)];

test('a trace that stays on the route is fully conforming', () => {
  const trace = [at(0), at(100), at(200), at(300)];
  const { conformance } = computeConformance(trace, points, cum);
  assert.equal(conformance, 1);
  assert.equal(isDisqualified(conformance), false);
});

test('fewer than two points counts as conforming (nothing driven yet)', () => {
  assert.equal(computeConformance([], points, cum).conformance, 1);
  assert.equal(computeConformance([at(0)], points, cum).conformance, 1);
});

test('a small corridor detour still on-route does not lower conformance', () => {
  // 30 m east is within the 60 m corridor, so every point is on-route.
  const trace = [at(0), at(100, 30), at(200), at(300, 30)];
  const { conformance } = computeConformance(trace, points, cum);
  assert.equal(conformance, 1);
});

test('straying past the corridor drops conformance below the DSQ threshold', () => {
  // 900 m of on-route driving, then one 78 m hop out to ~78 m off-route.
  const trace = [];
  for (let i = 0; i <= 9; i++) trace.push(at(i * 100));
  trace.push(at(900, 78));           // last point is off-route (>60 m)
  const { conformance, drivenM, onRouteM } = computeConformance(trace, points, cum);
  assert.ok(conformance > 0.90 && conformance < 0.93, `conformance=${conformance}`);
  assert.ok(conformance < CONFORMANCE_DQ_THRESHOLD);
  assert.ok(isDisqualified(conformance));
  assert.ok(drivenM > onRouteM);
});

test('conformance is the on-route fraction of distance driven', () => {
  const { conformance, drivenM, onRouteM } = computeConformance(
    [at(0), at(100), at(100, 200)], points, cum);   // last hop 200 m off-route
  assert.equal(conformance, onRouteM / drivenM);
});
