import test from 'node:test';
import assert from 'node:assert/strict';
import { courseWaypoints, createLocationPicker, HOME_LOCATIONS } from '../js/homeMap.js';

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

test('home map includes a broad mix of locations', () => {
  assert.ok(HOME_LOCATIONS.length >= 50);
  assert.ok(HOME_LOCATIONS.some(location => location.name === 'Kaohsiung'));
  assert.ok(HOME_LOCATIONS.some(location => location.name === 'Manchester'));
  assert.ok(HOME_LOCATIONS.some(location => location.name === 'Medellín'));
});

test('location picker shows every location once before repeating', () => {
  const locations = HOME_LOCATIONS.slice(0, 5);
  const nextLocation = createLocationPicker(locations, () => 0.4);
  const firstCycle = Array.from({ length: locations.length }, () => nextLocation().name);
  assert.equal(new Set(firstCycle).size, locations.length);
  assert.notEqual(nextLocation().name, firstCycle.at(-1));
});
