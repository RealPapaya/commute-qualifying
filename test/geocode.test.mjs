import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlace, searchPlace } from '../js/geocode.js';

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
  assert.throws(() => parsePlace([]), /搜尋結果/);
  assert.throws(() => parsePlace([{ lat: '91', lon: '121.5' }]), /座標無效/);
});

test('searchPlace: sends the entered query and parses the response', async () => {
  let requestedUrl;
  const result = await searchPlace('台北車站', async url => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => [{ lat: '25.0478', lon: '121.5170', display_name: '台北車站' }],
    };
  });
  assert.equal(requestedUrl.searchParams.get('q'), '台北車站');
  assert.deepEqual(result.point, [25.0478, 121.517]);
});
