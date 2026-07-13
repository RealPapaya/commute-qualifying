import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlace, parsePlaces, parseReversePlace, reversePlace,
         searchPlace, searchPlaces } from '../js/geocode.js';

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

test('parseReversePlace: returns one address result', () => {
  assert.deepEqual(parseReversePlace({
    lat: '25.0478', lon: '121.5170', name: '忠孝西路一段',
    display_name: '忠孝西路一段, 中正區, 臺北市',
  }), {
    point: [25.0478, 121.517],
    name: '忠孝西路一段',
    detail: '中正區, 臺北市',
  });
  assert.throws(() => parseReversePlace({ error: 'Unable to geocode' }));
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

test('reversePlace: sends map coordinates and parses the address', async () => {
  let requestedUrl;
  const result = await reversePlace([25.0478, 121.517], async url => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => ({
        lat: '25.0478', lon: '121.5170', name: '忠孝西路一段',
        display_name: '忠孝西路一段, 中正區, 臺北市',
      }),
    };
  });
  assert.equal(requestedUrl.pathname, '/reverse');
  assert.equal(requestedUrl.searchParams.get('lat'), '25.0478');
  assert.equal(requestedUrl.searchParams.get('lon'), '121.517');
  assert.equal(result.name, '忠孝西路一段');
  assert.equal(result.detail, '中正區, 臺北市');
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

test('parsePlaces: formats Taiwan addresses in Google order and keeps landmarks prominent', () => {
  const [landmark, address] = parsePlaces([
    {
      lat: '25.0400', lon: '121.5119', name: '總統府',
      display_name: '總統府, 122, 重慶南路一段, 建國里, 中正區, 臺北市, 100',
      address: {
        amenity: '總統府', house_number: '122', road: '重慶南路一段', village: '建國里',
        city_district: '中正區', city: '臺北市', postcode: '100', country_code: 'tw',
      },
    },
    {
      lat: '25.0401', lon: '121.5120', name: '122',
      display_name: '122, 重慶南路一段, 建國里, 中正區, 臺北市, 100',
      address: {
        house_number: '122', road: '重慶南路一段', village: '建國里',
        city_district: '中正區', city: '臺北市', postcode: '100', country_code: 'tw',
      },
    },
  ]);

  assert.deepEqual(landmark, {
    point: [25.04, 121.5119],
    name: '總統府',
    detail: '臺北市中正區建國里重慶南路一段122號',
  });
  assert.deepEqual(address, {
    point: [25.0401, 121.512],
    name: '臺北市中正區建國里重慶南路一段122號',
  });
});
