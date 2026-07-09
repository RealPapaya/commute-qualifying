import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:8080/');

const urls = [
  'https://nominatim.openstreetmap.org/status',
  'https://router.project-osrm.org/route/v1/driving/121.5,25.0;121.51,25.01?overview=false',
  'https://photon.komoot.io/api?q=test&limit=1',
];
for (const u of urls) {
  const r = await page.evaluate(async url => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      return `${res.status}`;
    } catch (e) { return `FAIL ${e.name}`; }
  }, u);
  console.log(r, u);
}
await browser.close();
