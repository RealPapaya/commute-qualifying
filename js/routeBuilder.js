// Route editor: trace waypoints, snap to roads via OSRM (fallback: straight
// lines), mark traffic lights (with Street View link-out), edit sectors.
import { cumulativeDistances } from './geo.js';
import { initSectorTool, renderSectorHandles, defaultBoundaries } from './sectors.js';
import { initRouteDrag } from './routeDrag.js';
import { initLightsImport } from './lightsImport.js';
import { renderTrackDiagram } from './trackDiagram.js';
import { saveRoute, getRoute, newId } from './store.js';
import { addBaseMap } from './baseMap.js';
import { searchPlace, searchPlaces } from './geocode.js';
import { acceptedRecordingPoint } from './gpsRouteRecorder.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

let map, route, activeTool = 'trace';
let routeLine, routeLineCasing, wpMarkers = [], lightMarkers = [];
let onSaved = null;
let buildSeq = 0; // stale-response guard for async OSRM rebuilds
let afterRebuildHandlers = []; // hooks run once the polyline/markers are freshly redrawn
let placeSearchSeq = 0;
let placeSuggestionId = 0;
const selectedPlaces = new WeakMap();
let recordingWatchId = null, recordingMarker = null;
let recordingMode = false, lastRecordingPoint = null;

const MIN_RECORDED_CHECKPOINT_M = 50;

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
  document.getElementById('btn-start-gps-recording').addEventListener('click', startGpsRecording);
  document.getElementById('btn-stop-gps-recording').addEventListener('click', stopGpsRecording);
  document.getElementById('btn-record-checkpoint').addEventListener('click', addRecordedCheckpoint);
  document.getElementById('btn-record-light').addEventListener('click', addRecordedLight);
  setupPlaceAutocomplete(document.getElementById('place-start'));
  setupPlaceAutocomplete(document.getElementById('place-end'));
  document.getElementById('place-route-form').addEventListener('submit', event => {
    event.preventDefault();
    buildRouteFromPlaces();
  });
  document.getElementById('btn-add-via').addEventListener('click', () => addViaInput());
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

export function openRoute(existing, { creationMode = 'plan' } = {}) {
  stopGpsRecording({ quiet: true });
  placeSearchSeq += 1;
  recordingMode = creationMode === 'record' || existing?.recorded === true;
  route = existing ?? {
    id: newId(),
    name: '',
    waypoints: [],
    snap: true,
    points: [],
    lights: [],
    sectorBoundaries: [],
    timingVersion: 1,
    closedLoop: false,
  };
  if (recordingMode && !existing) route.snap = false;
  lastRecordingPoint = route.recorded ? route.points.at(-1) ?? null : null;
  document.getElementById('route-name').value = route.name;
  resetPlaceInputs();
  const snapToggle = document.getElementById('snap-toggle');
  snapToggle.checked = route.snap !== false;
  document.getElementById('closed-loop-toggle').checked = route.closedLoop === true;
  snapToggle.disabled = recordingMode;
  document.getElementById('gps-recording-panel').hidden = !recordingMode;
  document.getElementById('place-route-form').hidden = recordingMode;
  setRecordingStatus(recordingMode ? 'Ready to record.' : '');
  updateRecordingControls();
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

function viaInputs() {
  return [...document.querySelectorAll('#place-via-list .place-input')];
}

function addViaInput(value = '') {
  const row = document.createElement('div');
  row.className = 'place-input-row';

  const label = document.createElement('label');
  label.textContent = '必經點';
  const input = document.createElement('input');
  input.className = 'place-input';
  input.type = 'search';
  input.placeholder = '輸入路名、地址或地標';
  input.autocomplete = 'street-address';
  input.setAttribute('aria-label', '必經地點');
  input.value = value;
  const inputWrap = document.createElement('div');
  inputWrap.className = 'place-input-wrap';
  inputWrap.append(input);
  setupPlaceAutocomplete(input, inputWrap);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn place-remove';
  remove.textContent = '移除';
  remove.addEventListener('click', () => row.remove());

  row.append(label, inputWrap, remove);
  document.getElementById('place-via-list').append(row);
  input.focus();
}

function resetPlaceInputs() {
  const start = document.getElementById('place-start');
  const end = document.getElementById('place-end');
  start.value = '';
  end.value = '';
  selectedPlaces.delete(start);
  selectedPlaces.delete(end);
  document.getElementById('place-via-list').replaceChildren();
  setPlaceStatus('');
  document.getElementById('btn-build-place-route').disabled = false;
}

function setPlaceStatus(message) {
  document.getElementById('place-route-status').textContent = message;
}

function setupPlaceAutocomplete(input, inputWrap = input.parentElement) {
  if (!inputWrap.classList.contains('place-input-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'place-input-wrap';
    input.before(wrap);
    wrap.append(input);
    inputWrap = wrap;
  }

  const suggestions = document.createElement('ul');
  suggestions.className = 'place-suggestions';
  suggestions.id = `place-suggestions-${++placeSuggestionId}`;
  suggestions.setAttribute('role', 'listbox');
  suggestions.setAttribute('aria-label', '地點建議');
  suggestions.hidden = true;
  inputWrap.append(suggestions);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', suggestions.id);

  let searchSeq = 0;
  let timer = null;
  const hide = () => {
    suggestions.replaceChildren();
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };
  const show = places => {
    suggestions.replaceChildren(...places.map(place => {
      const item = document.createElement('li');
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'place-suggestion';
      option.setAttribute('role', 'option');
      option.textContent = place.name;
      option.addEventListener('click', () => {
        input.value = place.name;
        selectedPlaces.set(input, place);
        hide();
      });
      item.append(option);
      return item;
    }));
    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('input', () => {
    selectedPlaces.delete(input);
    clearTimeout(timer);
    hide();
    const query = input.value.trim();
    if (query.length < 2) return;
    const seq = ++searchSeq;
    timer = setTimeout(async () => {
      try {
        const places = await searchPlaces(query);
        if (seq === searchSeq && input.value.trim() === query && places.length) show(places);
      } catch {
        if (seq === searchSeq) hide();
      }
    }, 250);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') hide();
  });
  document.addEventListener('pointerdown', event => {
    if (!inputWrap.contains(event.target)) hide();
  });
}

async function buildRouteFromPlaces() {
  const start = document.getElementById('place-start');
  const end = document.getElementById('place-end');
  const places = [
    { label: '起點', query: start.value.trim(), input: start },
    ...viaInputs().map((input, index) => ({
      label: `必經點 ${index + 1}`, query: input.value.trim(), input,
    })).filter(place => place.query),
    { label: '終點', query: end.value.trim(), input: end },
  ];
  places.forEach(place => { place.selected = selectedPlaces.get(place.input); });
  const missing = places.find(place => !place.query);
  if (missing) {
    setPlaceStatus(`請輸入${missing.label}。`);
    missing.input.focus();
    return;
  }

  const seq = ++placeSearchSeq;
  const button = document.getElementById('btn-build-place-route');
  button.disabled = true;
  try {
    const resolved = [];
    for (const [index, place] of places.entries()) {
      if (index && !place.selected) await new Promise(resolve => setTimeout(resolve, 1100));
      setPlaceStatus(`正在尋找${place.label}（${index + 1}/${places.length}）…`);
      resolved.push(place.selected ?? await searchPlace(place.query));
    }
    if (seq !== placeSearchSeq) return;

    route.waypoints = resolved.map(place => place.point);
    await rebuildGeometry();
    if (route.points.length > 1) {
      map.fitBounds(L.latLngBounds(route.points), { padding: [30, 30] });
    }
    setPlaceStatus(`路線已建立：${resolved.map(place => place.name).join(' → ')}`);
  } catch (error) {
    if (seq === placeSearchSeq) {
      setPlaceStatus(`找不到地點，請嘗試更完整的地址或改用地圖點選。${error.message}`);
    }
  } finally {
    if (seq === placeSearchSeq) button.disabled = false;
  }
}

function setRecordingStatus(message) {
  document.getElementById('gps-recording-status').textContent = message;
}

function updateRecordingControls() {
  const recording = recordingWatchId !== null;
  const start = document.getElementById('btn-start-gps-recording');
  start.hidden = recording;
  start.disabled = recording;
  start.textContent = route?.points?.length ? 'Resume GPS recording' : 'Start GPS recording';
  document.getElementById('btn-stop-gps-recording').hidden = !recording;
  const canMark = recording && lastRecordingPoint !== null;
  document.getElementById('btn-record-checkpoint').disabled = !canMark;
  document.getElementById('btn-record-light').disabled = !canMark;
}

// Start the GPS watch directly in the button handler. iOS Safari requires the
// geolocation request to retain the click's user activation.
function startGpsRecording() {
  if (!window.isSecureContext || !navigator.geolocation) {
    setRecordingStatus('GPS recording needs HTTPS or localhost and location permission.');
    return;
  }
  if (recordingWatchId !== null) return;

  route.snap = false;
  route.recorded = true;
  document.getElementById('snap-toggle').checked = false;
  recordingWatchId = navigator.geolocation.watchPosition(handleRecordingFix, onRecordingGpsError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });
  setRecordingStatus('Recording — waiting for an accurate GPS fix.');
  updateRecordingControls();
}

function handleRecordingFix(position) {
  const accuracy = Math.round(position.coords.accuracy);
  const point = acceptedRecordingPoint(lastRecordingPoint, position.coords);
  if (!point) {
    setRecordingStatus(`Recording — GPS ±${accuracy} m; waiting for a clearer or farther fix.`);
    return;
  }

  route.waypoints.push(point);
  route.points.push(point);
  lastRecordingPoint = point;
  if (!recordingMarker) {
    recordingMarker = L.circleMarker(point, {
      radius: 7, color: '#f7f8f8', weight: 2, fillColor: '#e10600', fillOpacity: 0.96,
      className: 'recording-position-marker',
    }).addTo(map);
  } else {
    recordingMarker.setLatLng(point);
  }
  if (route.points.length === 1) map.setView(point, Math.max(map.getZoom(), 16));
  else map.panTo(point, { animate: false });
  redrawAll({ notifyAfterRebuild: false });
  setRecordingStatus(`Recording — ${route.points.length} GPS points, accuracy ±${accuracy} m.`);
  updateRecordingControls();
}

function onRecordingGpsError(error) {
  stopGpsRecording({ quiet: true });
  const message = error.code === error.PERMISSION_DENIED
    ? 'GPS permission was denied. Enable location access, then try again.'
    : 'GPS is temporarily unavailable. Move to a clearer location, then resume recording.';
  setRecordingStatus(message);
}

function stopGpsRecording({ quiet = false } = {}) {
  const wasRecording = recordingWatchId !== null;
  if (wasRecording) navigator.geolocation.clearWatch(recordingWatchId);
  recordingWatchId = null;
  recordingMarker?.remove();
  recordingMarker = null;
  if (wasRecording && route) redrawAll();
  if (!quiet && recordingMode) {
    setRecordingStatus(`Recording stopped — ${route?.points.length ?? 0} GPS points captured.`);
  }
  if (document.getElementById('btn-start-gps-recording')) updateRecordingControls();
}

function addRecordedCheckpoint() {
  const cum = getCum();
  if (!cum || !lastRecordingPoint) return;
  const distance = cum.at(-1);
  const previous = route.sectorBoundaries.at(-1) ?? 0;
  if (distance - previous < MIN_RECORDED_CHECKPOINT_M) {
    setRecordingStatus(`Drive at least ${MIN_RECORDED_CHECKPOINT_M} m before adding the next checkpoint.`);
    return;
  }
  route.sectorBoundaries.push(distance);
  refreshSectorSummary();
  refreshStats();
  setRecordingStatus(`Checkpoint ${route.sectorBoundaries.length} added at ${(distance / 1000).toFixed(2)} km.`);
}

function addRecordedLight() {
  if (!lastRecordingPoint) return;
  route.lights.push([...lastRecordingPoint]);
  redrawLights();
  refreshStats();
  setRecordingStatus(`Light ${route.lights.length} added at your current recorded position.`);
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
  if (recordingWatchId !== null) return;
  const p = [e.latlng.lat, e.latlng.lng];
  if (activeTool === 'trace') {
    route.recorded = false;
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
  route.recorded = false;
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

function redrawAll({ notifyAfterRebuild = true } = {}) {
  redrawLine();
  redrawWaypoints();
  redrawLights();
  renderSectorHandles(activeTool === 'sector');
  refreshSectorSummary();
  refreshStats();
  if (notifyAfterRebuild) afterRebuildHandlers.forEach(fn => fn());
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
  if (route.recorded) {
    wpMarkers = [];
    return;
  }
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
  if (recordingWatchId !== null) {
    setRecordingStatus('Stop GPS recording before saving the route.');
    return;
  }
  route.name = document.getElementById('route-name').value.trim() || 'Unnamed route';
  route.closedLoop = document.getElementById('closed-loop-toggle').checked;
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
