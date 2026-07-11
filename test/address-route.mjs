// Browser smoke test for text-built routes. Run with `npm start` already on :8080.
import { chromium } from 'playwright';

const places = {
  起點: ['25.0478', '121.5170', '台北車站'],
  必經點: ['25.0375', '121.5637', '國父紀念館'],
  終點: ['25.0330', '121.5654', '台北市政府'],
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => {
  const markerStates = [];
  const layer = () => ({
    addTo() { return this; },
    remove() {},
    on() { return this; },
    bindPopup() { return this; },
  });
  window.L = {
    map() {
      const handlers = {};
      const map = {
        setView() { return map; },
        on(name, handler) { handlers[name] = handler; return map; },
        fire(name, event) { handlers[name]?.(event); return map; },
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
    marker(_, options) {
      const state = { options, active: false };
      markerStates.push(state);
      const marker = layer();
      marker.addTo = () => { state.active = true; return marker; };
      marker.remove = () => { state.active = false; };
      return marker;
    },
    circleMarker: layer,
    layerGroup: layer,
    divIcon(options) { return options; },
    latLngBounds(points) { return points; },
  };
  window.__markerStates = markerStates;
});
await page.route('https://unpkg.com/**', route => route.fulfill({ body: '' }));
await page.route('https://nominatim.openstreetmap.org/search**', async route => {
  const query = new URL(route.request().url()).searchParams.get('q');
  const place = places[query];
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(place ? [{ lat: place[0], lon: place[1], display_name: place[2] }] : []),
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
await page.waitForSelector('#new-route-options:not([hidden])');
await page.click('[data-new-route-mode="plan"]');
await page.waitForFunction(() => document.getElementById('view-editor').classList.contains('active'));

if (await page.locator('[data-place-role]').count() !== 3) {
  throw new Error('expected start, end, and via role buttons');
}
await page.click('#btn-place-start');
if (!await page.locator('#btn-place-end').isDisabled() || !await page.locator('#btn-add-via').isDisabled()) {
  throw new Error('new point buttons should stay locked until the current point is selected');
}
await page.fill('#place-start', '起點');
await page.locator('#place-start + .place-suggestions .place-suggestion').click();
if (await page.locator('#btn-add-via').isDisabled()) {
  throw new Error('point buttons did not unlock after selecting the start');
}

await page.click('#btn-place-end');
await page.fill('#place-end', '終點');
await page.locator('#place-end + .place-suggestions .place-suggestion').click();

await page.click('#btn-add-via');
if (!await page.locator('#btn-add-via').isDisabled()) {
  throw new Error('via button should lock while its point is pending');
}
await page.click('#place-via-list .place-map-pick');
await page.evaluate(() => window._editorMap.fire('click', {
  latlng: { lat: 25.0375, lng: 121.5637 },
}));
if (await page.locator('#btn-add-via').isDisabled()) {
  throw new Error('via button did not unlock after the map point was selected');
}
await page.waitForFunction(() =>
  window.__markerStates.filter(state => state.active &&
    state.options?.icon?.className?.includes('route-start-marker')).length === 1 &&
  window.__markerStates.filter(state => state.active &&
    state.options?.icon?.className?.includes('route-end-marker')).length === 1 &&
  window.__markerStates.filter(state => state.active &&
    state.options?.icon?.className === 'wp-marker').length === 1,
  null, { timeout: 20000 });

const status = await page.locator('#place-route-status').textContent();
if (!status.includes('可以加入下一個點')) throw new Error(`unexpected status: ${status}`);
if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);
console.log('address route smoke passed:', status);
await browser.close();
