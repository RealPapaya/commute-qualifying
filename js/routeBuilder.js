// Route editor: trace waypoints, snap to roads via OSRM (fallback: straight
// lines), mark traffic lights (with Street View link-out), edit sectors.
import { cumulativeDistances, projectOnRoute } from './geo.js';
import { initSectorTool, renderSectorHandles, defaultBoundaries } from './sectors.js';
import { initRouteDrag } from './routeDrag.js';
import { renderTrackDiagram } from './trackDiagram.js';
import { saveRoute, getRoute, newId } from './store.js';
import { addBaseMap } from './baseMap.js';
import { reversePlace, searchPlace, searchPlaces } from './geocode.js';
import { acceptedRecordingPoint } from './gpsRouteRecorder.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

let map, route, activeTool = 'trace';
let routeLine, routeLineCasing, wpMarkers = [], lightMarkers = [], placeMarkers = [];
let onSaved = null;
let buildSeq = 0; // stale-response guard for async OSRM rebuilds
let afterRebuildHandlers = []; // hooks run once the polyline/markers are freshly redrawn
let placeSearchSeq = 0;
let placeSuggestionId = 0;
const selectedPlaces = new WeakMap();
let recordingWatchId = null, recordingMarker = null;
let recordingMode = false, lastRecordingPoint = null;
let pendingPlaceInput = null;

const MIN_RECORDED_CHECKPOINT_M = 50;
const MAX_LIGHT_ROUTE_DISTANCE_M = 30;

const TOOL_HELP = {
  trace: 'Choose 起點, 終點, or 必經點, then search for an address or tap the map.',
  light: 'Click on the map to mark a traffic light. Click a light for Street View / delete.',
  sector: 'Drag the yellow handles along the route to move sector boundaries. Use +/− Sector to add or remove.',
};

export function initEditor(callbacks) {
  onSaved = callbacks.onSaved;
  map = L.map('editor-map', { zoomControl: false }).setView([25.04, 121.53], 13);
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
  document.querySelectorAll('[data-place-role]').forEach(button => {
    button.addEventListener('click', () => beginPlaceSelection(button.dataset.placeRole));
  });
  document.getElementById('place-route-form').addEventListener('submit', event => {
    event.preventDefault();
    buildRouteFromPlaces();
  });
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
}

// Register a callback to run every time redrawAll() has recreated the
// polyline/markers, so other modules can rebind handlers to the fresh layer.
export function onAfterRebuild(fn) {
  afterRebuildHandlers.push(fn);
}

export function openRoute(existing, { creationMode = 'plan' } = {}) {
  stopGpsRecording({ quiet: true });
  placeSearchSeq += 1;
  pendingPlaceInput = null;
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
  remove.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="#icon-trash"></use></svg><span>移除</span>';
  remove.addEventListener('click', () => {
    if (pendingPlaceInput === input) {
      pendingPlaceInput = null;
    }
    row.remove();
    if (!rebuildRouteFromSelectedPlaces()) redrawPlacePins();
    updatePlaceControls();
  });

  const actions = document.createElement('div');
  actions.className = 'place-row-actions';
  actions.append(remove);
  row.append(label, inputWrap, actions);
  document.getElementById('place-via-list').append(row);
  input.focus();
  return input;
}

function beginPlaceSelection(role) {
  const input = role === 'via'
    ? addViaInput()
    : document.getElementById(`place-${role}`);
  input.closest('.place-input-row').hidden = false;
  pendingPlaceInput = input;
  input.focus();
  updatePlaceControls();
  setPlaceStatus(`請輸入${role === 'start' ? '起點' : role === 'end' ? '終點' : '必經點'}地址，或直接點地圖。`);
}

function resetPlaceInputs() {
  clearPlacePins();
  const start = document.getElementById('place-start');
  const end = document.getElementById('place-end');
  start.value = '';
  end.value = '';
  selectedPlaces.delete(start);
  selectedPlaces.delete(end);
  start.closest('.place-input-row').hidden = true;
  end.closest('.place-input-row').hidden = true;
  document.getElementById('place-via-list').replaceChildren();
  pendingPlaceInput = null;
  setPlaceStatus('');
  document.getElementById('btn-build-place-route').disabled = false;
  updatePlaceControls();
}

function updatePlaceControls() {
  const waiting = pendingPlaceInput && !selectedPlaces.has(pendingPlaceInput);
  document.querySelectorAll('[data-place-role]').forEach(button => {
    button.disabled = Boolean(waiting);
    const isPendingRole = button.dataset.placeRole === 'via'
      ? Boolean(pendingPlaceInput?.closest('#place-via-list'))
      : document.getElementById(`place-${button.dataset.placeRole}`) === pendingPlaceInput;
    button.classList.toggle('active', isPendingRole);
  });
  document.getElementById('btn-place-start').classList.toggle(
    'complete', selectedPlaces.has(document.getElementById('place-start')));
  document.getElementById('btn-place-end').classList.toggle(
    'complete', selectedPlaces.has(document.getElementById('place-end')));
}

function setPlaceStatus(message) {
  document.getElementById('place-route-status').textContent = message;
}

function selectedPlaceInputs() {
  return [
    { input: document.getElementById('place-start'), label: '起點', role: 'start' },
    ...viaInputs().map((input, index) => ({
      input, label: `必經點 ${index + 1}`, role: 'via',
    })),
    { input: document.getElementById('place-end'), label: '終點', role: 'end' },
  ];
}

function placeLabel(place) {
  return place.detail ? `${place.name} · ${place.detail}` : place.name;
}

function clearPlacePins() {
  placeMarkers.forEach(marker => marker.remove());
  placeMarkers = [];
}

function waypointIcon(role) {
  if (role === 'via') {
    return L.divIcon({ className: 'wp-marker', iconSize: [12, 12] });
  }
  const svg = role === 'start'
    ? `<svg viewBox="0 0 36 44" aria-hidden="true"><path class="endpoint-pin" d="M18 1C8.6 1 1 8.6 1 18c0 12.4 17 25 17 25s17-12.6 17-25C35 8.6 27.4 1 18 1Z"/><path class="endpoint-symbol" d="m14 11 11 7-11 7Z"/></svg>`
    : `<svg viewBox="0 0 36 44" aria-hidden="true"><path class="endpoint-pin" d="M18 1C8.6 1 1 8.6 1 18c0 12.4 17 25 17 25s17-12.6 17-25C35 8.6 27.4 1 18 1Z"/><path class="endpoint-symbol" d="M12 10h2v17h-2zm2 1h10v10H14zm0 0h5v5h-5zm5 5h5v5h-5z"/></svg>`;
  return L.divIcon({
    className: `route-endpoint-marker route-${role}-marker`,
    html: svg,
    iconSize: [36, 44],
    iconAnchor: [18, 43],
  });
}

function redrawPlacePins(focusPlace = null) {
  clearPlacePins();
  redrawWaypoints();
  selectedPlaceInputs().forEach(({ input, label, role }) => {
    const place = selectedPlaces.get(input);
    const hasRouteMarker = role === 'start'
      ? route.waypoints.length > 0
      : role === 'end' ? route.waypoints.length > 1 : false;
    if (!place || hasRouteMarker) return;
    const marker = L.marker(place.point, {
      draggable: true,
      title: `${label}: ${placeLabel(place)}`,
      alt: `${label}: ${placeLabel(place)}`,
      icon: waypointIcon(role),
      riseOnHover: true,
      zIndexOffset: 1000,
    }).addTo(map);
    marker.on('dragend', () => {
      const point = [marker.getLatLng().lat, marker.getLatLng().lng];
      selectedPlaces.set(input, { ...place, point });
      redrawPlacePins();
    });
    marker.bindTooltip?.(label, { direction: 'top', offset: [0, -32] });
    placeMarkers.push(marker);
  });
  if (!focusPlace) return;
  const zoom = Math.max(map.getZoom?.() ?? 0, 15);
  if (map.flyTo) map.flyTo(focusPlace.point, zoom, { duration: 0.35 });
  else map.setView(focusPlace.point, zoom);
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
      option.textContent = placeLabel(place);
      option.addEventListener('click', () => {
        input.value = placeLabel(place);
        selectedPlaces.set(input, place);
        pendingPlaceInput = null;
        hide();
        applySelectedPlace(input, place);
        updatePlaceControls();
      });
      item.append(option);
      return item;
    }));
    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('input', () => {
    selectedPlaces.delete(input);
    pendingPlaceInput = input;
    redrawPlacePins();
    updatePlaceControls();
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

function applySelectedPlace(input, place) {
  if (!rebuildRouteFromSelectedPlaces()) {
    redrawPlacePins(place);
    return;
  }
  const zoom = Math.max(map.getZoom?.() ?? 0, 15);
  if (map.flyTo) map.flyTo(place.point, zoom, { duration: 0.35 });
  else map.setView(place.point, zoom);
}

function rebuildRouteFromSelectedPlaces() {
  const start = selectedPlaces.get(document.getElementById('place-start'));
  const end = selectedPlaces.get(document.getElementById('place-end'));
  if (!start || !end) {
    return false;
  }
  route.waypoints = [
    start.point,
    ...viaInputs().map(via => selectedPlaces.get(via)?.point).filter(Boolean),
    end.point,
  ];
  route.recorded = false;
  clearPlacePins();
  rebuildGeometry();
  return true;
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
      const resolvedPlace = place.selected ?? await searchPlace(place.query);
      selectedPlaces.set(place.input, resolvedPlace);
      resolved.push(resolvedPlace);
    }
    if (seq !== placeSearchSeq) return;

    route.waypoints = resolved.map(place => place.point);
    pendingPlaceInput = null;
    clearPlacePins();
    await rebuildGeometry();
    if (route.points.length > 1) {
      map.fitBounds(L.latLngBounds(route.points), { padding: [30, 30] });
    }
    setPlaceStatus(`路線已建立：${resolved.map(placeLabel).join(' → ')}`);
    updatePlaceControls();
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
  document.getElementById('place-route-form').hidden = recordingMode || tool !== 'trace';
  document.getElementById('gps-recording-panel').hidden = !recordingMode || tool !== 'trace';
  document.getElementById('sector-summary').hidden = tool !== 'sector';
}

async function onMapClick(e) {
  if (recordingWatchId !== null) return;
  const p = [e.latlng.lat, e.latlng.lng];
  if (activeTool === 'trace') {
    if (pendingPlaceInput) {
      const input = pendingPlaceInput;
      const seq = ++placeSearchSeq;
      setPlaceStatus('正在查詢所選位置的地址…');
      try {
        const place = await reversePlace(p);
        if (seq !== placeSearchSeq || input !== pendingPlaceInput) return;
        input.value = placeLabel(place);
        selectedPlaces.set(input, place);
        pendingPlaceInput = null;
        applySelectedPlace(input, place);
        updatePlaceControls();
        setPlaceStatus(`已選定：${placeLabel(place)}`);
      } catch (error) {
        if (seq === placeSearchSeq) {
          setPlaceStatus(`無法取得這個位置的地址，請再點一次或輸入地址。${error.message}`);
        }
      }
      return;
    }
    flashHelp('請先選擇「起點」、「終點」或「必經點」，再直接點地圖。');
  } else if (activeTool === 'light') {
    const projection = projectLightOnRoute(p);
    if (!projection) {
      flashHelp('Traffic lights must be placed on the route.');
      return;
    }
    route.lights.push(projection.point);
    redrawLights();
    refreshStats();
  }
}

function undoWaypoint() {
  if (route.waypoints.length > 2) route.waypoints.splice(route.waypoints.length - 2, 1);
  else route.waypoints.pop();
  rebuildGeometry();
}

function clearTrace() {
  if (!confirm('Clear the whole trace (waypoints, lights, sectors)?')) return;
  route.recorded = false;
  pendingPlaceInput = null;
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
    const role = i === 0 ? 'start' : i === route.waypoints.length - 1 ? 'end' : 'via';
    const label = role === 'start' ? '起點' : role === 'end' ? '終點' : `必經點 ${i}`;
    const m = L.marker(p, {
      draggable: true,
      title: label,
      alt: label,
      icon: waypointIcon(role),
    }).addTo(map);
    m.on('dragend', () => {
      const point = [m.getLatLng().lat, m.getLatLng().lng];
      route.waypoints[i] = point;
      const input = i === 0
        ? document.getElementById('place-start')
        : i === route.waypoints.length - 1
          ? document.getElementById('place-end')
          : viaInputs()[i - 1];
      const selected = input && selectedPlaces.get(input);
      if (selected) selectedPlaces.set(input, { ...selected, point });
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
  lightMarkers = visibleLights().map(({ point, index }) => {
    const m = L.marker(point, {
      icon: L.divIcon({ className: 'light-icon', html: '🚦', iconSize: [20, 20] }),
    }).addTo(map);
    m.bindPopup(
      `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point[0]},${point[1]}"` +
      ` target="_blank" rel="noopener">Open Street View</a><br>` +
      `<a href="#" data-del-light="${index}">Remove light</a>`);
    m.on('popupopen', ev => {
      ev.popup.getElement().querySelector('[data-del-light]')
        ?.addEventListener('click', e => {
          e.preventDefault();
          route.lights.splice(index, 1);
          redrawLights();
        });
    });
    return m;
  });
}

function projectLightOnRoute(point) {
  const cum = getCum();
  if (!cum) return null;
  const projection = projectOnRoute(point, route.points, cum);
  return projection && projection.offRoute <= MAX_LIGHT_ROUTE_DISTANCE_M ? projection : null;
}

function visibleLights() {
  return route.lights.map((point, index) => ({
    index,
    projection: projectLightOnRoute(point),
  })).filter(light => light.projection).map(light => ({
    index: light.index,
    point: light.projection.point,
  }));
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
    `${total} km · ${visibleLights().length} 🚦 · ${route.sectorBoundaries.length + 1} sectors`;
  document.getElementById('btn-track-diagram').disabled = route.points.length <= 1;
  document.getElementById('btn-clear-lights').disabled = route.lights.length === 0;
  updateClosedLoopControl();
}

function hasMatchingEndpoints() {
  if (route.waypoints.length < 2) return false;
  const start = route.waypoints[0];
  const end = route.waypoints.at(-1);
  return start[0] === end[0] && start[1] === end[1];
}

function updateClosedLoopControl() {
  const toggle = document.getElementById('closed-loop-toggle');
  const canClose = hasMatchingEndpoints();
  toggle.disabled = !canClose;
  toggle.title = canClose ? '' : '起點與終點相同時才可勾選閉環賽道';
  if (!canClose) toggle.checked = false;
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
  route.lights = visibleLights().map(light => light.point);
  route.closedLoop = hasMatchingEndpoints() &&
    document.getElementById('closed-loop-toggle').checked;
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
