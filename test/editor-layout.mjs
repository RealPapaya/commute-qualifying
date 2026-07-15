import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => {
  const layer = () => ({
    addTo() { return this; },
    remove() {},
    on() { return this; },
    bindPopup() { return this; },
  });
  window.L = {
    map() {
      const map = {
        setView() { return map; },
        on() { return map; },
        invalidateSize() {},
        fitBounds() {},
        getZoom() { return 13; },
        panTo() {},
        flyTo() {},
      };
      return map;
    },
    maplibreGL() {
      return {
        ...layer(),
        getMaplibreMap() { return { on() {} }; },
      };
    },
    polyline: layer,
    marker: layer,
    circleMarker: layer,
    layerGroup: layer,
    divIcon(options) { return options; },
    latLngBounds(points) { return points; },
  };
});
await page.route('https://unpkg.com/**', route => route.fulfill({ body: '' }));

await page.goto('http://localhost:8080/');
await page.evaluate(() => {
  document.querySelector('[data-view="routes"]').click();
  document.getElementById('btn-new-route').click();
  document.getElementById('new-route-name').value = 'Layout test route';
  document.querySelector('[data-new-route-mode="plan"]').click();
});
await page.waitForTimeout(1000);
if (!await page.locator('#view-editor').evaluate(element => element.classList.contains('active'))) {
  throw new Error(`editor did not open; page errors: ${errors.join('\n')}`);
}
await page.click('.editor-panel .sheet-handle');

const layout = await page.evaluate(() => {
  const ids = ['btn-editor-advanced', 'btn-save-route'];
  const buttons = ids.map(id => document.getElementById(id));
  const startBox = document.querySelector('[data-place-row="start"]').getBoundingClientRect();
  const endBox = document.querySelector('[data-place-row="end"]').getBoundingClientRect();
  const addBox = document.getElementById('btn-add-via').getBoundingClientRect();
  return {
    buildButtonExists: Boolean(document.getElementById('btn-build-place-route')),
    buttonTops: buttons.map(button => button.getBoundingClientRect().top),
    buttonOrder: [...document.querySelector('.editor-route-actions').children].map(button => button.id),
    advancedActionIds: [...document.querySelectorAll('.editor-settings-actions .btn')].map(button => button.id),
    actionsAreLast: document.querySelector('.editor-panel').lastElementChild?.classList.contains('editor-route-actions'),
    advancedHidden: document.getElementById('editor-advanced').hidden,
    endpointLayout: { startBox, endBox, addBox },
    helpText: document.getElementById('tool-help').textContent,
  };
});

if (layout.buildButtonExists) throw new Error('place route build button is still visible in the DOM');
if (Math.max(...layout.buttonTops) - Math.min(...layout.buttonTops) > 1) {
  throw new Error(`editor route actions are not on one row: ${layout.buttonTops.join(', ')}`);
}
if (layout.buttonOrder.join(',') !== 'btn-editor-advanced,btn-save-route') {
  throw new Error(`unexpected editor action order: ${layout.buttonOrder.join(',')}`);
}
if (layout.advancedActionIds.join(',') !== 'btn-undo-wp,btn-delete-route,btn-switch-recording') {
  throw new Error(`unexpected advanced actions: ${layout.advancedActionIds.join(',')}`);
}
if (!layout.actionsAreLast) throw new Error('the three editor actions are not the bottom row');
if (!layout.advancedHidden) throw new Error('advanced panel should start collapsed');
const { startBox, endBox, addBox } = layout.endpointLayout;
if (startBox.top >= endBox.top || Math.abs(addBox.top - startBox.top) > 1 ||
    Math.abs(addBox.height - startBox.height) > 1 || addBox.left <= startBox.right) {
  throw new Error(`unexpected endpoint layout: ${JSON.stringify(layout.endpointLayout)}`);
}
await page.click('#btn-editor-advanced');
if (!await page.locator('#editor-advanced').isVisible() ||
    await page.locator('#btn-editor-advanced').getAttribute('aria-expanded') !== 'true') {
  throw new Error('advanced panel did not open');
}
const advancedStructure = await page.evaluate(() => ({
  headings: [...document.querySelectorAll('#editor-advanced h3')].map(heading => heading.id),
  infoContainsStats: document.querySelector('[aria-labelledby="track-info-title"] #route-stats') !== null &&
    document.querySelector('[aria-labelledby="track-info-title"] #btn-track-diagram') !== null,
  settingsContainControls: document.querySelector('[aria-labelledby="editor-settings-title"] #snap-toggle') !== null &&
    document.querySelector('[aria-labelledby="editor-settings-title"] #closed-loop-toggle') !== null &&
    document.querySelector('[aria-labelledby="editor-settings-title"] #btn-undo-wp') !== null &&
    document.querySelector('[aria-labelledby="editor-settings-title"] #btn-delete-route') !== null &&
    document.querySelector('[aria-labelledby="editor-settings-title"] #btn-switch-recording') !== null,
}));
if (advancedStructure.headings.join(',') !== 'track-info-title,editor-settings-title' ||
    !advancedStructure.infoContainsStats || !advancedStructure.settingsContainControls) {
  throw new Error(`unexpected advanced structure: ${JSON.stringify(advancedStructure)}`);
}
if (/choose/i.test(layout.helpText)) throw new Error(`choose hint is still visible: ${layout.helpText}`);
if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);

console.log('editor layout smoke passed');
await browser.close();
