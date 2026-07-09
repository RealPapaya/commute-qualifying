// Bootstrap + view routing + routes list + history view.
import { listRoutes, getRoute, deleteRoute, listRuns, deleteRun,
         allTimeBests } from './store.js';
import { initEditor, openRoute, editorInvalidate } from './routeBuilder.js';
import { initRun, openRun, runInvalidate } from './run.js';
import { fmtTime } from './timing.js';
import { cumulativeDistances } from './geo.js';

const $ = id => document.getElementById(id);
let activeRouteId = null;
let runLoadedKey = null;    // routeId:timingVersion currently loaded in the run view
let editorLoadedId = null;  // routeId currently loaded in the editor

function showView(name) {
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('#tabs .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === name));
  if (name === 'editor') { ensureEditorLoaded(); editorInvalidate(); }
  if (name === 'run') { ensureRunLoaded(); runInvalidate(); }
  if (name === 'routes') renderRouteList();
  if (name === 'history') renderHistory();
}

// The editor must always show the active route; reloading discards unsaved
// edits, so only (re)load when the active route actually changed.
function ensureEditorLoaded() {
  const r = activeRouteId ? getRoute(activeRouteId) : null;
  if (!r || editorLoadedId === r.id) return;
  openRoute(structuredClone(r));
  editorLoadedId = r.id;
}

// The run view must always have the active route loaded, but reloading it
// mid-session would wipe a live run — so only (re)load when the route or its
// timingVersion actually changed.
function ensureRunLoaded() {
  const r = activeRouteId ? getRoute(activeRouteId) : null;
  if (!r) return;
  const key = `${r.id}:${r.timingVersion}`;
  if (key !== runLoadedKey) {
    openRun(r);
    runLoadedKey = key;
  }
}

document.querySelectorAll('#tabs .tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    showView(btn.dataset.view);
  });
});

$('btn-new-route').addEventListener('click', () => {
  activeRouteId = null;
  editorLoadedId = null; // editor now holds an unsaved route
  enableTabs(true, false);
  openRoute(null);
  showView('editor');
});

function enableTabs(editor, run) {
  document.querySelector('[data-view="editor"]').disabled = !editor;
  document.querySelector('[data-view="run"]').disabled = !run;
}

function renderRouteList() {
  const routes = listRoutes();
  $('routes-empty').hidden = routes.length > 0;
  $('route-list').innerHTML = routes.map(r => {
    const km = r.points.length > 1 ?
      (cumulativeDistances(r.points).at(-1) / 1000).toFixed(2) : '0.00';
    const best = allTimeBests(r.id, r.sectorBoundaries.length + 1, r.timingVersion);
    return `<li>
      <div>
        <div>${esc(r.name)}</div>
        <div class="meta">${km} km · ${r.sectorBoundaries.length + 1} sectors · ${r.lights.length} 🚦
          · PB ${fmtTime(best.total)}</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-run="${r.id}">Run</button>
        <button class="btn" data-edit="${r.id}">Edit</button>
        <button class="btn danger" data-del="${r.id}">✕</button>
      </div>
    </li>`;
  }).join('');

  $('route-list').querySelectorAll('[data-run]').forEach(b =>
    b.addEventListener('click', () => startRun(b.dataset.run)));
  $('route-list').querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => editRoute(b.dataset.edit)));
  $('route-list').querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => {
      if (!confirm('Delete this route and all its runs?')) return;
      deleteRoute(b.dataset.del);
      if (b.dataset.del === activeRouteId) {
        activeRouteId = null;
        enableTabs(false, false);
      }
      renderRouteList();
    }));
}

function editRoute(id) {
  activeRouteId = id;
  editorLoadedId = null; // force a fresh load
  enableTabs(true, true);
  showView('editor');
}

function startRun(id) {
  activeRouteId = id;
  enableTabs(true, true);
  runLoadedKey = null; // force a fresh load
  showView('run');
}

function renderHistory() {
  const routes = listRoutes();
  const runs = listRuns().slice().reverse();
  $('history-empty').hidden = runs.length > 0;

  // Best board: per-route PBs
  $('best-board').innerHTML = routes.map(r => {
    const best = allTimeBests(r.id, r.sectorBoundaries.length + 1, r.timingVersion);
    if (best.total == null) return '';
    const cells = best.sectors.map((s, i) =>
      `<div class="best-cell"><div class="v">${fmtTime(s)}</div><div class="k">S${i + 1}</div></div>`
    ).join('');
    return `<h3 style="margin:8px 0 6px;font-size:13px">${esc(r.name)}</h3>
      <div class="best-grid">${cells}
        <div class="best-cell"><div class="v">${fmtTime(best.total)}</div><div class="k">Lap</div></div>
      </div>`;
  }).join('');

  $('run-history').innerHTML = runs.map(run => {
    const route = routes.find(r => r.id === run.routeId);
    const d = new Date(run.date);
    const sectors = run.sectorTimes.map((t, i) => `S${i + 1} ${fmtTime(t)}`).join(' · ');
    return `<li>
      <div>
        <div>${esc(route?.name ?? '(deleted route)')} — <strong>${fmtTime(run.totalTime)}</strong>
          ${run.simulated ? '<span class="meta">(sim)</span>' : ''}</div>
        <div class="meta">${d.toLocaleString()} · ${sectors}</div>
      </div>
      <button class="btn danger" data-delrun="${run.id}">✕</button>
    </li>`;
  }).join('');

  $('run-history').querySelectorAll('[data-delrun]').forEach(b =>
    b.addEventListener('click', () => {
      deleteRun(b.dataset.delrun);
      renderHistory();
    }));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

initEditor({
  onSaved(route) {
    activeRouteId = route.id;
    editorLoadedId = route.id; // editor already holds what was just saved
    enableTabs(true, true);
    showView('routes');
  },
});
initRun({
  onRunSaved() { /* history re-renders on tab open */ },
  onReplanRoute(routeId) {
    activeRouteId = routeId;
    editorLoadedId = null;
    enableTabs(true, true);
    showView('editor');
  },
});
renderRouteList();
