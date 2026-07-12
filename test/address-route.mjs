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
        flyTo() { return map; },
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
    marker(point, options) {
      const state = { options, active: false };
      markerStates.push(state);
      const marker = layer();
      const handlers = {};
      marker.addTo = () => { state.active = true; return marker; };
      marker.remove = () => { state.active = false; };
      marker.on = (name, handler) => { handlers[name] = handler; return marker; };
      marker.getLatLng = () => ({ lat: point[0], lng: point[1] });
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
await page.route('https://nominatim.openstreetmap.org/reverse**', route => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({
    lat: '25.0375', lon: '121.5637', name: '信義路五段',
    display_name: '信義路五段, 信義區, 臺北市',
  }),
}));
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
await page.click('[data-view="routes"]');
await page.click('#btn-new-route');
await page.waitForSelector('#new-route-options:not([hidden])');
await page.click('[data-new-route-mode="plan"]');
await page.waitForFunction(() => document.getElementById('view-editor').classList.contains('active'));

await page.click('.editor-panel .sheet-handle');
const editorDensity = await page.evaluate(() => {
  const panel = getComputedStyle(document.querySelector('.editor-panel'));
  const button = getComputedStyle(document.querySelector('#editor-toolbar .btn.tool'));
  const address = getComputedStyle(document.getElementById('place-start'));
  const head = getComputedStyle(document.querySelector('.editor-panel .panel-head'));
  const routeActions = [...document.querySelector('.editor-route-actions').children];
  return {
    panelPaddingTop: parseFloat(panel.paddingTop),
    toolHeight: parseFloat(button.minHeight),
    addressHeight: parseFloat(address.minHeight),
    headMarginBottom: parseFloat(head.marginBottom),
    svgControls: document.querySelectorAll('.btn .ui-icon').length,
    toolbarInHeader: document.querySelector('#topbar > .topbar-center > #editor-toolbar') !== null,
    toolbarInPanel: document.querySelector('.editor-panel #editor-toolbar') !== null,
    routeActionTops: routeActions.map(action => action.getBoundingClientRect().top),
    routeActionOrder: routeActions.map(action => action.id),
    statsAtBottom: document.querySelector('.editor-panel').lastElementChild
      .classList.contains('editor-stats'),
    buildButtonExists: Boolean(document.getElementById('btn-build-place-route')),
    toolHelp: document.getElementById('tool-help').textContent,
  };
});
if (editorDensity.panelPaddingTop > 10 ||
    editorDensity.toolHeight !== 34 ||
    editorDensity.addressHeight < 42 ||
    editorDensity.headMarginBottom > 6 ||
    editorDensity.svgControls < 12 ||
    !editorDensity.toolbarInHeader ||
    editorDensity.toolbarInPanel ||
    Math.max(...editorDensity.routeActionTops) - Math.min(...editorDensity.routeActionTops) > 1 ||
    editorDensity.routeActionOrder.join(',') !==
      'btn-undo-wp,btn-clear-route,btn-save-route,btn-track-diagram' ||
    !editorDensity.statsAtBottom ||
    editorDensity.buildButtonExists ||
    /choose/i.test(editorDensity.toolHelp)) {
  throw new Error(`editor layout is too loose: ${JSON.stringify(editorDensity)}`);
}

if (await page.locator('[data-place-role]').count() !== 3) {
  throw new Error('expected start, end, and via role buttons');
}
await page.evaluate(() => window._editorMap.fire('click', {
  latlng: { lat: 25.0478, lng: 121.5170 },
}));
if (await page.evaluate(() => window.__markerStates.some(state => state.active))) {
  throw new Error('map click added a route point before a point role was selected');
}

await page.click('[data-tool="light"]');
const lightState = await page.evaluate(() => ({
  formHidden: document.getElementById('place-route-form').hidden,
  actionsHidden: document.querySelector('[data-tool-actions="light"]').hidden,
  sectorHidden: document.getElementById('sector-summary').hidden,
}));
if (!lightState.formHidden || lightState.actionsHidden || !lightState.sectorHidden) {
  throw new Error('light tool displayed content belonging to another tool');
}
await page.click('[data-tool="sector"]');
const sectorState = await page.evaluate(() => ({
  formHidden: document.getElementById('place-route-form').hidden,
  actionsHidden: document.querySelector('[data-tool-actions="sector"]').hidden,
  sectorHidden: document.getElementById('sector-summary').hidden,
}));
if (!sectorState.formHidden || sectorState.actionsHidden || sectorState.sectorHidden) {
  throw new Error('sector tool displayed content belonging to another tool');
}
await page.click('[data-tool="trace"]');
const traceState = await page.evaluate(() => ({
  formHidden: document.getElementById('place-route-form').hidden,
  sectorHidden: document.getElementById('sector-summary').hidden,
}));
if (traceState.formHidden || !traceState.sectorHidden) {
  throw new Error('trace tool did not restore its route controls');
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
if (!await page.evaluate(() => window.__markerStates.some(state =>
  state.active &&
  state.options?.draggable === true &&
  state.options?.icon?.className?.includes('route-start-marker')))) {
  throw new Error('start-only marker should remain editable by dragging');
}

await page.click('#btn-place-end');
await page.fill('#place-end', '終點');
await page.locator('#place-end + .place-suggestions .place-suggestion').click();

await page.click('#btn-add-via');
if (!await page.locator('#btn-add-via').isDisabled()) {
  throw new Error('via button should lock while its point is pending');
}
await page.evaluate(() => window._editorMap.fire('click', {
  latlng: { lat: 25.0375, lng: 121.5637 },
}));
await page.waitForFunction(() => document.querySelector('#place-via-list .place-input').value
  .includes('信義路五段'));
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
if (!status.includes('信義路五段')) throw new Error(`unexpected status: ${status}`);
await page.click('#btn-save-route');
if (await page.locator('#route-name').count()) {
  throw new Error('route name should not be editable in the route editor');
}
await page.fill('#route-list [data-route-name]', '通勤測試路線');
await page.locator('#route-list [data-route-name]').press('Enter');
const savedName = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('commute-qualifying-v1')).routes[0].name);
if (savedName !== '通勤測試路線') throw new Error(`route rename was not saved: ${savedName}`);
if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);
console.log('address route smoke passed:', status);
await browser.close();
