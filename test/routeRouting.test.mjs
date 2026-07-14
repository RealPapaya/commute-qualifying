import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortestRoute, waypointBearings } from '../js/routeRouting.js';

test('waypointBearings follows the intended direction at every waypoint', () => {
  assert.equal(
    waypointBearings([[25, 121], [25, 121.01], [25.01, 121.01]]),
    '90,90;42,90;0,90',
  );
});

test('waypointBearings leaves a duplicated waypoint unconstrained', () => {
  assert.equal(waypointBearings([[25, 121], [25, 121], [25.01, 121]]), ';0,90;0,90');
});

test('waypointBearings needs at least two points', () => {
  assert.equal(waypointBearings([[25, 121]]), '');
});

test('waypointBearings leaves invisible shaping points unconstrained', () => {
  assert.equal(
    waypointBearings(
      [[25, 121], [25, 121.01], [25.01, 121.01]],
      90,
      ['endpoint', 'shape', 'endpoint'],
    ),
    '90,90;;0,90',
  );
});

test('shortestRoute selects distance instead of OSRM recommendation order', () => {
  const fastest = { distance: 4200, geometry: { coordinates: [[0, 0], [1, 1]] } };
  const shortest = { distance: 3100, geometry: { coordinates: [[0, 0], [2, 2]] } };
  const invalid = { duration: 1 };
  assert.equal(shortestRoute([fastest, invalid, shortest]), shortest);
});
