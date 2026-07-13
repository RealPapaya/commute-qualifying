// Verifies the real app path: seed a route + history, simulate a lap, and
// confirm finishRun() raises the summary card with correct live data.
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/');

// ~1.1 km L-shaped route near 土城, three sectors, plus three earlier runs.
await page.evaluate(() => {
  const pts = [];
  for (let i = 0; i <= 30; i++) pts.push([24.9876, 121.4630 + i * 0.0002]);
  for (let i = 1; i <= 30; i++) pts.push([24.9876 + i * 0.00018, 121.4630 + 30 * 0.0002]);
  const route = {
    id: 'r1', name: '立德路 莊泰路', points: pts,
    sectorBoundaries: [400, 800], lights: [], timingVersion: 1,
  };
  const mk = (id, total, date) => ({
    id, routeId: 'r1', timingVersion: 1, date,
    sectorTimes: [total * 0.35, total * 0.33, total * 0.32],
    totalTime: total, completed: true, simulated: true,
  });
  localStorage.setItem('commute-qualifying-v1', JSON.stringify({
    routes: [route],
    runs: [
      mk('a', 132000, '2024-03-02T08:10:00Z'),
      mk('b', 128500, '2025-06-11T08:05:00Z'),
      mk('c', 141000, '2026-01-20T08:20:00Z'),
    ],
  }));
});
await page.reload();

await page.click('[data-view="routes"]');
await page.click('#route-list [data-run]');
await page.waitForTimeout(1200);
await page.click('#btn-simulate');

await page.waitForSelector('#summary-overlay .f1c-card', { timeout: 90000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

const text = await page.evaluate(() => {
  const q = s => document.querySelector(s)?.textContent.trim();
  return {
    eyebrow: q('.f1c-eyebrow'),
    title: q('.f1c-title'),
    length: q('.f1c-stat-value-big'),
    stats: [...document.querySelectorAll('.f1c-stat')].map(e =>
      `${e.querySelector('.f1c-stat-label').textContent} = ${e.querySelector('.f1c-stat-value').textContent}`),
    bar: q('.f1c-bar-round') + ' | ' + q('.f1c-bar-tag'),
    myTime: q('.f1c-mytime'),
    trackTime: q('.f1c-tracktime-value'),
    badge: q('.f1c-badge-num') + ' ' + q('.f1c-badge-team'),
    corners: document.querySelectorAll('.f1c-corner').length,
  };
});
console.log(JSON.stringify(text, null, 1));

await page.locator('#summary-overlay').screenshot({ path: 'test/shots/10-summary-card.png' });

// dismissal must actually work, or the run view is unusable afterwards
await page.click('.f1c-close');
await page.waitForSelector('#summary-overlay', { state: 'hidden', timeout: 4000 });
console.log('close: ok');

// The collapsed Run sheet must not create page-level overflow after dismissing
// the summary; otherwise the view is left scrolled part-way into the sheet and
// its handle appears clipped.
const sheetBeforeExpand = await page.evaluate(() => ({
  scrollY,
  state: document.querySelector('.run-panel').dataset.sheetState,
}));
if (sheetBeforeExpand.scrollY !== 0 || sheetBeforeExpand.state !== 'collapsed') {
  throw new Error(`Run sheet is not reset after summary dismissal: ${JSON.stringify(sheetBeforeExpand)}`);
}
await page.click('.run-panel .sheet-handle');
await page.waitForFunction(() =>
  document.querySelector('.run-panel').dataset.sheetState === 'expanded');
console.log('run sheet after summary: expandable');

await page.click('#btn-back');
await page.click('[data-view="history"]');
await page.waitForSelector('#summary-overlay .f1c-card', { timeout: 4000 });
console.log('history tab summary: ok');

await page.click('.f1c-close');
await page.waitForSelector('#summary-overlay', { state: 'hidden', timeout: 4000 });
await page.click('#run-history [data-summaryrun]');
await page.waitForSelector('#summary-overlay .f1c-card', { timeout: 4000 });
console.log('history button summary: ok');

console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
