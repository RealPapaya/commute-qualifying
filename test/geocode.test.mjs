import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlace, parsePlaces, searchPlace, searchPlaces } from '../js/geocode.js';

test('parsePlace: returns the first result with valid coordinates', () => {
  const place = parsePlace([
    { lat: 'bad', lon: '121.5' },
    { lat: '25.0478', lon: '121.5170', display_name: 'Taipei Main Station' },
  ]);
  assert.deepEqual(place, {
    point: [25.0478, 121.517],
    name: 'Taipei Main Station',
  });
});

test('parsePlace: rejects no-match and out-of-range responses', () => {
  assert.throws(() => parsePlace([]));
  assert.throws(() => parsePlace([{ lat: '91', lon: '121.5' }]));
});

test('searchPlace: sends the entered query and parses the response', async () => {
  let requestedUrl;
  const result = await searchPlace('Taipei Main Station', async url => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => [{ lat: '25.0478', lon: '121.5170', display_name: 'Taipei Main Station' }],
    };
  });
  assert.equal(requestedUrl.searchParams.get('q'), 'Taipei Main Station');
  assert.equal(requestedUrl.searchParams.get('countrycodes'), 'tw');
  assert.deepEqual(result.point, [25.0478, 121.517]);
});

test('searchPlaces: returns valid suggestions and requests five matches', async () => {
  let requestedUrl;
  const results = await searchPlaces('taipei', async url => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => [
        { lat: '25.0478', lon: '121.5170', display_name: 'Taipei Main Station' },
        { lat: '25.0330', lon: '121.5654', display_name: 'Taipei City Hall' },
        { lat: 'invalid', lon: '121.5', display_name: 'Invalid result' },
      ],
    };
  });
  assert.equal(requestedUrl.searchParams.get('limit'), '5');
  assert.equal(requestedUrl.searchParams.get('countrycodes'), 'tw');
  assert.deepEqual(results, [
    { point: [25.0478, 121.517], name: 'Taipei Main Station' },
    { point: [25.033, 121.5654], name: 'Taipei City Hall' },
  ]);
  assert.deepEqual(parsePlaces([{ lat: '91', lon: '121.5' }]), []);
});

test('parsePlaces: prioritizes exact local matches and removes duplicate pins', () => {
  const places = parsePlaces([
    { lat: '25.04', lon: '121.50', display_name: 'Taipei City, Taiwan', importance: 0.9 },
    { lat: '25.03', lon: '121.56', name: 'Taipei 101', display_name: 'Taipei 101, Xinyi', importance: 0.4 },
    { lat: '25.03', lon: '121.56', name: 'Taipei 101 duplicate', display_name: 'Duplicate', importance: 0.8 },
  ], 'Taipei 101');

  assert.deepEqual(places, [
    { point: [25.03, 121.56], name: 'Taipei 101', detail: 'Xinyi' },
    { point: [25.04, 121.5], name: 'Taipei City', detail: 'Taiwan' },
  ]);
});

test('parsePlaces: keeps the address detail for same-named suggestions', () => {
  const places = parsePlaces([
    { lat: '25.05', lon: '121.52', name: 'Central Park', display_name: 'Central Park, Zhongzheng, Taipei' },
    { lat: '25.01', lon: '121.46', name: 'Central Park', display_name: 'Central Park, Banqiao, New Taipei' },
  ], 'Central Park');

  assert.deepEqual(places, [
    { point: [25.05, 121.52], name: 'Central Park', detail: 'Zhongzheng, Taipei' },
    { point: [25.01, 121.46], name: 'Central Park', detail: 'Banqiao, New Taipei' },
  ]);
});
