import { chromium } from 'playwright';

const route = {
  id: 'route-ui',
  name: 'UI route',
  points: [[25.0, 121.5], [25.001, 121.5], [25.002, 121.501]],
  sectorBoundaries: [120],
  lights: [],
  timingVersion: 1,
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:8080/');
await page.evaluate(r => {
  localStorage.setItem('commute-qualifying-v1', JSON.stringify({ routes: [r], runs: [] }));
}, route);
await page.reload();
await page.click('[data-run="route-ui"]');
await page.waitForSelector('#view-run.active');
await page.selectOption('#run-map-mode', 'track');
await page.waitForSelector('#run-track-diagram-svg svg path');
const result = await page.evaluate(() => {
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const overlay = rect(document.getElementById('run-track-diagram-overlay'));
  const map = rect(document.getElementById('run-map'));
  const panel = rect(document.querySelector('.run-panel'));
  const clock = rect(document.getElementById('run-clock'));
  const clockCenter = { x: (clock.left + clock.right) / 2, y: (clock.top + clock.bottom) / 2 };
  const clockCovered = clockCenter.x >= overlay.left && clockCenter.x <= overlay.right &&
    clockCenter.y >= overlay.top && clockCenter.y <= overlay.bottom;
  return {
    overlay,
    map,
    panel,
    clock,
    clockText: document.getElementById('run-clock').textContent,
    clockCovered,
    viewRunHasDiagramMode: document.getElementById('view-run').classList.contains('diagram-mode'),
    overlayHidden: document.getElementById('run-track-diagram-overlay').hidden,
  };
});
await browser.close();

const withinMap = result.overlay.left >= result.map.left - 1 && result.overlay.top >= result.map.top - 1 &&
  result.overlay.right <= result.map.right + 1 && result.overlay.bottom <= result.map.bottom + 1;
const missesPanel = result.overlay.right <= result.panel.left + 1 || result.overlay.left >= result.panel.right - 1 ||
  result.overlay.bottom <= result.panel.top + 1 || result.overlay.top >= result.panel.bottom - 1;
if (!withinMap) throw new Error(`overlay not constrained to map: ${JSON.stringify(result)}`);
if (!missesPanel) throw new Error(`overlay overlaps run panel: ${JSON.stringify(result)}`);
if (result.clockCovered) throw new Error(`clock is covered by overlay: ${JSON.stringify(result)}`);
if (result.viewRunHasDiagramMode) throw new Error('view-run still receives diagram-mode class');
if (result.overlayHidden) throw new Error('track overlay stayed hidden after selecting track mode');
console.log(JSON.stringify({ withinMap, missesPanel, clockCovered: result.clockCovered, clockText: result.clockText }));