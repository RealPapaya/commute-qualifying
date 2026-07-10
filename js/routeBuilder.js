// Route editor: trace waypoints, snap to roads via OSRM (fallback: straight
// lines), mark traffic lights (with Street View link-out), edit sectors.
import { cumulativeDistances } from './geo.js';
import { initSectorTool, renderSectorHandles, defaultBoundaries } from './sectors.js';
import { initRouteDrag } from './routeDrag.js';
import { initLightsImport } from './lightsImport.js';
import { renderTrackDiagram } from './trackDiagram.js';
import { saveRoute, getRoute, newId } from './store.js';
import { addBaseMap } from './baseMap.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

let map, route, activeTool = 'trace';
let routeLine, routeLineCasing, wpMarkers = [], lightMarkers = [];
let onSaved = null;
let buildSeq = 0; // stale-response guard for async OSRM rebuilds
let afterRebuildHandlers = []; // hooks run once the polyline/markers are freshly redrawn

const TOOL_HELP = {
  trace: 'Click the map to add waypoints along your commute. Drag a point to move it, double-click a point to delete it.',
  light: 'Click on the map to mark a traffic light. Click a light for Street View / delete.',
  sector: 'Drag the yellow handles along the route to move sector boundaries. Use +/− Sector to add or remove.',
};

export function initEditor(callbacks) {
  onSaved = callbacks.onSaved;
  map = L.map('editor-map').setView([25.04, 121.53], 13);
  window._editorMap = map; // test hook (e2e driver)
  addBaseMap(map);

  map.on('click', onMapClick);

  document.querySelectorAll('#editor-toolbar .tool').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });
  document.getElementById('snap-toggle').addEventListener('change', rebuildGeometry);
  document.getElementById('btn-undo-wp').addEventListener('click', undoWaypoint);
  document.getElementById('btn-clear-route').addEventListener('click', clearTrace);
  document.getElementById('btn-clear-lights').addEventListener('click', clearLights);
  document.getElementById('btn-save-route').addEventListener('click', persist);
  document.getElementById('btn-add-sector').addEventListener('click', () => changeSectorCount(+1));
  document.getElementById('btn-remove-sector').addEventListener('click', () => changeSectorCount(-1));
  document.getElementById('btn-track-diagram').addEventListener('click', showTrackDiagram);
  document.getElementById('btn-diagram-back').addEventListener('click', hideTrackDiagram);
  document.getElementById('diagram-filter-sector-colors').addEventListener('change', refreshTrackDiagram);
  document.getElementById('diagram-filter-checkpoints').addEventListener('change', refreshTrackDiagram);
  document.getElementById('diagram-filter-lights').addEventListener('change', refreshTrackDiagram);

  initSectorTool(map, () => route, refreshSectorSummary);
  initRouteDrag({
    map,
    getRoute: () => route,
    getPolyline: () => routeLine,
    rebuild: rebuildGeometry,
    onAfterRebuild,
  });
  initLightsImport({
    getRoute: () => route,
    onImported: () => {
      redrawLights();
      refreshStats();
    },
    onAfterRebuild,
  });
}

// Register a callback to run every time redrawAll() has recreated the
// polyline/markers, so other modules can rebind handlers to the fresh layer.
export function onAfterRebuild(fn) {
  afterRebuildHandlers.push(fn);
}

export function openRoute(existing) {
  route = existing ?? {
    id: newId(),
    name: '',
    waypoints: [],
    snap: true,
    points: [],
    lights: [],
    sectorBoundaries: [],
    timingVersion: 1,
  };
  document.getElementById('route-name').value = route.name;
  document.getElementById('snap-toggle').checked = route.snap !== false;
  setTool('trace');
  hideTrackDiagram();
  redrawAll();
  setTimeout(() => {
    map.invalidateSize(); // container may have been hidden — fix size before fitting
    if (route.points.length > 1) {
      map.fitBounds(L.latLngBounds(route.points), { padding: [30, 30] });
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => map.setView([p.coords.latitude, p.coords.longitude], 15),
        () => {});
    }
  }, 50);
}

function flashHelp(msg) {
  const el = document.getElementById('tool-help');
  el.textContent = msg;
  setTimeout(() => { el.textContent = TOOL_HELP[activeTool]; }, 4000);
}

function setTool(tool) {
  activeTool = TOOL_HELP[tool] ? tool : 'trace';
  document.querySelectorAll('#editor-toolbar .tool').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === activeTool));
  document.getElementById('tool-help').textContent = TOOL_HELP[activeTool];
  renderSectorHandles(activeTool === 'sector');
  updateToolActions(activeTool);
}

function updateToolActions(tool) {
  document.querySelectorAll('[data-tool-actions]').forEach(group => {
    group.hidden = group.dataset.toolActions !== tool;
  });
}

function onMapClick(e) {
  const p = [e.latlng.lat, e.latlng.lng];
  if (activeTool === 'trace') {
    route.waypoints.push(p);
    rebuildGeometry();
  } else if (activeTool === 'light') {
    route.lights.push(p);
    redrawLights();
    refreshStats();
  }
}

function undoWaypoint() {
  route.waypoints.pop();
  rebuildGeometry();
}

function clearTrace() {
  if (!confirm('Clear the whole trace (waypoints, lights, sectors)?')) return;
  route.waypoints = [];
  route.lights = [];
  route.sectorBoundaries = [];
  rebuildGeometry();
}

function clearLights() {
  if (!route?.lights.length) return;
  if (!confirm('Clear all traffic lights?')) return;
  route.lights = [];
  redrawLights();
  refreshStats();
}

// Rebuild route.points from waypoints (OSRM snap or straight lines), then
// re-space sector boundaries proportionally and redraw.
async function rebuildGeometry() {
  const seq = ++buildSeq;
  route.snap = document.getElementById('snap-toggle').checked;
  const wps = route.waypoints;
  let points = [...wps];

  if (route.snap && wps.length >= 2) {
    try {
      const coords = wps.map(p => `${p[1]},${p[0]}`).join(';');
      const res = await fetch(`${OSRM}${coords}?overview=full&geometries=geojson`,
        { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      if (data.code === 'Ok' && data.routes?.[0]) {
        points = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      } else {
        flashHelp('Road snapping failed — using straight lines.');
      }
    } catch {
      flashHelp('Road snapping unavailable — using straight lines.');
    }
  }
  if (seq !== buildSeq) return; // a newer rebuild superseded this one

  const oldTotal = route.points.length > 1 ?
    cumulativeDistances(route.points).at(-1) : 0;
  route.points = points;
  const cum = points.length > 1 ? cumulativeDistances(points) : [0];
  const total = cum.at(-1);

  // keep boundary positions proportional when geometry changes
  if (total > 0) {
    if (route.sectorBoundaries.length && oldTotal > 0) {
      route.sectorBoundaries = route.sectorBoundaries.map(d => d / oldTotal * total);
    } else {
      route.sectorBoundaries = defaultBoundaries(total, 3);
    }
  } else {
    route.sectorBoundaries = [];
  }
  redrawAll();
}

function changeSectorCount(delta) {
  const cum = getCum();
  if (!cum) return;
  const total = cum.at(-1);
  const n = route.sectorBoundaries.length + 1 + delta;
  if (n < 1 || n > 10) return;
  route.sectorBoundaries = defaultBoundaries(total, n);
  redrawAll();
}

function getCum() {
  return route.points.length > 1 ? cumulativeDistances(route.points) : null;
}

function redrawAll() {
  redrawLine();
  redrawWaypoints();
  redrawLights();
  renderSectorHandles(activeTool === 'sector');
  refreshSectorSummary();
  refreshStats();
  afterRebuildHandlers.forEach(fn => fn());
}

function redrawLine() {
  if (routeLineCasing) routeLineCasing.remove();
  if (routeLine) routeLine.remove();
  routeLineCasing = null;
  routeLine = null;
  if (route.points.length > 1) {
    routeLineCasing = L.polyline(route.points, {
      color: '#dce6de', weight: 11, opacity: 0.9, interactive: false,
      className: 'route-line-casing',
    }).addTo(map);
    routeLine = L.polyline(route.points, {
      color: '#237443', weight: 8, opacity: 1,
      className: 'route-line-core route-line-editor',
    }).addTo(map);
  }
}

function redrawWaypoints() {
  wpMarkers.forEach(m => m.remove());
  wpMarkers = route.waypoints.map((p, i) => {
    const m = L.marker(p, {
      draggable: true,
      icon: L.divIcon({ className: 'wp-marker', iconSize: [12, 12] }),
    }).addTo(map);
    m.on('dragend', () => {
      route.waypoints[i] = [m.getLatLng().lat, m.getLatLng().lng];
      rebuildGeometry();
    });
    m.on('dblclick', () => {
      route.waypoints.splice(i, 1);
      rebuildGeometry();
    });
    return m;
  });
}

function redrawLights() {
  lightMarkers.forEach(m => m.remove());
  lightMarkers = route.lights.map((p, i) => {
    const m = L.marker(p, {
      icon: L.divIcon({ className: 'light-icon', html: '🚦', iconSize: [20, 20] }),
    }).addTo(map);
    m.bindPopup(
      `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p[0]},${p[1]}"` +
      ` target="_blank" rel="noopener">Open Street View</a><br>` +
      `<a href="#" data-del-light="${i}">Remove light</a>`);
    m.on('popupopen', ev => {
      ev.popup.getElement().querySelector('[data-del-light]')
        ?.addEventListener('click', e => {
          e.preventDefault();
          route.lights.splice(i, 1);
          redrawLights();
        });
    });
    return m;
  });
}

function refreshSectorSummary() {
  const el = document.getElementById('sector-summary');
  const cum = getCum();
  if (!cum) { el.innerHTML = ''; return; }
  const total = cum.at(-1);
  const ends = [...route.sectorBoundaries, total];
  let prev = 0;
  el.innerHTML = ends.map((d, i) => {
    const len = ((d - prev) / 1000).toFixed(2);
    prev = d;
    return `<span class="chip">S${i + 1}: ${len} km</span>`;
  }).join('');
}

function refreshStats() {
  const cum = getCum();
  const total = cum ? (cum.at(-1) / 1000).toFixed(2) : '0.00';
  document.getElementById('route-stats').textContent =
    `${total} km · ${route.lights.length} 🚦 · ${route.sectorBoundaries.length + 1} sectors`;
  document.getElementById('btn-track-diagram').disabled = route.points.length <= 1;
  document.getElementById('btn-clear-lights').disabled = route.lights.length === 0;
}

// Diagram mode renders the current in-memory route as a clean circuit view.
// Filters re-render the SVG without disturbing the editor state underneath.
function showTrackDiagram() {
  if (!route || route.points.length < 2) return;
  resetTrackDiagramFilters();
  // Unhide first: the diagram sizes its viewBox from the container, which has
  // no box while [hidden].
  document.getElementById('track-diagram-overlay').hidden = false;
  document.getElementById('view-editor').classList.add('diagram-mode');
  refreshTrackDiagram();
}

function hideTrackDiagram() {
  document.getElementById('track-diagram-overlay').hidden = true;
  document.getElementById('view-editor').classList.remove('diagram-mode');
}

function resetTrackDiagramFilters() {
  document.getElementById('diagram-filter-sector-colors').checked = true;
  document.getElementById('diagram-filter-checkpoints').checked = true;
  document.getElementById('diagram-filter-lights').checked = false;
}

function refreshTrackDiagram() {
  if (!route || route.points.length < 2) return;
  renderTrackDiagram(document.getElementById('track-diagram-svg'), route, {
    showSectorColors: document.getElementById('diagram-filter-sector-colors').checked,
    showSectorCheckpoints: document.getElementById('diagram-filter-checkpoints').checked,
    showLights: document.getElementById('diagram-filter-lights').checked,
  });
}

function persist() {
  route.name = document.getElementById('route-name').value.trim() || 'Unnamed route';
  if (route.points.length < 2) {
    alert('Trace at least two points before saving.');
    return;
  }
  // bump timingVersion if geometry or boundaries changed vs the saved copy
  const prev = getRoute(route.id);
  if (prev && (JSON.stringify(prev.points) !== JSON.stringify(route.points) ||
      JSON.stringify(prev.sectorBoundaries) !== JSON.stringify(route.sectorBoundaries))) {
    route.timingVersion = (prev.timingVersion ?? 1) + 1;
  }
  saveRoute(route);
  onSaved?.(route);
}

export function editorInvalidate() {
  map?.invalidateSize();
}
