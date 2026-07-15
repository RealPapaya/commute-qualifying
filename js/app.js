// Bootstrap + view routing + routes list + history view.
import { listRoutes, getRoute, saveRoute, deleteRoute, listRuns, deleteRun,
         allTimeBests } from './store.js';
import { initEditor, openRoute, editorInvalidate, hasUnsavedChanges,
         saveEditor } from './routeBuilder.js';
import { initRun, openRun, runInvalidate } from './run.js';
import { showSummary } from './summary.js';
import { fmtTime } from './timing.js';
import { cumulativeDistances } from './geo.js';
import { translate as t } from './i18n.js';
import { initBottomSheets, collapseBottomSheets } from './bottomSheet.js';
import { initHomeMap } from './homeMap.js';

const $ = id => document.getElementById(id);
let activeRouteId = null;
let lastSummaryRunId = null;
let runLoadedKey = null;    // routeId:timingVersion currently loaded in the run view
let editorLoadedId = null;  // routeId currently loaded in the editor
let homeMapController = null;
let historyRouteId = null;

function showView(name) {
  if (name === 'history') historyRouteId = null;
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('#tabs .tab').forEach(tab =>
    tab.classList.toggle('active', tab.dataset.view === name));
  document.body.classList.toggle('home-active', name === 'home');
  // editor / run drop the black banner: the topbar floats transparently over
  // the map so it fills the screen, leaving just the back button (and, in the
  // editor, the tool switcher) as chips.
  document.body.classList.toggle('chromeless-topbar', name === 'editor' || name === 'run');
  $('btn-back').hidden = name === 'home';
  $('editor-toolbar').hidden = name !== 'editor';
  homeMapController?.setActive(name === 'home');
  collapseBottomSheets();
  if (name === 'editor') { ensureEditorLoaded(); editorInvalidate(); }
  if (name === 'run') { ensureRunLoaded(); runInvalidate(); }
  if (name === 'routes') renderRouteList();
  if (name === 'history') { renderHistory(); showLastSummary(); }
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

// Leaving the editor with unsaved edits routes through a save / discard / cancel
// prompt so a stray tap on ← can't silently drop the work in progress.
$('btn-back').addEventListener('click', () => {
  if (document.querySelector('#view-editor.active') && hasUnsavedChanges()) {
    $('leave-editor-dialog').returnValue = '';
    $('leave-editor-dialog').showModal();
    return;
  }
  showView('home');
});

$('leave-editor-dialog').addEventListener('close', event => {
  const action = event.target.returnValue;
  if (action === 'save') {
    saveEditor(); // navigates to the routes list via onSaved on success
  } else if (action === 'discard') {
    editorLoadedId = null; // drop the in-memory edits; reload from the store next time
    showView('home');
  }
  // 'cancel' / '' (Esc / backdrop) — stay in the editor
});

document.querySelectorAll('#tabs .tab').forEach(button => {
  button.addEventListener('click', () => {
    if (button.disabled) return;
    showView(button.dataset.view);
  });
});

const newRouteOptions = $('new-route-options');
const newRouteName = $('new-route-name');

$('btn-new-route').addEventListener('click', () => {
  const opening = newRouteOptions.hidden;
  newRouteOptions.hidden = !opening;
  $('btn-new-route').setAttribute('aria-expanded', String(opening));
  if (opening) {
    newRouteName.value = '';
    newRouteName.focus();
  }
});

newRouteOptions.addEventListener('submit', event => {
  event.preventDefault();
  createNewRoute(event.submitter?.dataset.newRouteMode ?? 'plan', newRouteName.value.trim());
});

function createNewRoute(creationMode, name) {
  activeRouteId = null;
  editorLoadedId = null; // editor now holds an unsaved route
  enableTabs(true, false);
  newRouteOptions.hidden = true;
  $('btn-new-route').setAttribute('aria-expanded', 'false');
  openRoute(null, { creationMode, name });
  showView('editor');
}

document.addEventListener('languagechange', () => {
  if (document.querySelector('#view-routes.active')) renderRouteList();
  if (document.querySelector('#view-history.active')) renderHistory();
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
        <input class="route-name-input" value="${esc(r.name)}" maxlength="40"
          aria-label="Route name" data-route-name="${r.id}">
        <div class="meta">${km} km · ${r.sectorBoundaries.length + 1} ${t('sectorCount')} · ${r.lights.length} ${t('lightCount')}
          · PB ${fmtTime(best.total)}</div>
      </div>
      <div class="actions">
        <button class="btn primary" data-run="${r.id}">${t('run')}</button>
        <button class="btn" data-edit="${r.id}">${t('edit')}</button>
        <button class="btn danger" data-del="${r.id}">✕</button>
      </div>
    </li>`;
  }).join('');

  $('route-list').querySelectorAll('[data-run]').forEach(b =>
    b.addEventListener('click', () => startRun(b.dataset.run)));
  $('route-list').querySelectorAll('[data-route-name]').forEach(input => {
    const commit = () => {
      const route = getRoute(input.dataset.routeName);
      if (!route) return;
      input.value = input.value.trim() || 'Unnamed route';
      if (input.value === route.name) return;
      route.name = input.value;
      saveRoute(route);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') input.blur();
    });
  });
  $('route-list').querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => editRoute(b.dataset.edit)));
  $('route-list').querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => {
      if (!confirm(t('deleteRouteConfirm'))) return;
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
  const routesById = new Map(routes.map(route => [route.id, route]));
  const groups = new Map();
  runs.forEach(run => {
    if (!groups.has(run.routeId)) groups.set(run.routeId, []);
    groups.get(run.routeId).push(run);
  });
  $('history-empty').hidden = runs.length > 0;

  if (historyRouteId && !groups.has(historyRouteId)) historyRouteId = null;
  const heading = document.querySelector('#view-history .panel-head h2');

  if (!historyRouteId) {
    heading.textContent = t('history');
    $('best-board').innerHTML = '';
    $('run-history').innerHTML = [...groups].map(([routeId, routeRuns]) => {
      const route = routesById.get(routeId);
      const best = route
        ? allTimeBests(route.id, route.sectorBoundaries.length + 1, route.timingVersion)
        : { total: null };
      return `<li class="history-route">
        <button class="history-route-button" data-historyroute="${esc(routeId)}">
          <span>
            <strong>${esc(route?.name ?? t('deletedRoute'))}</strong>
            <span class="meta">${routeRuns.length} ${t('records')} · PB ${fmtTime(best.total)}</span>
          </span>
          <span class="history-route-arrow" aria-hidden="true">›</span>
        </button>
      </li>`;
    }).join('');

    $('run-history').querySelectorAll('[data-historyroute]').forEach(button =>
      button.addEventListener('click', () => {
        historyRouteId = button.dataset.historyroute;
        renderHistory();
      }));
    return;
  }

  const route = routesById.get(historyRouteId);
  const routeRuns = groups.get(historyRouteId);
  heading.textContent = route?.name ?? t('deletedRoute');

  let bestBoard = `<button class="btn history-back" id="history-route-back">← ${t('allTracks')}</button>`;
  if (route) {
    const best = allTimeBests(route.id, route.sectorBoundaries.length + 1, route.timingVersion);
    if (best.total != null) {
      const cells = best.sectors.map((sector, i) =>
        `<div class="best-cell"><div class="v">${fmtTime(sector)}</div><div class="k">S${i + 1}</div></div>`
      ).join('');
      bestBoard += `<div class="best-grid">${cells}
        <div class="best-cell"><div class="v">${fmtTime(best.total)}</div><div class="k">${t('lap')}</div></div>
      </div>`;
    }
  }
  $('best-board').innerHTML = bestBoard;
  $('history-route-back').addEventListener('click', () => {
    historyRouteId = null;
    renderHistory();
  });

  $('run-history').innerHTML = routeRuns.map(run => {
    const d = new Date(run.date);
    const sectors = run.sectorTimes.map((time, i) => `S${i + 1} ${fmtTime(time)}`).join(' · ');
    const summaryButton = route
      ? `<button class="btn primary" data-summaryrun="${run.id}">${t('summary')}</button>`
      : '';
    return `<li>
      <div>
        <div><strong>${fmtTime(run.totalTime)}</strong>
          ${run.simulated ? `<span class="meta">${t('simulated')}</span>` : ''}
          ${run.disqualified ? `<span class="meta meta-dsq">${t('dsq')}</span>` : ''}</div>
        <div class="meta">${d.toLocaleString()} · ${sectors}</div>
      </div>
      <div class="actions">
        ${summaryButton}
        <button class="btn danger" data-delrun="${run.id}">✕</button>
      </div>
    </li>`;
  }).join('');

  $('run-history').querySelectorAll('[data-summaryrun]').forEach(button =>
    button.addEventListener('click', () => showRunSummary(button.dataset.summaryrun)));

  $('run-history').querySelectorAll('[data-delrun]').forEach(button =>
    button.addEventListener('click', () => {
      deleteRun(button.dataset.delrun);
      renderHistory();
    }));
}

function showLastSummary() {
  if (!lastSummaryRunId || !$('summary-overlay')?.hidden) return;
  if (!showRunSummary(lastSummaryRunId)) lastSummaryRunId = null;
}

function showRunSummary(runId) {
  const run = listRuns().find(r => r.id === runId);
  const route = run ? getRoute(run.routeId) : null;
  if (!run || !route) return false;
  showSummary(route, run, listRuns(route.id));
  return true;
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
  onDeleted(route) {
    if (getRoute(route.id)) deleteRoute(route.id);
    activeRouteId = null;
    editorLoadedId = null;
    enableTabs(false, false);
    showView('routes');
  },
});
initRun({
  onRunSaved(record) {
    lastSummaryRunId = record.id;
    /* history re-renders on tab open */
  },
  onRouteContinued(route) {
    activeRouteId = route.id;
    runLoadedKey = `${route.id}:${route.timingVersion}`;
    enableTabs(true, true);
  },
});
initBottomSheets();
homeMapController = initHomeMap();
homeMapController.setActive(true);
renderRouteList();
