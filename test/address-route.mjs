// Browser smoke test for text-built routes. Run with `npm start` already on :8080.
import { chromium } from 'playwright';

const places = {
  起點: ['25.0478', '121.5170', '台北車站'],
  必經點: ['25.0375', '121.5637', '國父紀念館'],
  終點: ['25.0330', '121.5654', '台北市政府'],
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route('https://nominatim.openstreetmap.org/search**', async route => {
  const query = new URL(route.request().url()).searchParams.get('q');
  const place = places[query];
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(place ? [{ lat: place[0], lon: place[1], display_name: place[2] }] : []),
  });
});

await page.goto('http://localhost:8080/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click('#btn-new-route');
await page.click('[data-new-route-mode="plan"]');
await page.fill('#place-start', '起點');
await page.click('#btn-add-via');
await page.fill('#place-via-list .place-input', '必經點');
await page.fill('#place-end', '終點');
await page.click('#btn-build-place-route');
await page.waitForFunction(() => document.querySelectorAll('.wp-marker').length === 3,
  null, { timeout: 20000 });

const status = await page.locator('#place-route-status').textContent();
if (!status.includes('路線已建立')) throw new Error(`unexpected status: ${status}`);
if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);
console.log('address route smoke passed:', status);
await browser.close();
