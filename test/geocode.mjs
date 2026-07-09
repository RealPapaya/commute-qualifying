// One-off: geocode the two demo addresses from inside a real browser
// (this network blocks non-browser TLS clients to nominatim).
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:8080/');

for (const q of ['立德路115號', '莊泰路1132號']) {
  const results = await page.evaluate(async query => {
    const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=tw&limit=5&addressdetails=1&q=' +
      encodeURIComponent(query);
    const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
    return res.json();
  }, q);
  console.log('Q:', q);
  for (const r of results) {
    console.log(' ', r.lat, r.lon, '|', r.display_name);
  }
  await page.waitForTimeout(1200); // nominatim rate limit
}
await browser.close();
