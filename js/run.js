// Live run: GPS session (or simulator) feeding the pure timing engine,
// wake lock, and the F1-style sector board.
import { cumulativeDistances, pointAtDistance } from './geo.js';
import { createRun, feedFix, elapsed, classifySector, fmtTime, fmtDelta,
         MAX_ACCURACY_M } from './timing.js';
import { allTimeBests, saveRun, newId } from './store.js';
import { renderTrackDiagram } from './trackDiagram.js';

let map, routeLayer = null, posMarker = null;
let route = null;          // active route (with points/cum attached)
let run = null;            // engine state
let bests = null;          // { sectors, total } all-time (purple reference)
let sessionBests = null;   // per-sector session bests (green reference)
let watchId = null, wakeLock = null, simTimer = null;
let clockTimer = null;
let simNow = null;         // simulated clock when replaying
let onRunSaved = null;

const $ = id => document.getElementById(id);

export function initRun(callbacks) {
  onRunSaved = callbacks.onRunSaved;
  map = L.map('run-map').setView([25.04, 121.53], 13);
  window._runMap = map; // test hook (e2e driver)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  $('btn-arm').addEventListener('click', armGps);
  $('btn-abort').addEventListener('click', () => stopSession('Aborted.'));
  $('btn-simulate').addEventListener('click', simulate);
  $('btn-run-track-diagram').addEventListener('click', showTrackDiagram);
  $('btn-run-diagram-back').addEventListener('click', hideTrackDiagram);
  sessionBests = [];
}

export function openRun(r) {
  stopSession();
  route = { ...r, cum: cumulativeDistances(r.points) };
  hideTrackDiagram();
  $('btn-run-track-diagram').disabled = route.points.length < 2;
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

function showTrackDiagram() {
  if (!route || route.points.length < 2) return;
  renderTrackDiagram($('run-track-diagram-svg'), route);
  $('run-track-diagram-overlay').hidden = false;
}

function hideTrackDiagram() {
  $('run-track-diagram-overlay').hidden = true;
}

// ---------- GPS session ----------

async function armGps() {
  if (!navigator.geolocation) {
    setStatus('Geolocation not available in this browser.', '');
    return;
  }
  run = createRun(route);
  setStatus('ARMED — waiting for GPS fix near the start line…', 'armed');
  $('btn-arm').disabled = true;
  $('btn-abort').hidden = false;
  renderBoard();

  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    wakeLock?.addEventListener('release', () => { wakeLock = null; });
  } catch { /* wake lock unsupported — screen may sleep */ }

  watchId = navigator.geolocation.watchPosition(pos => {
    const acc = pos.coords.accuracy;
    $('gps-info').textContent =
      `GPS accuracy: ±${Math.round(acc)} m ${acc > MAX_ACCURACY_M ? '(too poor — fix ignored)' : ''}`;
    if (acc > MAX_ACCURACY_M) return;
    handleFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, t: pos.timestamp });
  }, err => {
    setStatus(`GPS error: ${err.message}. Check location permission.`, '');
    stopSession();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });

  startClock(() => Date.now());
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
  simNow = 0;
  simTimer = setInterval(() => {
    const speed = 9 + Math.random() * 8;   // m/s
    simDist += speed;
    t += 1000;
    simNow = t;
    const p = pointAtDistance(route.points, route.cum, Math.max(0, simDist));
    const jitter = () => (Math.random() - 0.5) * 0.00008; // ~±5 m
    handleFix({ lat: p[0] + jitter(), lng: p[1] + jitter(), t });
    if (simDist > total + 30 || run?.state === 'finished') {
      if (run && run.state !== 'finished') stopSession('Simulation ended.');
    }
  }, 100);

  startClock(() => simNow);
}

// ---------- Shared session plumbing ----------

function handleFix(fix) {
  if (!run) return;
  const ev = feedFix(run, fix);

  if (!posMarker) {
    posMarker = L.circleMarker([fix.lat, fix.lng],
      { radius: 8, color: '#00c853', fillOpacity: 0.9 }).addTo(map);
  } else {
    posMarker.setLatLng([fix.lat, fix.lng]);
  }

  if (ev === 'start') setStatus('LIVE — lap running.', 'live');
  if (ev === 'offroute') setStatus('LIVE — off route? Timing continues at last position.', 'armed');
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
  onRunSaved?.(record);
}

function stopSession(statusMsg, keepBoard = false) {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (simTimer != null) { clearInterval(simTimer); simTimer = null; }
  if (clockTimer != null) { clearInterval(clockTimer); clockTimer = null; }
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (!keepBoard) {
    run = null;
    if (posMarker) { posMarker.remove(); posMarker = null; }
    $('run-clock').textContent = fmtTime(null);
  }
  $('btn-arm').disabled = false;
  $('btn-abort').hidden = true;
  $('gps-info').textContent = '';
  if (statusMsg) setStatus(statusMsg, '');
}

function startClock(now) {
  clockTimer = setInterval(() => {
    if (!run || run.state !== 'running') return;
    $('run-clock').textContent = fmtTime(elapsed(run, now()));
    renderBoard(true);
  }, 100);
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
}
