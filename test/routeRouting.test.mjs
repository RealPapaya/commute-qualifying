import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waypointBearings } from '../js/routeRouting.js';

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
