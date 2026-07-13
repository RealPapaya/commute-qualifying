// Browser smoke for near-start manual controls and off-route continuation.
// Run with the static server already listening on http://localhost:8080.
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 480, height: 900 },
  permissions: ['geolocation'],
  geolocation: { latitude: 25.0009, longitude: 121.5, accuracy: 5 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
await page.route('https://tiles.openfreemap.org/styles/positron', route => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
}));
await page.route('https://router.project-osrm.org/route/v1/driving/**', route => {
  const coordinates = new URL(route.request().url()).pathname.split('/').at(-1)
    .split(';').map(pair => pair.split(',').map(Number));
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ code: 'Ok', routes: [{ geometry: { coordinates } }] }),
  });
});

await page.goto('http://localhost:8080/');
await page.evaluate(() => {
  localStorage.setItem('commute-qualifying-v1', JSON.stringify({
    routes: [{
      id: 'manual-route',
      name: 'Manual start route',
      waypoints: [[25, 121.5], [25.02, 121.5]],
      snap: true,
      points: [[25, 121.5], [25.02, 121.5]],
      lights: [],
      sectorBoundaries: [700, 1400],
      timingVersion: 1,
    }],
    runs: [],
  }));
});
await page.reload();
await page.click('[data-view="routes"]');
await page.click('#route-list [data-run]');
await page.click('#btn-arm');

await page.waitForSelector('#btn-manual-start:not([hidden])');
await page.click('#btn-manual-start');
await page.waitForSelector('#btn-restart-run:not([hidden])');
await page.click('#btn-restart-run');

await context.setGeolocation({ latitude: 25.0045, longitude: 121.5015, accuracy: 5 });
await page.waitForSelector('#offroute-flag:not([hidden])');
await page.click('#btn-replan-route');
await page.waitForFunction(() => {
  const db = JSON.parse(localStorage.getItem('commute-qualifying-v1'));
  return db.routes.length === 2 && document.getElementById('offroute-flag').hidden;
});

const result = await page.evaluate(() => ({
  routeNames: JSON.parse(localStorage.getItem('commute-qualifying-v1')).routes.map(route => route.name),
  status: document.getElementById('run-status').textContent,
  clock: document.getElementById('run-clock').textContent,
}));
if (!result.routeNames.some(name => name.endsWith('— alternate'))) {
  throw new Error(`alternate route was not saved: ${result.routeNames.join(', ')}`);
}
if (!result.status.includes('timing continued') || result.clock === '--:--:---') {
  throw new Error(`live timing did not continue: ${JSON.stringify(result)}`);
}
if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);

console.log(JSON.stringify(result));
await browser.close();
