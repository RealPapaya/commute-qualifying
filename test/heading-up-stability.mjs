// Heading-up (始終向前) must NOT keep rotating on a straight road just because
// GPS jitters. This drives the real app with noisy fixes along a straight route,
// reads the live map bearing after each fix, and compares it against what the
// naive "bearing between consecutive fixes" method would have produced on the
// SAME jittery input. It also drops screenshots into test/shots/ so the steady
// orientation is visible.
//
//   npm start                       # in another terminal
//   node test/heading-up-stability.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('test/shots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 480, height: 900 },
  geolocation: { latitude: 24.9876, longitude: 121.4630 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
await page.route('**/favicon.ico', r => r.fulfill({ status: 204, body: '' }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

// Deterministic jitter (no Math.random → reproducible test).
let seed = 1234567;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
const jit = () => rand() * 0.00011;             // ~±6 m
const bearingOf = (a, b) => {                    // the OLD naive per-fix heading
  const toR = d => d * Math.PI / 180;
  const y = Math.sin(toR(b[1] - a[1])) * Math.cos(toR(b[0]));
  const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) -
    Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(toR(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

await page.goto('http://localhost:8080/');
await page.evaluate(() => {
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push([24.9876, 121.4630 + i * 0.0002]); // straight, due east
  localStorage.setItem('commute-qualifying-v1', JSON.stringify({
    routes: [{ id: 'r1', name: 'straight', points: pts, sectorBoundaries: [], lights: [], timingVersion: 1 }],
    runs: [],
  }));
});
await page.reload();
await page.click('[data-view="routes"]');
await page.click('#route-list [data-run]');
await page.waitForTimeout(1300);

await page.click('#btn-arm');
await page.click('#btn-follow-user');
await page.click('#btn-compass');   // enable 始終向前

const liveBearing = () => page.evaluate(() =>
  Math.round(window._runBase.getMaplibreMap().getBearing()));

const rawFixes = [], appBearings = [];
for (let i = 0; i <= 30; i++) {
  const fix = [24.9876 + jit(), 121.4630 + i * 0.0002 + jit()];
  rawFixes.push(fix);
  await context.setGeolocation({ latitude: fix[0], longitude: fix[1] });
  await page.waitForTimeout(90);
  const b = await liveBearing();
  if (i >= 4) appBearings.push(b);           // skip the first few warm-up fixes
  if ([8, 16, 24].includes(i)) await page.locator('#run-map').screenshot({ path: `test/shots/heading-up-${i}.png` });
}

// What the OLD method would have done on the identical fixes.
const naive = [];
for (let i = 5; i < rawFixes.length; i++) naive.push(Math.round(bearingOf(rawFixes[i - 1], rawFixes[i])));
const spread = a => Math.max(...a) - Math.min(...a);

console.log('road is a straight line heading due east → true heading is 90°\n');
console.log('OLD (bearing between consecutive fixes):');
console.log('   values:', naive.join(' '));
console.log(`   spread: ${spread(naive)}°  ← this is the map spinning back and forth\n`);
console.log('NEW (route-tangent heading, live app map bearing):');
console.log('   values:', appBearings.join(' '));
console.log(`   spread: ${spread(appBearings)}°  ← steady`);
console.log('\nscreenshots: test/shots/heading-up-8.png, -16.png, -24.png (green route line stays vertical)');

const fail = [];
if (spread(appBearings) > 8) fail.push(`heading-up still spins: ${spread(appBearings)}° spread`);
if (!(spread(naive) > 15)) fail.push('test setup weak: old method did not jitter, add more noise');

console.log('\npageerrors:', errors.length ? errors : 'none');
console.log(fail.length ? 'FAIL: ' + fail.join('; ') : 'PASS');
await browser.close();
process.exit(fail.length ? 1 : 0);
