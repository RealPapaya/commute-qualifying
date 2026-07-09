import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBBox, filterNearRoute, dedupeLights, routeSignature }
  from '../js/lightsImport.js';
import { pointAtDistance, cumulativeDistances } from '../js/geo.js';

// ---- fixture: 2 km straight route heading north, one point every 100 m
// (mirrors the shape of an OSRM/straight-line route.points array) ----
const M_PER_DEG_LAT = 111195;
const routePoints = Array.from({ length: 21 },
  (_, i) => [25.0 + (i * 100) / M_PER_DEG_LAT, 121.5]);
const cum = cumulativeDistances(routePoints);

// node/lat/lng offset helper: east offset in meters at a given latitude
function eastOf([lat, lng], offM) {
  return [lat, lng + offM / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180))];
}

// ---- computeBBox ----

test('computeBBox: covers all points plus padding', () => {
  const bbox = computeBBox(routePoints, 100);
  assert.ok(bbox.south < routePoints[0][0]);
  assert.ok(bbox.north > routePoints[20][0]);
  assert.ok(bbox.west < routePoints[0][1]);
  assert.ok(bbox.east > routePoints[0][1]);
});

test('computeBBox: padding is roughly padM meters in each direction', () => {
  const bbox = computeBBox(routePoints, 100);
  const southPadDeg = routePoints[0][0] - bbox.south;
  assert.ok(Math.abs(southPadDeg * M_PER_DEG_LAT - 100) < 5);
});

// ---- filterNearRoute ----

test('filterNearRoute: keeps nodes within maxDistM of the polyline', () => {
  const onRoute = pointAtDistance(routePoints, cum, 1000);
  const near = eastOf(onRoute, 20); // 20 m off route
  const far = eastOf(onRoute, 60);  // 60 m off route
  const nodes = [
    { lat: near[0], lon: near[1] },
    { lat: far[0], lon: far[1] },
  ];
  const kept = filterNearRoute(nodes, routePoints, 25);
  assert.equal(kept.length, 1);
  assert.ok(Math.abs(kept[0][0] - near[0]) < 1e-9);
});

test('filterNearRoute: empty route returns nothing', () => {
  assert.deepEqual(filterNearRoute([{ lat: 25, lon: 121.5 }], [routePoints[0]]), []);
});

// ---- dedupeLights ----

test('dedupeLights: drops a candidate close to an existing light', () => {
  const existing = [pointAtDistance(routePoints, cum, 500)];
  const dup = eastOf(existing[0], 5); // 5 m away — inside 15 m threshold
  const distinct = pointAtDistance(routePoints, cum, 900);
  const kept = dedupeLights([dup, distinct], existing, 15);
  assert.equal(kept.length, 1);
  assert.ok(Math.abs(kept[0][0] - distinct[0]) < 1e-9);
});

test('dedupeLights: also dedupes candidates against each other', () => {
  const base = pointAtDistance(routePoints, cum, 500);
  const near = eastOf(base, 5);
  const kept = dedupeLights([base, near], [], 15);
  assert.equal(kept.length, 1);
});

test('dedupeLights: keeps candidates far from everything', () => {
  const a = pointAtDistance(routePoints, cum, 200);
  const b = pointAtDistance(routePoints, cum, 1800);
  const kept = dedupeLights([a, b], [], 15);
  assert.equal(kept.length, 2);
});

// ---- routeSignature ----

test('routeSignature: stable for identical geometry, differs when it changes', () => {
  const sig1 = routeSignature(routePoints);
  const sig2 = routeSignature([...routePoints]);
  assert.equal(sig1, sig2);
  const moved = routePoints.slice();
  moved[20] = eastOf(moved[20], 50);
  assert.notEqual(sig1, routeSignature(moved));
});

test('routeSignature: null for fewer than 2 points', () => {
  assert.equal(routeSignature([routePoints[0]]), null);
  assert.equal(routeSignature([]), null);
});
