// Captures every app view at phone size so the restyle can be compared against
// the reference screenshots. Asserts the Archivo faces actually downloaded —
// a silent fallback renders a plausible-looking but wrong screenshot.
import { chromium } from 'playwright';

const W = +(process.argv[2] || 390);
const H = +(process.argv[3] || 844);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto('http://localhost:8080/');

await page.evaluate(() => {
  const pts = [];
  for (let i = 0; i <= 30; i++) pts.push([24.9876, 121.4630 + i * 0.0002]);
  for (let i = 1; i <= 30; i++) pts.push([24.9876 + i * 0.00018, 121.4630 + 30 * 0.0002]);
  for (let i = 1; i <= 20; i++) pts.push([24.9876 + 30 * 0.00018, 121.4630 + 30 * 0.0002 - i * 0.0002]);
  const route = {
    id: 'r1', name: 'ADELAIDE STREET CIRCUIT', points: pts,
    // openRoute() drives the editor off waypoints, not points
    waypoints: [pts[0], pts[30], pts[60], pts.at(-1)],
    snap: false,
    sectorBoundaries: [500, 1000], lights: [], timingVersion: 1,
  };
  const mk = (id, total, date) => ({
    id, routeId: 'r1', timingVersion: 1, date,
    sectorTimes: [total * 0.35, total * 0.33, total * 0.32],
    totalTime: total, completed: true, simulated: true,
  });
  localStorage.setItem('commute-qualifying-v1', JSON.stringify({
    routes: [route],
    runs: [mk('a', 132000, '2024-03-02T08:10:00Z'), mk('b', 128500, '2025-06-11T08:05:00Z')],
  }));
});
await page.reload();
await page.evaluate(() => document.fonts.ready);

// Prove the variable face is really there at the weights the shell asks for.
const fonts = await page.evaluate(async () => {
  const specs = ['700 12px Archivo', '800 21px Archivo', '900 16px Archivo'];
  await Promise.all(specs.map(s => document.fonts.load(s)));
  return Object.fromEntries(specs.map(s => [s, document.fonts.check(s)]));
});
for (const [spec, ok] of Object.entries(fonts)) console.log(ok ? '  ok  ' : ' MISS ', spec);
if (Object.values(fonts).some(v => !v)) {
  console.error('!! Archivo did not load — screenshots below are a fallback face');
  process.exitCode = 1;
}

const shot = n => page.screenshot({ path: `test/shots/shell-${n}.png` });
const waitForMap = async hook => {
  await page.waitForTimeout(150); // allow openRoute/openRun's deferred fitBounds
  await page.waitForFunction(name => {
    const map = window[name];
    return map && Object.values(map._layers).some(layer => {
      const glMap = layer.getMaplibreMap?.();
      return glMap?.loaded() && glMap.areTilesLoaded();
    });
  }, hook, { timeout: 15000 });
  await page.waitForTimeout(100); // let the completed WebGL frame reach the canvas
};

await page.waitForTimeout(400);
await shot('1-routes');

await page.click('#route-list [data-edit]');
await waitForMap('_editorMap');
await shot('2-editor');

await page.click('#btn-track-diagram');
await page.waitForSelector('#track-diagram-svg svg');
await page.waitForTimeout(300);
await shot('3-track-diagram');
await page.click('#btn-diagram-back');

await page.click('[data-view="run"]');
await waitForMap('_runMap');
await shot('4-run');

await page.click('[data-view="history"]');
await page.waitForTimeout(400);
await shot('5-history');

// nav bar geometry, so the reference comparison has numbers behind it
const nav = await page.evaluate(() => {
  const n = document.getElementById('tabs');
  const r = n.getBoundingClientRect();
  const cs = getComputedStyle(n);
  const active = document.querySelector('.tab.active');
  return {
    rect: [r.x, r.y, r.width, r.height].map(Math.round),
    bg: cs.backgroundColor, radius: cs.borderRadius,
    cells: document.querySelectorAll('#tabs .tab').length,
    activeLabel: active?.getAttribute('aria-label'),
    iconsVisible: [...document.querySelectorAll('#tabs .tab svg')].length,
  };
});
console.log('nav:', JSON.stringify(nav));
console.log('pageerrors:', errors.length ? errors : 'none');

await browser.close();
