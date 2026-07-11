// Closed-circuit browser smoke. Run with the static server on :8080.
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));

await page.addInitScript(() => {
  const markerOptions = [];
  const markerStates = [];
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
  let mapClick = null;
  const fakeMap = {
    on(event, handler) {
      if (event === 'click') mapClick = handler;
      return fakeMap;
    },
    fire(event, payload) {
      if (event === 'click') mapClick?.(payload);
      return fakeMap;
    },
    setView: () => fakeMap,
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
    marker: (point, options) => {
      markerOptions.push(options);
      const layer = makeLayer();
      const handlers = {};
      let current = point;
      layer.on = (event, handler) => { handlers[event] = handler; return layer; };
      layer.getLatLng = () => ({ lat: current[0], lng: current[1] });
      markerStates.push({ options, handlers, setPoint: point => { current = point; } });
      return layer;
    },
    circleMarker: makeLayer,
    layerGroup: makeLayer,
    divIcon: options => options,
    latLngBounds: points => points,
  };
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: () => {} },
  });
  window.__markerOptions = markerOptions;
  window.__dragLatestMarker = (title, point) => {
    const state = markerStates.findLast(marker => marker.options?.title === title);
    state.setPoint(point);
    state.handlers.dragend();
  };
});

try {
  await page.goto('http://127.0.0.1:8080/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.click('#btn-new-route');
  await page.waitForSelector('#new-route-options:not([hidden])');
  await page.click('[data-new-route-mode="plan"]');
  await page.waitForFunction(() => document.getElementById('view-editor').classList.contains('active'),
    null, { timeout: 5000 }).catch(async () => {
      const state = await page.evaluate(() => ({
        editorClass: document.getElementById('view-editor').className,
        routeClass: document.getElementById('view-routes').className,
      }));
      throw new Error(`editor did not open: ${JSON.stringify(state)}; pageerrors: ${errors.join('\n')}`);
    });
  await page.locator('#snap-toggle').locator('..').click();
  if (!await page.locator('#closed-loop-toggle').isDisabled()) {
    throw new Error('closed-loop toggle should be disabled before endpoints match');
  }
  await page.evaluate(() => {
    window._editorMap.fire('click', { latlng: { lat: 25.0, lng: 121.5 } });
    window._editorMap.fire('click', { latlng: { lat: 25.003, lng: 121.503 } });
    window._editorMap.fire('click', { latlng: { lat: 25.004, lng: 121.504 } });
  });
  if (!await page.locator('#closed-loop-toggle').isDisabled()) {
    throw new Error('closed-loop toggle enabled while endpoints differ');
  }
  await page.evaluate(() => window.__dragLatestMarker('終點', [25.0, 121.5]));
  if (await page.locator('#closed-loop-toggle').isDisabled()) {
    throw new Error('dragging the finish onto the start did not enable closed-loop');
  }
  for (const [lat, lng] of [[25.003, 121.5], [25.003, 121.503]]) {
    await page.click('#btn-add-via');
    await page.evaluate(([lat, lng]) =>
      window._editorMap.fire('click', { latlng: { lat, lng } }), [lat, lng]);
  }
  await page.locator('#closed-loop-toggle').locator('..').click();
  const markerClasses = await page.evaluate(() => window.__markerOptions
    .map(options => options?.icon?.className).filter(Boolean));
  if (markerClasses.filter(name => name.includes('route-start-marker')).length < 1 ||
      markerClasses.filter(name => name.includes('route-end-marker')).length < 1 ||
      markerClasses.filter(name => name === 'wp-marker').length < 2) {
    throw new Error(`manual route marker roles missing: ${markerClasses.join(', ')}`);
  }
  if (!await page.evaluate(() => window.__markerOptions
    .filter(options => options?.icon?.className?.includes('route-endpoint-marker'))
    .every(options => options.icon.html.startsWith('<svg')))) {
    throw new Error('start/end markers are not rendered as SVG');
  }
  await page.waitForFunction(() =>
    !document.getElementById('route-stats').textContent.startsWith('0.00 km'));
  await page.click('#btn-save-route');
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('commute-qualifying-v1'));
    return saved?.routes?.[0]?.closedLoop === true;
  });
  const savedWaypoints = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('commute-qualifying-v1')).routes[0].waypoints);
  if (savedWaypoints.length !== 4) {
    throw new Error(`ordinary click added a waypoint or armed vias were lost: ${savedWaypoints.length}`);
  }

  await page.click('#route-list [data-run]');
  await page.click('#btn-simulate');
  await page.waitForFunction(() =>
    document.getElementById('run-status').textContent.startsWith('LAP 1 FINISHED'),
    null, { timeout: 30000 });
  await page.click('#btn-abort');

  const savedRuns = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('commute-qualifying-v1')).runs.length);
  if (savedRuns !== 1) throw new Error(`expected one saved lap, got ${savedRuns}`);
  if (errors.length) throw new Error(`pageerrors: ${errors.join('\n')}`);
  console.log('closed-loop browser smoke passed');
} finally {
  await browser.close();
}
