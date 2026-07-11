import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptedRecordingPoint } from '../js/gpsRouteRecorder.js';

const start = [25.0478, 121.5170];

test('acceptedRecordingPoint: accepts the first accurate GPS fix', () => {
  assert.deepEqual(acceptedRecordingPoint(null, {
    latitude: start[0], longitude: start[1], accuracy: 8,
  }), start);
});

test('acceptedRecordingPoint: rejects inaccurate, invalid, and nearby fixes', () => {
  assert.equal(acceptedRecordingPoint(start, {
    latitude: 25.0480, longitude: 121.5170, accuracy: 41,
  }), null);
  assert.equal(acceptedRecordingPoint(start, {
    latitude: 'bad', longitude: 121.5170, accuracy: 8,
  }), null);
  assert.equal(acceptedRecordingPoint(start, {
    latitude: start[0] + 0.00001, longitude: start[1], accuracy: 8,
  }), null);
});

test('acceptedRecordingPoint: accepts a point farther than the recording threshold', () => {
  const next = [25.0479, 121.5170];
  assert.deepEqual(acceptedRecordingPoint(start, {
    latitude: next[0], longitude: next[1], accuracy: 8,
  }), next);
});
