// Keyless place search for the route editor. The browser calls Nominatim
// directly, so callers keep requests sequential and show their own progress.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

function placeFromResult(result) {
  if (result?.lat === '' || result?.lat == null || result?.lon === '' || result?.lon == null) {
    return null;
  }
  const point = [Number(result.lat), Number(result.lon)];
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
    point[0] < -90 || point[0] > 90 || point[1] < -180 || point[1] > 180) {
    return null;
  }
  const displayName = result.display_name?.trim() || '';
  const displayParts = displayName.split(',').map(part => part.trim()).filter(Boolean);
  const name = result.name?.trim() || result.namedetails?.name?.trim() ||
    displayParts[0] || '已選取地點';
  const detail = normalizeSearchText(name) === normalizeSearchText(displayParts[0])
    ? displayParts.slice(1).join(', ')
    : displayName;
  return { point, name, ...(detail && { detail }) };
}

function normalizeSearchText(value) {
  return String(value ?? '').toLocaleLowerCase().replace(/[\s,，、.-]/g, '');
}

function matchRank(result, query) {
  const term = normalizeSearchText(query);
  if (!term) return 0;
  const name = normalizeSearchText(result.name || result.namedetails?.name ||
    result.display_name?.split(',')[0]);
  const displayName = normalizeSearchText(result.display_name);
  if (name === term) return 3;
  if (name.startsWith(term)) return 2;
  return name.includes(term) || displayName.includes(term) ? 1 : 0;
}

export function parsePlace(results) {
  const place = (results ?? []).map(placeFromResult).find(Boolean);
  if (!place) throw new Error('沒有符合的搜尋結果。');
  return place;
}

export function parseReversePlace(result) {
  const place = placeFromResult(result);
  if (!place) throw new Error('找不到這個地圖位置的地址。');
  return place;
}

export function parsePlaces(results, query = '') {
  const seen = new Set();
  return (results ?? []).flatMap((result, index) => {
    const place = placeFromResult(result);
    if (!place) return [];
    const key = place.point.map(value => value.toFixed(5)).join(',');
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ place, index, rank: matchRank(result, query), importance: Number(result.importance) || 0 }];
  }).sort((a, b) =>
    b.rank - a.rank || b.importance - a.importance || a.index - b.index,
  ).map(result => result.place);
}

function searchParams(term, limit) {
  return new URLSearchParams({
    format: 'jsonv2',
    limit: String(limit),
    'accept-language': 'zh-TW',
    addressdetails: '1',
    namedetails: '1',
    countrycodes: 'tw',
    q: term,
  });
}

export async function searchPlace(query, fetcher = fetch) {
  const term = query.trim();
  if (!term) throw new Error('請輸入地點。');

  const response = await fetcher(`${NOMINATIM}?${searchParams(term, 1)}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('地點搜尋服務暫時無法使用。');
  return parsePlace(await response.json());
}

export async function searchPlaces(query, fetcher = fetch) {
  const term = query.trim();
  if (!term) throw new Error('請輸入地點。');

  const response = await fetcher(`${NOMINATIM}?${searchParams(term, 5)}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('地點搜尋服務暫時無法使用。');
  return parsePlaces(await response.json(), term);
}

export async function reversePlace(point, fetcher = fetch) {
  const [lat, lon] = point ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('地圖位置無效。');
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    'accept-language': 'zh-TW',
    addressdetails: '1',
    namedetails: '1',
    layer: 'address',
  });
  const response = await fetcher(`${NOMINATIM_REVERSE}?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('地址查詢服務暫時無法使用。');
  return parseReversePlace(await response.json());
}
