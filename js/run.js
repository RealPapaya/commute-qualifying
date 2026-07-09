// Live run: GPS session (or simulator) feeding the pure timing engine,
// wake lock, and the F1-style sector board.
import { cumulativeDistances, pointAtDistance, haversine, projectOnRoute } from './geo.js';
import { createRun, feedFix, elapsed, classifySector, fmtTime, fmtDelta,
         MAX_ACCURACY_M, OFF_ROUTE_M } from './timing.js';
import { allTimeBests, saveRun, newId, listRuns } from './store.js';
import { renderTrackDiagram } from './trackDiagram.js';
import { initSummary, showSummary } from './summary.js';

let map, routeLayer = null, posMarker = null;
let route = null;          // active route (with points/cum attached)
let run = null;            // engine state
let bests = null;          // { sectors, total } all-time (purple reference)
let sessionBests = null;   // per-sector session bests (green reference)
let watchId = null, wakeLock = null, simTimer = null;
let clockTimer = null;
let simNow = null;         // simulated clock when replaying
let simClockAnchorTime = 0;
let simClockAnchorReal = null;
let onRunSaved = null, onReplanRoute = null;
let cursorType = 'dot';
let cursorLatLng = null;
let cursorHeading = 0;
let mapMode = 'street';
let trackCursorDistance = null;
let offRouteFlagActive = false;
let offRoutePromptDismissed = false;
let followUser = false;
let trackFollowZoom = 2.4;

const $ = id => document.getElementById(id);
const CURSOR_TYPES = new Set(['dot', 'car', 'racecar', 'motorcycle']);
const MAP_MODES = new Set(['street', 'track']);
const SIM_FIX_INTERVAL_MS = 100;
const SIM_SPEEDUP = 10;
const CLOCK_REFRESH_MS = 16;
const BOARD_REFRESH_MS = 100;
const CURSOR_TURN_THRESHOLD_M = 3;
const DEFAULT_FOLLOW_ZOOM = 18;
const TRACK_FOLLOW_ZOOM_MIN = 1;
const TRACK_FOLLOW_ZOOM_MAX = 5;
const TRACK_FOLLOW_ZOOM_STEP = 0.35;
const VEHICLE_MODELS = {
  car: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <defs><linearGradient id="car-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ee7ff"/><stop offset="0.55" stop-color="#1976d2"/><stop offset="1" stop-color="#063f82"/></linearGradient></defs>
    <ellipse cx="24" cy="39" rx="15" ry="4" fill="rgba(0,0,0,.38)"/>
    <path d="M17 33 L14 20 L19 10 H29 L34 20 L31 33 Z" fill="url(#car-body)" stroke="#061423" stroke-width="1.6"/>
    <path d="M19 19 L21 12 H27 L29 19 Z" fill="#b8ecff" opacity=".9"/>
    <path d="M17 24 H31" stroke="#d9f7ff" stroke-width="1.5" opacity=".65"/>
    <circle cx="16" cy="31" r="3" fill="#111"/><circle cx="32" cy="31" r="3" fill="#111"/>
    <circle cx="19" cy="13" r="1.7" fill="#fff7a8"/><circle cx="29" cy="13" r="1.7" fill="#fff7a8"/>
  </svg>`,
  racecar: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <defs><linearGradient id="race-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a80"/><stop offset="0.45" stop-color="#e10600"/><stop offset="1" stop-color="#6d0500"/></linearGradient></defs>
    <ellipse cx="24" cy="39" rx="17" ry="4" fill="rgba(0,0,0,.42)"/>
    <path d="M24 7 L33 21 L30 34 H18 L15 21 Z" fill="url(#race-body)" stroke="#190000" stroke-width="1.6"/>
    <path d="M20 23 L24 12 L28 23 Z" fill="#20242e" opacity=".95"/>
    <path d="M18 28 H30" stroke="#fff" stroke-width="2" opacity=".85"/>
    <path d="M14 34 H34" stroke="#111" stroke-width="3" stroke-linecap="round"/>
    <circle cx="17" cy="32" r="2.8" fill="#111"/><circle cx="31" cy="32" r="2.8" fill="#111"/>
    <circle cx="21" cy="15" r="1.6" fill="#fff3a0"/><circle cx="27" cy="15" r="1.6" fill="#fff3a0"/>
  </svg>`,
  motorcycle: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <ellipse cx="24" cy="39" rx="16" ry="4" fill="rgba(0,0,0,.36)"/>
    <circle cx="15" cy="31" r="6" fill="#111"/><circle cx="33" cy="31" r="6" fill="#111"/>
    <circle cx="15" cy="31" r="3.5" fill="#3b3f4a"/><circle cx="33" cy="31" r="3.5" fill="#3b3f4a"/>
    <path d="M18 29 L23 17 L30 29 Z" fill="#ffd600" stroke="#221d00" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M23 17 L28 12 M29 14 L35 18" stroke="#eceff1" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M20 20 L16 14" stroke="#00c853" stroke-width="3" stroke-linecap="round"/>
    <circle cx="16" cy="13" r="3" fill="#10131a"/>
  </svg>`,
};

export function initRun(callbacks) {
  onRunSaved = callbacks.onRunSaved;
  onReplanRoute = callbacks.onReplanRoute;
  map = L.map('run-map').setView([25.04, 121.53], 13);
  window._runMap = map; // test hook (e2e driver)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  $('btn-arm').addEventListener('click', armGps);
  $('btn-abort').addEventListener('click', () => stopSession('Aborted.'));
  $('btn-replan-route').addEventListener('click', replanRoute);
  $('btn-wait-track').addEventListener('click', waitForTrack);
  $('btn-simulate').addEventListener('click', simulate);
  $('btn-follow-user').addEventListener('click', toggleFollowUser);
  $('btn-follow-zoom-out').addEventListener('click', () => zoomFollow(-1));
  $('btn-follow-zoom-in').addEventListener('click', () => zoomFollow(1));
  $('run-map-mode').addEventListener('change', () => setMapMode(selectedMapMode(), { resetFilters: true }));
  $('btn-run-diagram-back').addEventListener('click', hideTrackDiagram);
  $('run-diagram-filter-sector-colors').addEventListener('change', refreshTrackDiagram);
  $('run-diagram-filter-checkpoints').addEventListener('change', refreshTrackDiagram);
  $('run-diagram-filter-lights').addEventListener('change', refreshTrackDiagram);
  $('run-cursor-type').addEventListener('change', () => setCursorType(selectedCursorType()));
  cursorType = selectedCursorType();
  sessionBests = [];
  initSummary();
}

export function openRun(r) {
  stopSession();
  route = { ...r, cum: cumulativeDistances(r.points) };
  trackCursorDistance = null;
  resetOffRouteFlag();
  setMapMode(selectedMapMode(), { resetFilters: true });
  bests = allTimeBests(route.id, route.sectorBoundaries.length + 1, route.timingVersion);
  sessionBests = route.sectorBoundaries.map(() => null).concat([null]);

  if (routeLayer) routeLayer.remove();
  routeLayer = L.layerGroup().addTo(map);
  L.polyline(route.points, { color: '#e10600', weight: 4 }).addTo(routeLayer);
  route.sectorBoundaries.forEach(d => {
    L.circleMarker(pointAtDistance(route.points, route.cum, d),
      { radius: 6, color: '#ffd600', fillOpacity: 0.9 }).addTo(routeLayer);
  });
  route.lights.forEach(p => {
    L.marker(p, { icon: L.divIcon({ className: 'light-icon', html: '🚦', iconSize: [20, 20] }) })
      .addTo(routeLayer);
  });
  // container may have been hidden until this tab was shown: fix the size
  // first, then fit — fitBounds on a 0×0 map picks a useless zoom
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(route.points), { padding: [30, 30] });
  }, 50);

  setStatus('Press ARM, then drive. Timing starts when you cross the start line.', '');
  $('run-clock').textContent = fmtTime(null);
  renderBoard();
}

function hideTrackDiagram() {
  setMapMode('street');
}

function selectedMapMode() {
  const value = $('run-map-mode')?.value ?? 'street';
  return MAP_MODES.has(value) ? value : 'street';
}

function setMapMode(mode, { resetFilters = false } = {}) {
  const requested = MAP_MODES.has(mode) ? mode : 'street';
  const nextMode = requested === 'track' && route?.points?.length >= 2 ? 'track' : 'street';
  mapMode = nextMode;

  const picker = $('run-map-mode');
  if (picker && picker.value !== mapMode) picker.value = mapMode;

  // Unhide before rendering: the diagram sizes its viewBox from the container,
  // which has no box while [hidden].
  $('run-track-diagram-overlay').hidden = mapMode !== 'track';
  $('run-map').classList.toggle('track-mode', mapMode === 'track');

  if (mapMode === 'track') {
    if (resetFilters) resetTrackDiagramFilters();
    refreshTrackDiagram();
  }

  if (mapMode === 'street') setTimeout(() => {
    map?.invalidateSize();
    if (followUser && cursorLatLng) followCurrentPosition(cursorLatLng);
  }, 0);
}

function resetTrackDiagramFilters() {
  $('run-diagram-filter-sector-colors').checked = true;
  $('run-diagram-filter-checkpoints').checked = true;
  $('run-diagram-filter-lights').checked = false;
}

function refreshTrackDiagram() {
  if (!route || route.points.length < 2) return;
  renderTrackDiagram($('run-track-diagram-svg'), route, {
    showSectorColors: $('run-diagram-filter-sector-colors').checked,
    showSectorCheckpoints: $('run-diagram-filter-checkpoints').checked,
    showLights: $('run-diagram-filter-lights').checked,
    currentDistance: trackCursorDistance,
    focusDistance: followUser ? trackCursorDistance : null,
    focusZoom: trackFollowZoom,
  });
}

function selectedCursorType() {
  const value = $('run-cursor-type')?.value ?? 'dot';
  return CURSOR_TYPES.has(value) ? value : 'dot';
}

function setCursorType(type) {
  cursorType = CURSOR_TYPES.has(type) ? type : 'dot';
  if (!posMarker || !cursorLatLng) return;
  posMarker.remove();
  posMarker = null;
  drawCursor(cursorLatLng, cursorHeading);
}

function showCursor(latLng) {
  const nextHeading = cursorLatLng && haversine(cursorLatLng, latLng) >= CURSOR_TURN_THRESHOLD_M ?
    bearing(cursorLatLng, latLng) : cursorHeading;
  cursorLatLng = latLng;
  cursorHeading = nextHeading;
  if (selectedCursorType() !== cursorType) setCursorType(selectedCursorType());
  drawCursor(latLng, nextHeading);
  followCurrentPosition(latLng);
}

function drawCursor(latLng, heading) {
  if (!posMarker) {
    posMarker = createCursorMarker(latLng, heading);
  } else {
    posMarker.setLatLng(latLng);
    updateCursorHeading(heading);
  }
}

function createCursorMarker(latLng, heading) {
  if (cursorType === 'dot') {
    return L.circleMarker(latLng,
      { radius: 8, color: '#00c853', fillColor: '#00c853', fillOpacity: 0.9 }).addTo(map);
  }
  return L.marker(latLng, {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({
      className: 'run-cursor-icon',
      html: vehicleHtml(cursorType, heading),
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    }),
  }).addTo(map);
}

function updateCursorHeading(heading) {
  posMarker?.getElement?.()
    ?.querySelector('.run-cursor-model')
    ?.style.setProperty('--heading', `${heading}deg`);
}

function vehicleHtml(type, heading) {
  return `<div class="run-cursor-model run-cursor-${type}" style="--heading:${heading}deg">${VEHICLE_MODELS[type]}</div>`;
}

function toggleFollowUser() {
  setFollowUser(!followUser);
  if (followUser && !cursorLatLng) {
    $('gps-info').textContent = '跟隨模式已開啟，等待下一個定位。';
  }
}

function setFollowUser(enabled, { pan = true } = {}) {
  followUser = enabled;
  const button = $('btn-follow-user');
  button.classList.toggle('active', followUser);
  button.setAttribute('aria-pressed', String(followUser));
  button.textContent = followUser ? '⌖ 跟隨中' : '⌖ 跟隨';
  button.title = followUser ? '停止跟隨位置' : '放大並跟隨位置';
  updateFollowControls();
  if (followUser && pan && cursorLatLng) followCurrentPosition(cursorLatLng, { zoomOnEnable: true });
  if (mapMode === 'track') refreshTrackDiagram();
}

function updateFollowControls() {
  $('btn-follow-zoom-out').disabled = !followUser;
  $('btn-follow-zoom-in').disabled = !followUser;
}

function zoomFollow(direction) {
  if (!followUser) return;
  if (mapMode === 'street') {
    map.setZoom(map.getZoom() + direction, { animate: false });
    if (cursorLatLng) followCurrentPosition(cursorLatLng);
    return;
  }
  trackFollowZoom = Math.max(TRACK_FOLLOW_ZOOM_MIN,
    Math.min(TRACK_FOLLOW_ZOOM_MAX, trackFollowZoom + direction * TRACK_FOLLOW_ZOOM_STEP));
  refreshTrackDiagram();
}

function followCurrentPosition(latLng, { zoomOnEnable = false } = {}) {
  if (!followUser || mapMode !== 'street') return;
  const zoom = zoomOnEnable ? Math.max(map.getZoom(), DEFAULT_FOLLOW_ZOOM) : map.getZoom();
  map.setView(latLng, zoom, { animate: false });
}

function bearing(from, to) {
  const lat1 = from[0] * Math.PI / 180;
  const lat2 = to[0] * Math.PI / 180;
  const dLng = (to[1] - from[1]) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ---------- GPS session ----------

function armGps() {
  if (!window.isSecureContext || !navigator.geolocation) {
    setStatus('此頁面不是安全來源，瀏覽器不提供 GPS。請改用 https:// 或 localhost 開啟。', '');
    return;
  }
  run = createRun(route);
  setStatus('ARMED — waiting for GPS fix near the start line…', 'armed');
  $('btn-arm').disabled = true;
  $('btn-abort').hidden = false;
  renderBoard();

  // Must run while the click's user activation is still live: iOS Safari fails
  // a geolocation request made after an await with PERMISSION_DENIED, silently
  // and even when the origin was already granted. Wake lock is requested after.
  watchId = navigator.geolocation.watchPosition(pos => {
    const acc = pos.coords.accuracy;
    $('gps-info').textContent =
      `GPS accuracy: ±${Math.round(acc)} m ${acc > MAX_ACCURACY_M ? '(too poor — fix ignored)' : ''}`;
    if (acc > MAX_ACCURACY_M) return;
    handleFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, t: pos.timestamp });
  }, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });

  startClock(() => Date.now());
  requestWakeLock();
}

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    wakeLock?.addEventListener('release', () => { wakeLock = null; });
  } catch { /* wake lock unsupported — screen may sleep */ }
}

// Only PERMISSION_DENIED ends the watch; the other two are transient (tunnel,
// cold start indoors) and fixes resume on their own, so the session stays live.
function onGpsError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    setStatus('GPS 權限被拒。若網頁上已按過允許，請檢查系統的定位權限：' +
      'iOS → 設定 → 隱私權與安全性 → 定位服務 → Safari；' +
      'Android → 設定 → 應用程式 → Chrome → 權限 → 位置。', '');
    stopSession();
    return;
  }
  const why = err.code === err.TIMEOUT
    ? '收不到定位（隧道或室內？）'
    : '定位暫時無法取得';
  // Mid-lap, park the notice in gps-info: the next good fix overwrites it, so
  // it clears itself. Touching the status line would bury LIVE until the next
  // sector boundary rewrites it.
  if (run?.state === 'running') $('gps-info').textContent = `${why} — 等待 GPS 回復…`;
  else setStatus(`${why} — 仍在等待 GPS。`, 'armed');
}

// ---------- Simulator ----------

function simulate() {
  stopSession();
  run = createRun(route);
  setStatus('SIMULATING — replaying a synthetic drive at 10× speed.', 'armed');
  $('btn-arm').disabled = true;
  $('btn-abort').hidden = false;
  renderBoard();

  // Synthetic drive: ~13 m/s average, per-fix speed noise, small position
  // jitter, 1 Hz fixes, replayed at 10× real time.
  const total = route.cum.at(-1);
  let simDist = -10;               // start slightly before the line
  let t = 0;
  setSimClock(0);
  simTimer = setInterval(() => {
    const speed = 9 + Math.random() * 8;   // m/s
    simDist += speed;
    t += SIM_FIX_INTERVAL_MS * SIM_SPEEDUP;
    setSimClock(t);
    const p = pointAtDistance(route.points, route.cum, Math.max(0, simDist));
    const jitter = () => (Math.random() - 0.5) * 0.00008; // ~±5 m
    handleFix({ lat: p[0] + jitter(), lng: p[1] + jitter(), t });
    if (simDist > total + 30 || run?.state === 'finished') {
      if (run && run.state !== 'finished') stopSession('Simulation ended.');
    }
  }, SIM_FIX_INTERVAL_MS);

  startClock(simulatedNow);
}

function setSimClock(timeMs) {
  simNow = timeMs;
  simClockAnchorTime = timeMs;
  simClockAnchorReal = performance.now();
}

function simulatedNow() {
  if (simClockAnchorReal == null) return simNow ?? 0;
  return simClockAnchorTime + (performance.now() - simClockAnchorReal) * SIM_SPEEDUP;
}

// ---------- Shared session plumbing ----------

function updateTrackCursor() {
  if (!run?.lastFix) return;
  trackCursorDistance = run.state === 'finished' ? route.cum.at(-1) : run.maxProgress;
  if (mapMode === 'track') refreshTrackDiagram();
}

function showOffRouteFlag() {
  offRouteFlagActive = true;
  setStatus('YELLOW FLAG — off route. Timing is holding at the last valid trace position.', 'yellow');
  if (!offRoutePromptDismissed) $('offroute-flag').hidden = false;
}

function waitForTrack() {
  offRoutePromptDismissed = true;
  $('offroute-flag').hidden = true;
  setStatus('YELLOW FLAG — waiting until GPS returns to the trace.', 'yellow');
}

function replanRoute() {
  const routeId = route?.id;
  resetOffRouteFlag();
  stopSession('Replanning route.');
  if (routeId) onReplanRoute?.(routeId);
}

function clearOffRouteFlag() {
  const wasOffRoute = offRouteFlagActive;
  resetOffRouteFlag();
  if (wasOffRoute && run?.state === 'running') setStatus('LIVE — back on route.', 'live');
}

function resetOffRouteFlag() {
  offRouteFlagActive = false;
  offRoutePromptDismissed = false;
  const el = $('offroute-flag');
  if (el) el.hidden = true;
}

// Reached only while still armed, i.e. timing.js has already declined to launch.
// Two reasons it declines, and the driver can act on each: too far along the
// route to be at the start, or not on the route at all (parallel street).
function showDistanceToStart(fix) {
  const d = fmtDistance(haversine([fix.lat, fix.lng], route.points[0]));
  const proj = projectOnRoute([fix.lat, fix.lng], route.points, route.cum);
  setStatus(proj && proj.offRoute <= OFF_ROUTE_M
    ? `ARMED — 距離起點 ${d}，跨過起點自動開始計時`
    : `ARMED — 尚未在路線上（距離起點 ${d}）`, 'armed');
}

function fmtDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function handleFix(fix) {
  if (!run) return;
  const ev = feedFix(run, fix);

  showCursor([fix.lat, fix.lng]);
  updateTrackCursor();

  if (ev === 'offroute') {
    showOffRouteFlag();
    return;
  }
  if (offRouteFlagActive) clearOffRouteFlag();

  // Still armed: say how far the start line is, so "waiting" is distinguishable
  // from "GPS is broken". The simulator drives its own status line.
  if (run.state === 'armed' && simTimer == null) showDistanceToStart(fix);

  if (ev === 'start') setStatus('LIVE — lap running.', 'live');
  if (ev === 'sector') { setStatus('LIVE — lap running.', 'live'); renderBoard(); }
  if (ev === 'finish') finishRun();
  if (ev === 'start') renderBoard();
}

function finishRun() {
  const totalTime = run.crossings.at(-1) - run.startTime;
  const record = {
    id: newId(),
    routeId: route.id,
    timingVersion: route.timingVersion,
    date: new Date().toISOString(),
    sectorTimes: [...run.sectorTimes],
    totalTime,
    completed: true,
    simulated: simTimer != null,
  };
  // classify BEFORE merging this run into bests
  renderBoard();
  saveRun(record);
  run.sectorTimes.forEach((t, i) => {
    if (sessionBests[i] == null || t < sessionBests[i]) sessionBests[i] = t;
  });
  bests = allTimeBests(route.id, route.sectorBoundaries.length + 1, route.timingVersion);
  setStatus(`FINISHED — ${fmtTime(totalTime)}${record.simulated ? ' (simulated)' : ''}`, 'live');
  $('run-clock').textContent = fmtTime(totalTime);
  stopSession(null, /*keepBoard*/ true);
  showSummary(route, record, listRuns(route.id));
  onRunSaved?.(record);
}

function stopSession(statusMsg, keepBoard = false) {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (simTimer != null) { clearInterval(simTimer); simTimer = null; }
  if (clockTimer != null) { clearInterval(clockTimer); clockTimer = null; }
  simNow = null;
  simClockAnchorTime = 0;
  simClockAnchorReal = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  resetOffRouteFlag();
  if (!keepBoard) {
    run = null;
    if (posMarker) { posMarker.remove(); posMarker = null; }
    cursorLatLng = null;
    trackCursorDistance = null;
    if (mapMode === 'track') refreshTrackDiagram();
    $('run-clock').textContent = fmtTime(null);
  }
  $('btn-arm').disabled = false;
  $('btn-abort').hidden = true;
  $('gps-info').textContent = '';
  if (statusMsg) setStatus(statusMsg, '');
}

function startClock(now) {
  let lastBoardRefresh = 0;
  clockTimer = setInterval(() => {
    if (!run || run.state !== 'running') return;
    const frameNow = performance.now();
    $('run-clock').textContent = fmtTime(elapsed(run, now()));
    if (frameNow - lastBoardRefresh >= BOARD_REFRESH_MS) {
      renderBoard(true);
      lastBoardRefresh = frameNow;
    }
  }, CLOCK_REFRESH_MS);
}

function setStatus(msg, cls) {
  const el = $('run-status');
  el.textContent = msg;
  el.className = `run-status ${cls}`;
}

// ---------- Sector board ----------

function renderBoard(liveOnly = false) {
  const board = $('sector-board');
  if (!route) { board.innerHTML = ''; return; }
  const n = route.sectorBoundaries.length + 1;
  const rows = [];

  for (let i = 0; i < n; i++) {
    const t = run?.sectorTimes[i] ?? null;
    const isCurrent = run?.state === 'running' && run.crossings.length === i;
    let cls = 'pending', delta = '';
    if (t != null) {
      const color = classifySector(t, bests.sectors[i], sessionBests[i]);
      cls = `set-${color}`;
      if (bests.sectors[i] != null) delta = fmtDelta(t - bests.sectors[i]);
    } else if (isCurrent) {
      cls = 'current';
    }
    rows.push(`<div class="sector-row ${cls}">
      <span class="label">S${i + 1}</span>
      <span class="best">${bests.sectors[i] != null ? 'PB ' + fmtTime(bests.sectors[i]) : 'no PB'}</span>
      <span class="time">${fmtTime(t)}</span>
      <span class="delta ${delta.startsWith('−') ? 'neg' : 'pos'}">${delta}</span>
    </div>`);
  }

  const done = run?.state === 'finished';
  const totalT = done ? run.crossings.at(-1) - run.startTime : null;
  let totalCls = '', totalDelta = '';
  if (totalT != null) {
    totalCls = bests.total == null || totalT < bests.total ? 'set-purple' : 'set-yellow';
    if (bests.total != null) totalDelta = fmtDelta(totalT - bests.total);
  }
  rows.push(`<div class="sector-row total-row ${totalCls}">
    <span class="label">LAP</span>
    <span class="best">${bests.total != null ? 'PB ' + fmtTime(bests.total) : 'no PB'}</span>
    <span class="time">${fmtTime(totalT)}</span>
    <span class="delta ${totalDelta.startsWith('−') ? 'neg' : 'pos'}">${totalDelta}</span>
  </div>`);

  board.innerHTML = rows.join('');
}

export function runInvalidate() {
  map?.invalidateSize();
  if (mapMode === 'track') refreshTrackDiagram();
}
