// Verifies the DETAIL telemetry sheet end-to-end: seed a route + history,
// simulate a lap (which records a timestamped trace), open the summary, click
// "詳細數據 / DETAILS", and assert the detail sheet renders with live data.
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/?test=1'); // ?test=1 reveals the simulator

await page.evaluate(() => {
  const pts = [];
  for (let i = 0; i <= 30; i++) pts.push([24.9876, 121.4630 + i * 0.0002]);
  for (let i = 1; i <= 30; i++) pts.push([24.9876 + i * 0.00018, 121.4630 + 30 * 0.0002]);
  const route = {
    id: 'r1', name: '立德路 莊泰路', points: pts,
    sectorBoundaries: [400, 800], lights: [[24.9876, 121.4690]], timingVersion: 1,
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
await page.waitForTimeout(400);

// Open the detail sheet from the summary card.
await page.click('.f1c-details');
await page.waitForSelector('#detail-overlay .dt-sheet', { timeout: 8000 });
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const q = s => document.querySelector(s)?.textContent.trim();
  return {
    title: q('.dt-title'),
    lap: q('.dt-laptime-val'),
    tiles: [...document.querySelectorAll('.dt-tile')].map(t =>
      `${t.querySelector('.dt-tile-label').textContent.split(' ')[0]}=${t.querySelector('.dt-tile-val').textContent}`),
    sectors: document.querySelectorAll('.dt-srow').length,
    hasProfile: !!document.querySelector('.dt-profile-svg'),
    idealTime: q('.dt-ideal-time'),
    compareRows: document.querySelectorAll('.dt-table tbody tr').length,
    stopSummary: q('.dt-stop-summary') || q('.dt-clean') || q('.dt-empty'),
  };
});
console.log(JSON.stringify(info, null, 1));

if (!info.title) throw new Error('detail title missing');
if (info.sectors !== 3) throw new Error(`expected 3 sector rows, got ${info.sectors}`);
if (info.compareRows < 2) throw new Error(`expected comparison rows, got ${info.compareRows}`);

await page.locator('#detail-overlay').screenshot({ path: 'test/shots/11-detail-sheet.png' });

// Escape closes the detail sheet but leaves the summary card up.
await page.keyboard.press('Escape');
await page.waitForSelector('#detail-overlay', { state: 'hidden', timeout: 4000 });
if (await page.locator('#summary-overlay').isHidden()) {
  throw new Error('Escape closed the summary too — detail should peel off first');
}
console.log('escape peels detail off summary: ok');

// Re-open and close via the ✕ button.
await page.click('.f1c-details');
await page.waitForSelector('#detail-overlay .dt-sheet', { timeout: 4000 });
await page.click('.dt-close');
await page.waitForSelector('#detail-overlay', { state: 'hidden', timeout: 4000 });
console.log('close button: ok');

console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
