import test from 'node:test';
import assert from 'node:assert/strict';
import { courseQuality, courseWaypoints, createLocationPicker, HOME_LOCATIONS } from '../js/homeMap.js';

test('courseWaypoints: random courses remain open with four forward points', () => {
  const points = courseWaypoints([25, 121.5], () => 0.25);
  assert.equal(points.length, 4);
  assert.notDeepEqual(points.at(-1), points[0]);
  assert.ok(points.flat().every(Number.isFinite));
  assert.ok(courseQuality(points).backtrackRatio <= 0.18);
});

test('courseQuality: exposes detours and backwards route sections', () => {
  const direct = [[25, 121.5], [25, 121.51], [25, 121.52]];
  const loopy = [[25, 121.5], [25, 121.52], [25.01, 121.51], [25, 121.505], [25, 121.52]];

  assert.ok(courseQuality(direct).detourRatio < 1.01);
  assert.equal(courseQuality(direct).backtrackRatio, 0);
  assert.ok(courseQuality(loopy).detourRatio > 2.15);
  assert.ok(courseQuality(loopy).backtrackRatio > 0.18);
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
