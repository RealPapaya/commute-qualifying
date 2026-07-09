// Generic screenshot helper used by the summary-card compare loop.
// Usage: node test/shot.mjs <url> <out.png> [width] [height] [dsf]
// If the page defines window.__check(), its result is printed — used to assert
// that webfonts really loaded instead of silently falling back.
import { chromium } from 'playwright';

const [, , url, out, w = '900', h = '700', dsf = '2'] = process.argv;
if (!url || !out) {
  console.error('usage: node test/shot.mjs <url> <out.png> [w] [h] [dsf]');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({
  viewport: { width: +w, height: +h },
  deviceScaleFactor: +dsf,
});
const failed = [];
page.on('requestfailed', r => failed.push(r.url()));
page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

const check = await page.evaluate(() => window.__check?.() ?? null);
if (check) {
  for (const [fam, ok] of Object.entries(check)) console.log(ok ? '  ok  ' : ' MISS ', fam);
  if (Object.values(check).some(v => !v)) console.log('!! some fonts did NOT load');
}
if (failed.length) console.log('failed requests:\n  ' + failed.join('\n  '));

await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('shot ->', out);
