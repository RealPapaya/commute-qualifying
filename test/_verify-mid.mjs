// Focused check of the new RUN mid panel size + moved DIAGRAM/DOT controls.
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.route('**/favicon.ico', r => r.fulfill({ status: 204, body: '' }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto('http://localhost:8080/?test=1');
await page.evaluate(() => {
  const pts = [];
  for (let i = 0; i <= 30; i++) pts.push([24.9876, 121.4630 + i * 0.0002]);
  for (let i = 1; i <= 30; i++) pts.push([24.9876 + i * 0.00018, 121.4630 + 30 * 0.0002]);
  for (let i = 1; i <= 20; i++) pts.push([24.9876 + 30 * 0.00018, 121.4630 + 30 * 0.0002 - i * 0.0002]);
  const route = { id: 'r1', name: 'ADELAIDE', points: pts,
    waypoints: [pts[0], pts[30], pts[60], pts.at(-1)], snap: false,
    sectorBoundaries: [500, 1000], lights: [], timingVersion: 1 };
  localStorage.setItem('commute-qualifying-v1', JSON.stringify({ routes: [route], runs: [] }));
});
await page.reload();
await page.evaluate(() => document.fonts.ready);
await page.click('[data-view="routes"]');
await page.click('#route-list [data-run]');
await page.waitForTimeout(700);

// Controls moved into the header settings dropdown.
await page.click('.settings-button');
await page.waitForTimeout(150);
const inSettings = await page.evaluate(() => {
  const panel = document.querySelector('.settings-panel');
  return {
    cursor: panel.contains(document.getElementById('run-cursor-type')),
    diagram: panel.contains(document.getElementById('btn-run-track-diagram')),
    leftoverRunOptions: Boolean(document.querySelector('.run-options')),
  };
});
console.log('settings holds moved controls:', JSON.stringify(inSettings));
await page.screenshot({ path: 'test/shots/mid-mid-settings.png' });
await page.click('.settings-button'); // close dropdown

// Kick off a simulated lap so sectors take real colours, then screenshot mid.
await page.click('#btn-simulate');
await page.waitForFunction(() =>
  document.querySelectorAll('#sector-board .sector-row.set-purple, #sector-board .sector-row.set-green, #sector-board .sector-row.set-yellow, #sector-board .sector-row.current').length > 0,
  { timeout: 8000 }).catch(() => console.log('note: no coloured sector yet'));

// collapsed -> mid
await page.click('.run-panel .sheet-handle');
await page.waitForSelector('.run-panel[data-sheet-state="mid"]');
await page.waitForTimeout(300);
const midInfo = await page.evaluate(() => {
  const clock = document.getElementById('run-clock');
  const board = document.getElementById('sector-board');
  const cs = getComputedStyle(board);
  const rows = [...board.querySelectorAll('.sector-row:not(.total-row)')];
  return {
    boardFlexDir: cs.flexDirection,
    rowHeights: rows.map(r => Math.round(r.getBoundingClientRect().height)),
    rowBg: rows.map(r => getComputedStyle(r).backgroundColor),
    spansHidden: rows.every(r => [...r.querySelectorAll('span')].every(s => getComputedStyle(s).display === 'none')),
    totalRowHidden: getComputedStyle(board.querySelector('.total-row')).display === 'none',
    startBtnHidden: getComputedStyle(document.querySelector('.run-panel > .toolbar')).display === 'none',
    clockFontPx: Math.round(parseFloat(getComputedStyle(clock).fontSize)),
  };
});
console.log('mid layout:', JSON.stringify(midInfo, null, 2));
await page.screenshot({ path: 'test/shots/mid-mid-run.png' });

// mid -> expanded (numbers back)
await page.click('.run-panel .sheet-handle');
await page.waitForSelector('.run-panel[data-sheet-state="expanded"]');
await page.waitForTimeout(300);
await page.screenshot({ path: 'test/shots/mid-expanded-run.png' });

console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
