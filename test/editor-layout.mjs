import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));

await page.goto('http://localhost:8080/');
await page.evaluate(() => {
  document.querySelector('[data-view="routes"]').click();
  document.getElementById('btn-new-route').click();
  document.querySelector('[data-new-route-mode="plan"]').click();
});
await page.waitForTimeout(1000);
if (!await page.locator('#view-editor').evaluate(element => element.classList.contains('active'))) {
  throw new Error(`editor did not open; page errors: ${errors.join('\n')}`);
}
await page.click('.editor-panel .sheet-handle');

const layout = await page.evaluate(() => {
  const ids = ['btn-undo-wp', 'btn-clear-route', 'btn-save-route', 'btn-track-diagram'];
  const buttons = ids.map(id => document.getElementById(id));
  return {
    buildButtonExists: Boolean(document.getElementById('btn-build-place-route')),
    buttonTops: buttons.map(button => button.getBoundingClientRect().top),
    buttonOrder: [...document.querySelector('.editor-route-actions').children].map(button => button.id),
    statsIsLast: document.querySelector('.editor-panel').lastElementChild?.classList.contains('editor-stats'),
    helpText: document.getElementById('tool-help').textContent,
  };
});

if (layout.buildButtonExists) throw new Error('place route build button is still visible in the DOM');
if (Math.max(...layout.buttonTops) - Math.min(...layout.buttonTops) > 1) {
  throw new Error(`editor route actions are not on one row: ${layout.buttonTops.join(', ')}`);
}
if (layout.buttonOrder.join(',') !== 'btn-undo-wp,btn-clear-route,btn-save-route,btn-track-diagram') {
  throw new Error(`unexpected editor action order: ${layout.buttonOrder.join(',')}`);
}
if (!layout.statsIsLast) throw new Error('route stats are not at the bottom of the editor panel');
if (/choose/i.test(layout.helpText)) throw new Error(`choose hint is still visible: ${layout.helpText}`);
if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);

console.log('editor layout smoke passed');
await browser.close();
