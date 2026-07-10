// Keyless place search for the route editor. The browser calls Nominatim
// directly, so callers keep requests sequential and show their own progress.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export function parsePlace(results) {
  const result = results?.find(item =>
    Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)));
  if (!result) throw new Error('沒有符合的搜尋結果。');

  const point = [Number(result.lat), Number(result.lon)];
  if (point[0] < -90 || point[0] > 90 || point[1] < -180 || point[1] > 180) {
    throw new Error('搜尋結果的座標無效。');
  }
  return { point, name: result.display_name || '已選取地點' };
}

export async function searchPlace(query, fetcher = fetch) {
  const term = query.trim();
  if (!term) throw new Error('請輸入地點。');

  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    'accept-language': 'zh-TW',
    q: term,
  });
  const response = await fetcher(`${NOMINATIM}?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('地點搜尋服務暫時無法使用。');
  return parsePlace(await response.json());
}
