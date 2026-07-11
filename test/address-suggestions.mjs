// Browser smoke test for address suggestions. Run with `npm start` on :8080.
import { chromium } from 'playwright';

const places = {
  taipei: [
    ['25.0478', '121.5170', 'Taipei Main Station'],
    ['25.0330', '121.5654', 'Taipei City Hall'],
  ],
  xinyi: [['25.0375', '121.5637', 'Xinyi District Office']],
  tower: [['25.0330', '121.5654', 'Taipei 101']],
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => {
  const layer = () => ({
    addTo() { return this; },
    remove() {},
    on() { return this; },
    bindPopup() { return this; },
  });
  window.L = {
    map() {
      const map = {
        setView() { return map; },
        on() { return map; },
        invalidateSize() {},
        fitBounds() {},
        getZoom() { return 13; },
        panTo() {},
      };
      return map;
    },
    maplibreGL() {
      return {
        ...layer(),
        getMaplibreMap() { return { on() {} }; },
      };
    },
    polyline: layer,
    marker: layer,
    circleMarker: layer,
    layerGroup: layer,
    divIcon() { return {}; },
    latLngBounds(points) { return points; },
  };
});
await page.route('https://unpkg.com/**', route => route.fulfill({ body: '' }));
await page.route('https://nominatim.openstreetmap.org/search**', async route => {
  const query = new URL(route.request().url()).searchParams.get('q');
  const matches = places[query] ?? [];
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(matches.map(([lat, lon, display_name]) => ({ lat, lon, display_name }))),
  });
});
await page.route('https://router.project-osrm.org/**', route => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({
    code: 'Ok',
    routes: [{ geometry: { coordinates: [
      [121.5170, 25.0478], [121.5637, 25.0375], [121.5654, 25.0330],
    ] } }],
  }),
}));

await page.goto('http://localhost:8080/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click('#btn-new-route');
await page.click('[data-new-route-mode="plan"]');

await page.fill('#place-start', 'taipei');
await page.locator('#place-start + .place-suggestions .place-suggestion').first().click();
if (await page.locator('#place-start').inputValue() !== 'Taipei Main Station') {
  throw new Error('selecting a start suggestion did not fill the input');
}
await page.click('#btn-add-via');
await page.fill('#place-via-list .place-input', 'xinyi');
await page.locator('#place-via-list .place-suggestion').click();
await page.fill('#place-end', 'tower');
await page.locator('#place-end + .place-suggestions .place-suggestion').click();
await page.click('#btn-build-place-route');
await page.waitForFunction(() => document.querySelector('#place-route-status').textContent
  .includes('Taipei Main Station'),
  null, { timeout: 10000 });

if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);
console.log('address suggestions smoke passed');
await browser.close();
