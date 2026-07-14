import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDragGuide,
  findInsertIndex,
  moveEndpoint,
  normalizeWaypointKinds,
  replaceShapePointInLeg,
} from '../js/routeDrag.js';
import { pointAtDistance, cumulativeDistances, projectOnRoute } from '../js/geo.js';

// ---- fixture: 2 km straight route heading north, one point every 100 m
// (mirrors the shape of an OSRM/straight-line route.points array) ----
const M_PER_DEG_LAT = 111195;
const routePoints = Array.from({ length: 21 },
  (_, i) => [25.0 + (i * 100) / M_PER_DEG_LAT, 121.5]);
const cum = cumulativeDistances(routePoints);

test('findInsertIndex: midpoint of a 2-waypoint route inserts between them', () => {
  const waypoints = [routePoints[0], routePoints[20]];
  const grab = pointAtDistance(routePoints, cum, 1000); // dead center
  assert.equal(findInsertIndex(waypoints, routePoints, grab), 1);
});

test('findInsertIndex: grab past the last via waypoint inserts before the end', () => {
  const waypoints = [routePoints[0], routePoints[10], routePoints[20]]; // via at 1000 m
  const grab = pointAtDistance(routePoints, cum, 1500); // between via (1000 m) and end (2000 m)
  assert.equal(findInsertIndex(waypoints, routePoints, grab), 2);
});

test('findInsertIndex: grab near the start inserts before the first via waypoint', () => {
  const waypoints = [routePoints[0], routePoints[10], routePoints[20]];
  const grab = pointAtDistance(routePoints, cum, 300); // before the via at 1000 m
  assert.equal(findInsertIndex(waypoints, routePoints, grab), 1);
});

test('findInsertIndex: off-route grab still projects to the nearest segment', () => {
  const waypoints = [routePoints[0], routePoints[20]];
  const p = pointAtDistance(routePoints, cum, 1000);
  const grab = [p[0], p[1] + 0.0005]; // ~50 m east of the route
  assert.equal(findInsertIndex(waypoints, routePoints, grab), 1);
});

test('findInsertIndex: fewer than 2 waypoints just appends', () => {
  assert.equal(findInsertIndex([routePoints[0]], routePoints, routePoints[5]), 1);
});

test('buildDragGuide bends several nearby segments instead of making one sharp spike', () => {
  const grab = pointAtDistance(routePoints, cum, 1050);
  const projection = projectOnRoute(grab, routePoints, cum);
  const target = [grab[0], grab[1] + 0.002];
  const guide = buildDragGuide(routePoints, projection, target);
  assert.deepEqual(guide[0], routePoints[0]);
  assert.deepEqual(guide.at(-1), routePoints.at(-1));
  assert.deepEqual(guide[projection.segIndex + 1], target);
  assert.ok(guide[projection.segIndex][1] > routePoints[projection.segIndex][1]);
  assert.ok(guide[projection.segIndex + 2][1] > routePoints[projection.segIndex + 1][1]);
});

test('normalizeWaypointKinds keeps dragged shaping points hidden', () => {
  assert.deepEqual(
    normalizeWaypointKinds(
      [routePoints[0], routePoints[5], routePoints[10], routePoints[20]],
      ['endpoint', 'shape', 'via', 'endpoint'],
    ),
    ['endpoint', 'shape', 'via', 'endpoint'],
  );
});

test('replaceShapePointInLeg removes stale hidden points only from the dragged leg', () => {
  const result = replaceShapePointInLeg(
    [routePoints[0], routePoints[3], routePoints[6], routePoints[10],
      routePoints[15], routePoints[20]],
    ['endpoint', 'shape', 'shape', 'via', 'shape', 'endpoint'],
    routePoints,
    routePoints[7],
  );
  assert.deepEqual(result.waypoints,
    [routePoints[0], routePoints[7], routePoints[10], routePoints[15], routePoints[20]]);
  assert.deepEqual(result.kinds, ['endpoint', 'shape', 'via', 'shape', 'endpoint']);
  assert.equal(result.index, 1);
});

test('moveEndpoint shortens the route and drops shaping points past the new end', () => {
  const result = moveEndpoint(
    [routePoints[0], routePoints[10], routePoints[20]],
    routePoints,
    ['endpoint', 'shape', 'endpoint'],
    'end',
    routePoints[5],
  );
  assert.deepEqual(result.waypoints, [routePoints[0], routePoints[5]]);
  assert.deepEqual(result.kinds, ['endpoint', 'endpoint']);
  assert.equal(result.trimmed, true);
});

test('moveEndpoint keeps shaping points when the end is extended off-route', () => {
  const extension = [25.03, 121.5];
  const result = moveEndpoint(
    [routePoints[0], routePoints[10], routePoints[20]],
    routePoints,
    ['endpoint', 'shape', 'endpoint'],
    'end',
    extension,
  );
  assert.deepEqual(result.waypoints, [routePoints[0], routePoints[10], extension]);
  assert.deepEqual(result.kinds, ['endpoint', 'shape', 'endpoint']);
  assert.equal(result.trimmed, false);
});

test('moveEndpoint can pull the start forward and remove earlier vias', () => {
  const result = moveEndpoint(
    [routePoints[0], routePoints[10], routePoints[20]],
    routePoints,
    ['endpoint', 'via', 'endpoint'],
    'start',
    routePoints[15],
  );
  assert.deepEqual(result.waypoints, [routePoints[15], routePoints[20]]);
  assert.deepEqual(result.kinds, ['endpoint', 'endpoint']);
  assert.equal(result.trimmed, true);
});

test('moveEndpoint keeps two matching endpoints when closing the route', () => {
  const result = moveEndpoint(
    [routePoints[0], routePoints[10], routePoints[20]],
    routePoints,
    ['endpoint', 'shape', 'endpoint'],
    'end',
    routePoints[0],
  );
  assert.deepEqual(result.waypoints, [routePoints[0], routePoints[0]]);
  assert.deepEqual(result.kinds, ['endpoint', 'endpoint']);
});
