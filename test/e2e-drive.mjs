// E2E driver: builds the 立德路(土城) → 莊泰路(泰山) route through the real UI,
// customizes waypoints + sectors, runs two simulated laps, screenshots each stage.
// Run: node test/e2e-drive.mjs  (server must be up on :8080)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = process.argv[2] ?? 'test/shots';
mkdirSync(SHOTS, { recursive: true });

// street-level anchors (OSM has no house numbers for these addresses)
const START = [24.9876, 121.4630];   // 立德路, 土城區
const WP1 = [25.0080, 121.4520];   // via 板橋 corridor
const WP2 = [25.0300, 121.4375];   // 莊泰路 south (新莊)
const END = [25.0502, 121.4392];   // 莊泰路 north end (泰山) ~1132號

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.route('https://nominatim.openstreetmap.org/reverse**', async route => {
  const url = new URL(route.request().url());
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ lat, lon, display_name: `測試地址 ${lat}, ${lon}` }),
  });
});

const shot = async name => {
  await page.waitForTimeout(1500); // let tiles settle
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log('shot:', name);
};

await page.goto('http://localhost:8080/');
await page.evaluate(() => localStorage.clear());
await page.reload();

// ---- 1. new route, frame the map on the commute area ----
await page.click('[data-view="routes"]');
await page.click('#btn-new-route');
await page.fill('#new-route-name', 'E2E commute');
await page.click('[data-new-route-mode="plan"]');
await page.evaluate(([a, b]) => {
  window._editorMap.fitBounds(L.latLngBounds([a, b]).pad(0.15));
}, [START, END]);
await page.waitForTimeout(2500);

// click the map at a given latlng through the real mouse pipeline
async function clickMap(latlng) {
  const { x, y } = await page.evaluate(ll =>
    window._editorMap.latLngToContainerPoint(ll), latlng);
  const box = await page.locator('#editor-map').boundingBox();
  await page.mouse.click(box.x + x, box.y + y);
}
const stats = () => page.locator('#route-stats').textContent();

// Place the two endpoints, then explicitly arm each red via point.
await clickMap(START);
await page.waitForSelector('.route-start-marker');
await clickMap(END);
await page.waitForSelector('.route-end-marker');
for (let i = 0; i < [WP1, WP2].length; i++) {
  await page.click('#btn-add-via');
  await page.evaluate(latlng => window._editorMap.fire('click', {
    latlng: L.latLng(latlng),
  }), [WP1, WP2][i]);
  await page.waitForFunction(n =>
    document.querySelectorAll('.wp-marker').length === n, i + 1,
    { timeout: 20000 }).catch(async () => {
      const state = await page.evaluate(() => ({
        markers: document.querySelectorAll('.wp-marker').length,
        waypoints: window._editorMap ? document.getElementById('route-stats').textContent : '',
        vias: [...document.querySelectorAll('#place-via-list .place-input')].map(input => input.value),
        status: document.getElementById('place-route-status').textContent,
      }));
      throw new Error(`via ${i + 1} did not render: ${JSON.stringify(state)}; ${errors.join('\n')}`);
    });
  console.log(`via${i + 1}:`, await stats());
}
console.log('traced:', await stats());
await shot('1-route-traced');

// ---- 1a2. Feature B: F1-circuit-style track diagram presentation within the
// editor map. The editor panel stays visible and the same button toggles back.
await page.click('#btn-track-diagram');
await page.waitForSelector('#track-diagram-svg svg path');
const diagramPathCount = await page.locator('#track-diagram-svg svg path').count();
console.log('track diagram path elements:', diagramPathCount);
if (diagramPathCount === 0) throw new Error('track diagram rendered no path elements');
if (await page.locator('#track-diagram-overlay').isHidden()) {
  throw new Error('track diagram overlay did not become visible');
}
if (!await page.locator('.editor-panel').isVisible()) {
  throw new Error('editor panel disappeared in track diagram mode');
}
if (await page.locator('#btn-diagram-back').count()) {
  throw new Error('track diagram still has a separate back button');
}
const diagramSvg = page.locator('#track-diagram-svg svg');
const diagramBox = await diagramSvg.boundingBox();
const readViewBox = async () => (await diagramSvg.getAttribute('viewBox')).split(/\s+/).map(Number);
const viewBoxBeforeZoom = await readViewBox();
await page.mouse.move(diagramBox.x + diagramBox.width / 2, diagramBox.y + diagramBox.height / 2);
await page.mouse.wheel(0, -400);
const viewBoxAfterZoom = await readViewBox();
await page.mouse.down();
await page.mouse.move(diagramBox.x + diagramBox.width * 0.65,
  diagramBox.y + diagramBox.height * 0.6, { steps: 4 });
await page.mouse.up();
const viewBoxAfterDrag = await readViewBox();
if (viewBoxAfterZoom[2] >= viewBoxBeforeZoom[2] ||
    (viewBoxAfterDrag[0] === viewBoxAfterZoom[0] && viewBoxAfterDrag[1] === viewBoxAfterZoom[1])) {
  throw new Error(`track diagram zoom/drag failed: ${JSON.stringify({
    viewBoxBeforeZoom, viewBoxAfterZoom, viewBoxAfterDrag,
  })}`);
}
await shot('1a2-track-diagram');
await page.click('#btn-track-diagram');
await page.waitForSelector('.wp-marker', { state: 'visible' });
console.log('editor map restored after track diagram toggle, wp-markers:',
  await page.locator('.wp-marker').count());

// Traffic lights are manual-only; tracing a route must not create any.
if (await page.locator('.light-icon').count()) {
  throw new Error('traffic lights were imported automatically');
}

// ---- 1b. Feature A: drag the middle of the route path itself (not a
// waypoint marker) — should splice in a new via waypoint and reroute ----
const wpCountBeforePathDrag = await page.locator('.wp-marker').count();
const statsBeforePathDrag = await stats();
const pathMid = await page.evaluate(() => {
  const map = window._editorMap;
  let line = null;
  map.eachLayer(l => { if (l instanceof L.Polyline) line = l; });
  const latlngs = line.getLatLngs();
  const mid = latlngs[Math.floor(latlngs.length / 2)];
  return map.latLngToContainerPoint(mid);
});
const editorBox = await page.locator('#editor-map').boundingBox();
await page.mouse.move(editorBox.x + pathMid.x, editorBox.y + pathMid.y);
await page.mouse.down();
await page.mouse.move(editorBox.x + pathMid.x + 35, editorBox.y + pathMid.y - 25, { steps: 12 });
await page.mouse.up();
await page.waitForFunction(n =>
  document.querySelectorAll('.wp-marker').length === n, wpCountBeforePathDrag + 1,
  { timeout: 20000 });
const statsAfterPathDrag = await stats();
console.log('path-drag waypoints:', wpCountBeforePathDrag, '->',
  await page.locator('.wp-marker').count(), '| stats:', statsBeforePathDrag, '->', statsAfterPathDrag);
if (statsAfterPathDrag === statsBeforePathDrag) {
  throw new Error('path drag did not change route geometry');
}
await shot('1b-path-dragged');

// ---- 2. manual edit: drag the 2nd waypoint ~1 km east, route re-snaps ----
const wpEl = page.locator('.wp-marker').nth(1);
const wpBox = await wpEl.boundingBox();
const before = await stats();
await page.mouse.move(wpBox.x + 6, wpBox.y + 6);
await page.mouse.down();
await page.mouse.move(wpBox.x + 120, wpBox.y + 20, { steps: 12 });
await page.mouse.up();
await page.waitForFunction(prev =>
  document.getElementById('route-stats').textContent !== prev, before,
  { timeout: 20000 });
console.log('after drag:', await stats());
await shot('2-waypoint-dragged');

// ---- 3. traffic lights near two intersections along the route ----
await page.click('[data-tool="light"]');
await clickMap([25.5, 121.9]); // off-route: rejected
await clickMap(WP1); // on-route: accepted and snapped to the route
if (await page.locator('.light-icon').count() !== 1) {
  throw new Error('manual traffic-light route filtering failed');
}
await shot('3-traffic-lights');

// ---- 4. sectors: 3 -> 4, then drag a boundary handle along the route ----
await page.click('[data-tool="sector"]');
await page.click('#btn-add-sector'); // now 4 sectors
await page.waitForTimeout(500);
const handle = page.locator('.sector-handle').nth(0);
const hBox = await handle.boundingBox();
await page.mouse.move(hBox.x + 7, hBox.y + 7);
await page.mouse.down();
await page.mouse.move(hBox.x - 30, hBox.y + 70, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
console.log('sectors:', await page.locator('#sector-summary').textContent());
await shot('4-sectors-custom');

// ---- 5. save, run view ----
await page.click('#btn-save-route');
await page.fill('#route-list [data-route-name]', '立德路115號 → 莊泰路1132號');
await page.locator('#route-list [data-route-name]').press('Enter');
await shot('5-route-saved');
await page.click('#route-list [data-run]');
await page.waitForTimeout(2500);
await shot('6-run-armed-view');

// ---- 6. simulated lap 1 (all-time bests should come out purple) ----
async function simulateLap(tag) {
  await page.click('#btn-simulate');
  await page.waitForSelector('.sector-row.set-purple, .sector-row.set-green, .sector-row.set-yellow',
    { timeout: 120000 });
  await shot(`${tag}-mid`);
  await page.waitForFunction(() =>
    document.getElementById('run-status').textContent.startsWith('FINISHED'),
    null, { timeout: 240000 });
  console.log(tag, await page.locator('#run-status').textContent());
  await shot(`${tag}-finish`);

  // Finishing raises the F1-style summary card over the whole run view; capture
  // it, then dismiss it or the next click lands on the overlay instead.
  await page.waitForSelector('#summary-overlay .f1c-card', { timeout: 15000 });
  await shot(`${tag}-summary`);
  await page.click('.f1c-close');
  // state defaults to 'visible', which would wait for a [hidden] node to appear
  await page.waitForSelector('#summary-overlay', { state: 'hidden', timeout: 5000 });
}
await simulateLap('7-lap1');
await simulateLap('8-lap2'); // vs PB: mix of purple/green/yellow

// ---- 7. history ----
await page.click('#btn-back');
await page.click('[data-view="history"]');
await shot('9-history');

console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
