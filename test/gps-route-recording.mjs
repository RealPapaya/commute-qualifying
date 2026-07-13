// Browser smoke test for the New Route GPS recording option. Run with
// `npm start` already serving this directory on :8080.
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));

await page.addInitScript(() => {
  const makeLayer = () => {
    const layer = {
      addTo: () => layer,
      remove: () => {},
      on: () => layer,
      bindPopup: () => layer,
      setLatLng: () => layer,
      getLatLng: () => ({ lat: 25, lng: 121.5 }),
      getElement: () => null,
    };
    return layer;
  };
  const fakeMap = {
    on: () => fakeMap,
    setView: () => fakeMap,
    flyTo: () => fakeMap,
    panTo: () => fakeMap,
    fitBounds: () => fakeMap,
    invalidateSize: () => fakeMap,
    getZoom: () => 13,
    dragging: { disable: () => {}, enable: () => {} },
  };
  window.L = {
    map: () => fakeMap,
    maplibreGL: () => ({
      addTo() { return this; },
      getMaplibreMap: () => ({
        on: (_, callback) => callback({ target: {
          getLayer: () => null, setLayoutProperty: () => {}, setPaintProperty: () => {},
        } }),
      }),
    }),
    polyline: makeLayer,
    marker: makeLayer,
    circleMarker: makeLayer,
    divIcon: options => options,
    latLngBounds: points => points,
  };
  const watchers = new Map();
  let nextId = 1;
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition(success) {
        const id = nextId++;
        watchers.set(id, success);
        return id;
      },
      clearWatch(id) {
        watchers.delete(id);
      },
      getCurrentPosition(success) {
        success({ coords: { latitude: 25.0, longitude: 121.5, accuracy: 8 } });
      },
    },
  });
  window.__emitRecordedFix = (latitude, longitude, accuracy = 8) => {
    const position = { coords: { latitude, longitude, accuracy }, timestamp: Date.now() };
    watchers.forEach(success => success(position));
  };
});

await page.goto('http://127.0.0.1:8080/');
await page.evaluate(() => localStorage.clear());
await page.reload();

await page.click('[data-view="routes"]');
await page.click('#btn-new-route');
await page.fill('#new-route-name', 'GPS smoke route');
await page.click('[data-new-route-mode="record"]');
await page.waitForSelector('#gps-recording-panel:not([hidden])');
if (await page.locator('#place-route-form').isVisible()) {
  throw new Error('GPS recording mode left the planning form visible');
}

await page.click('#btn-start-gps-recording');
await page.evaluate(() => window.__emitRecordedFix(25.0000, 121.5000));
await page.evaluate(() => window.__emitRecordedFix(25.0006, 121.5000));
await page.waitForFunction(() => document.getElementById('gps-recording-status').textContent.includes('2 GPS points'));
await page.click('#btn-record-checkpoint');
await page.click('#btn-record-light');
await page.evaluate(() => window.__emitRecordedFix(25.0012, 121.5000));
await page.click('#btn-stop-gps-recording');
await page.click('#btn-save-route');

const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('commute-qualifying-v1')).routes[0]);
if (saved.name !== 'GPS smoke route' || !saved.recorded || saved.snap !== false || saved.points.length !== 3 || saved.waypoints.length !== 3) {
  throw new Error(`unexpected recorded route: ${JSON.stringify(saved)}`);
}
if (saved.sectorBoundaries.length !== 1 || saved.lights.length !== 1) {
  throw new Error(`recorded markers missing: ${JSON.stringify(saved)}`);
}
await page.click('#btn-new-route');
await page.fill('#new-route-name', 'Planning route');
await page.click('[data-new-route-mode="plan"]');
if (!await page.locator('#place-route-form').isVisible() ||
    await page.locator('#gps-recording-panel').isVisible()) {
  throw new Error('planning route option did not restore the existing planner');
}
if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);
console.log('GPS route recording smoke passed:', saved.name);
await browser.close();
