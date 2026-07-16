// Post-run DETAIL analysis — a deep telemetry sheet that opens from the summary
// card, in the same white-surface / black-text F1 language as the card itself.
// Everything above `renderDetail` is pure (no DOM), so the analysis imports
// straight into `node --test`.
//
// It answers what the summary card can't:
//   1. A speed map of the track: where you were fast (green) or slow (red),
//      each corner's speed, the straights' top speed, and where you stopped.
//   2. Per-sector time + speed, classified purple/green/yellow like the board.
//   3. The ideal (theoretical-best) lap and how much time is on the table.
//   4. Lap-by-lap: which sectors got faster, which got slower.
//
// The raw material is `record.actualTrace`. New laps store timestamped fixes as
// [lat, lng, t]; older laps stored only [lat, lng]. Speed/stops need the
// timestamps, so those views degrade gracefully for legacy laps.

import { haversine, cumulativeDistances, projectOnRoute, pointAtDistance } from './geo.js';
import { classifySector, fmtTime } from './timing.js';
import { fmtLap } from './summary.js';
import { computeProjection, detectCorners } from './trackDiagram.js';
import { getLanguage } from './i18n.js';

const STOP_SPEED_MPS = 0.8;   // below this a leg counts as "stopped" (~2.9 km/h)
const STOP_MIN_MS = 3000;     // a stop must last this long to be reported
const NOISE_MAX_MPS = 60;     // faster than this is GPS noise, excluded from maxima
const LIGHT_NEAR_M = 45;      // a stop is attributed to a light within this radius

// ---- localisation ----
// Single language at a time, driven by the app's setting — never both at once.
const STR = {
  en: {
    telemetry: 'TELEMETRY', sim: 'SIM', lapTime: 'LAP TIME',
    avgSpeed: 'AVG SPEED', topSpeed: 'TOP SPEED', movingAvg: 'MOVING AVG',
    stopsTile: 'STOPS', stoppedTile: 'STOPPED', conformance: 'CONFORMANCE',
    sectors: 'sectors', kmh: 'km/h',
    speedMap: 'SPEED MAP', speedMapHint: 'Coloured by your speed — green fast, red slow. 🚦 = stop.',
    mapTapHint: 'Tap a corner or sector to inspect · scroll or pinch to zoom.',
    tapPrompt: 'Tap a corner or sector on the map to see its numbers.',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Reset view',
    slow: 'SLOW', fast: 'FAST',
    cornerSpeeds: 'CORNER & STRAIGHT SPEED', cornerChart: 'CORNER SPEED CHART',
    topStraight: 'Top straight', slowestCorner: 'Slowest corner', avgCorner: 'Avg corner',
    corner: 'Corner', straightLbl: 'straight', turn: 'turn',
    sectorWord: 'Sector', cornerWord: 'Corner', speedWord: 'Speed', timeWord: 'Time', distanceWord: 'Distance',
    sectorAnalysis: 'SECTOR ANALYSIS', legPurple: 'new best', legGreen: 'session best', legYellow: 'slower',
    best: 'BEST', first: 'FIRST', avg: 'avg', max: 'max', ofLap: 'of lap',
    idealLap: 'IDEAL LAP', idealSub: 'Sum of your best-ever sectors.', thisLapIs: 'This lap', toFind: 'to find',
    speedProfile: 'SPEED PROFILE', start: 'START', finish: 'FINISH',
    stops: 'STOPS', noStops: 'No stops — a clean, flowing lap.',
    noTelemetry: 'This lap has no per-point timing — speed and stops are unavailable. New laps record it automatically.',
    stopSummary: (n, dur, pct) => `${n} stop${n === 1 ? '' : 's'}, ${dur} total (${pct}% of the lap)`,
    light: 'Light', segment: 'segment', fromStart: 'from start', ofDist: 'of lap',
    lapByLap: 'LAP BY LAP', thisLap: 'THIS', total: 'TOTAL',
    tableNote: 'Gap of this lap vs that lap: green − = this lap faster, red + = slower.',
    firstLap: 'First clean lap on this route — future laps compare here.',
    personalBest: 'PERSONAL BEST', vsPb: 'vs PB',
    footer: 'Commute Qualifying · detailed telemetry',
    dsqConf: 'conformance',
  },
  zh: {
    telemetry: '詳細數據', sim: '模擬', lapTime: '單圈時間',
    avgSpeed: '平均速度', topSpeed: '最高速度', movingAvg: '行進均速',
    stopsTile: '停等次數', stoppedTile: '停等時間', conformance: '符合度',
    sectors: '賽段', kmh: 'km/h',
    speedMap: '速度地圖', speedMapHint: '依速度上色：綠快、紅慢。🚦＝停等。',
    mapTapHint: '點彎道或賽段查看細節 · 捲動或雙指縮放。',
    tapPrompt: '點地圖上的彎道或賽段，看該處的數據。',
    zoomIn: '放大', zoomOut: '縮小', zoomReset: '重設視圖',
    slow: '慢', fast: '快',
    cornerSpeeds: '彎道與直線速度', cornerChart: '彎道速度圖表',
    topStraight: '直線最高速', slowestCorner: '最慢彎', avgCorner: '彎道平均',
    corner: '彎道', straightLbl: '直線', turn: '轉角',
    sectorWord: '賽段', cornerWord: '彎道', speedWord: '速度', timeWord: '時間', distanceWord: '距離',
    sectorAnalysis: '分段分析', legPurple: '新最速', legGreen: '時段最速', legYellow: '較慢',
    best: '最速', first: '首圈', avg: '均速', max: '最高', ofLap: '佔全程',
    idealLap: '理論最速圈', idealSub: '由每段的歷史最速拼成。', thisLapIs: '本圈', toFind: '可再進步',
    speedProfile: '速度曲線', start: '起點', finish: '終點',
    stops: '停等紀錄', noStops: '全程沒有停等 — 一氣呵成。',
    noTelemetry: '此圈沒有逐點時間資料，無法分析速度與停等。之後的新紀錄會自動記錄。',
    stopSummary: (n, dur, pct) => `共 ${n} 次停等，合計 ${dur}（占全程 ${pct}%）`,
    light: '紅綠燈', segment: '路段', fromStart: '距起點', ofDist: '賽程',
    lapByLap: '逐圈比較', thisLap: '本圈', total: '總計',
    tableNote: '本圈相對於該圈的差距：綠色− 表示本圈較快，紅色＋ 表示較慢。',
    firstLap: '這條路線的第一筆有效紀錄，之後再跑就能在這裡比較每一段的快慢。',
    personalBest: '個人最佳', vsPb: '對比最佳',
    footer: '通勤排位賽 · 詳細遙測',
    dsqConf: '符合度',
  },
};
function L(key) {
  const lang = getLanguage() === 'zh' ? 'zh' : 'en';
  return STR[lang][key] ?? STR.en[key] ?? key;
}

// ---- small formatters ----

export function fmtSpeed(kmh) {
  if (kmh == null || !Number.isFinite(kmh)) return '--';
  return kmh.toFixed(1);
}

export function fmtDist(m) {
  if (m == null || !Number.isFinite(m)) return '--';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
}

const mps2kmh = mps => mps * 3.6;

// ---- geometry ----

export function sectorSpans(route) {
  const cum = route.cum ?? cumulativeDistances(route.points);
  const total = cum.at(-1) ?? 0;
  const bounds = [...(route.sectorBoundaries ?? [])];
  const edges = [0, ...bounds, total];
  const spans = [];
  for (let i = 0; i < edges.length - 1; i++) {
    spans.push({ index: i, startM: edges[i], endM: edges[i + 1], distanceM: edges[i + 1] - edges[i] });
  }
  return spans;
}

export function traceHasTime(trace) {
  return Array.isArray(trace) && trace.length >= 2 &&
    trace.every(p => Array.isArray(p) && p.length >= 3 && Number.isFinite(p[2]));
}

// Per-segment speed samples along a timestamped trace: midpoint progress, speed,
// duration and distance for the leg between two consecutive fixes.
export function computeSpeedSamples(trace, points, cum) {
  if (!traceHasTime(trace) || !points || points.length < 2) return [];
  const projected = trace.map(p => {
    const pr = projectOnRoute([p[0], p[1]], points, cum);
    return { lat: p[0], lng: p[1], t: p[2], progress: pr ? pr.progress : null };
  });
  const samples = [];
  for (let i = 1; i < projected.length; i++) {
    const a = projected[i - 1], b = projected[i];
    const dtMs = b.t - a.t;
    if (!(dtMs > 0)) continue;
    const distM = haversine([a.lat, a.lng], [b.lat, b.lng]);
    const speedMps = distM / (dtMs / 1000);
    const atM = a.progress != null && b.progress != null
      ? (a.progress + b.progress) / 2
      : (b.progress ?? a.progress);
    samples.push({ atM, speedMps, distM, dtMs, tStart: a.t, tEnd: b.t });
  }
  return samples;
}

export function sectorSpeed(samples, span) {
  let dist = 0, time = 0, max = 0, hasMax = false;
  for (const s of samples) {
    if (s.atM == null || s.atM < span.startM || s.atM >= span.endM) continue;
    dist += s.distM;
    time += s.dtMs;
    if (s.speedMps <= NOISE_MAX_MPS && s.speedMps > max) { max = s.speedMps; hasMax = true; }
  }
  return {
    avgKmh: time > 0 ? mps2kmh(dist / (time / 1000)) : null,
    maxKmh: hasMax ? mps2kmh(max) : null,
  };
}

// Average speed (km/h) around a distance along the route — for corner speeds.
export function speedAtDistance(samples, d, windowM = 30) {
  if (!samples.length || d == null) return null;
  let sum = 0, w = 0, nearest = null, nd = Infinity;
  for (const s of samples) {
    if (s.atM == null || s.speedMps > NOISE_MAX_MPS) continue;
    const dist = Math.abs(s.atM - d);
    if (dist < nd) { nd = dist; nearest = s; }
    if (dist <= windowM) { sum += s.speedMps; w++; }
  }
  const mps = w ? sum / w : (nearest ? nearest.speedMps : null);
  return mps == null ? null : mps2kmh(mps);
}

export function detectStops(trace, points, cum,
                            { stopSpeed = STOP_SPEED_MPS, minMs = STOP_MIN_MS } = {}) {
  if (!traceHasTime(trace)) return [];
  const stops = [];
  let run = null;
  const flush = () => {
    if (run && run.durationMs >= minMs) {
      const p = trace[run.startIdx];
      const pr = points && points.length >= 2 ? projectOnRoute([p[0], p[1]], points, cum) : null;
      stops.push({ atM: pr ? pr.progress : null, point: [p[0], p[1]], durationMs: run.durationMs, tStart: p[2] });
    }
    run = null;
  };
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    const dtMs = b[2] - a[2];
    if (!(dtMs > 0)) continue;
    const distM = haversine([a[0], a[1]], [b[0], b[1]]);
    if (distM / (dtMs / 1000) < stopSpeed) {
      if (!run) run = { startIdx: i - 1, endIdx: i, durationMs: 0 };
      run.endIdx = i;
      run.durationMs += dtMs;
    } else {
      flush();
    }
  }
  flush();
  return stops;
}

function nearestLight(point, lights, radiusM = LIGHT_NEAR_M) {
  if (!Array.isArray(lights) || !lights.length) return null;
  let best = null;
  lights.forEach((l, i) => {
    const d = haversine(point, l);
    if (best == null || d < best.distM) best = { index: i + 1, distM: d };
  });
  return best && best.distM <= radiusM ? best : null;
}

// ---- the full analysis ----

function bestsExcluding(comparable, record, sectorCount) {
  const others = comparable.filter(r => r.id !== record.id);
  const sectorBest = (list, i) => {
    const ts = list.map(r => r.sectorTimes?.[i]).filter(t => t != null);
    return ts.length ? Math.min(...ts) : null;
  };
  const dateKey = iso => String(iso).slice(0, 10);
  const today = others.filter(r => dateKey(r.date) === dateKey(record.date));
  return {
    allSectors: (i) => sectorBest(others, i),
    sessionSectors: (i) => sectorBest(today, i),
    allTotal: (() => { const ts = others.map(r => r.totalTime).filter(t => t != null); return ts.length ? Math.min(...ts) : null; })(),
  };
}

export function buildDetailData(route, record, runs) {
  const cum = route.cum ?? cumulativeDistances(route.points);
  const totalDistanceM = cum.at(-1) ?? 0;
  const spans = sectorSpans({ ...route, cum });
  const n = spans.length;

  const comparable = (runs ?? []).filter(r =>
    r.completed && !r.disqualified && r.timingVersion === route.timingVersion);
  const bests = bestsExcluding(comparable, record, n);

  const trace = record.actualTrace ?? [];
  const hasTelemetry = traceHasTime(trace);
  const samples = hasTelemetry ? computeSpeedSamples(trace, route.points, cum) : [];
  const stops = hasTelemetry ? detectStops(trace, route.points, cum) : [];

  const stopsDetailed = stops.map(s => {
    const span = spans.find(sp => s.atM != null && s.atM >= sp.startM && s.atM < sp.endM) ?? spans[spans.length - 1];
    return { ...s, sectorIndex: span ? span.index : null, light: nearestLight(s.point, route.lights) };
  });

  const sectors = spans.map((span, i) => {
    const timeMs = record.sectorTimes?.[i] ?? null;
    const prevAll = bests.allSectors(i);
    const prevSession = bests.sessionSectors(i);
    const color = timeMs != null ? classifySector(timeMs, prevAll, prevSession) : null;
    const sp = hasTelemetry ? sectorSpeed(samples, span) : { avgKmh: null, maxKmh: null };
    const splitAvgKmh = timeMs > 0 ? mps2kmh(span.distanceM / (timeMs / 1000)) : null;
    const sectorStops = stopsDetailed.filter(s => s.sectorIndex === i);
    return {
      index: i, label: `S${i + 1}`, distanceM: span.distanceM,
      pctOfLap: totalDistanceM > 0 ? span.distanceM / totalDistanceM : 0,
      timeMs, color,
      prevBestMs: prevAll,
      deltaVsBestMs: prevAll != null && timeMs != null ? timeMs - prevAll : null,
      isRecord: color === 'purple' && prevAll != null,
      isFirst: prevAll == null,
      avgKmh: sp.avgKmh ?? splitAvgKmh,
      splitAvgKmh, maxKmh: sp.maxKmh,
      stops: sectorStops, stopCount: sectorStops.length,
      stoppedMs: sectorStops.reduce((a, s) => a + s.durationMs, 0),
    };
  });

  // Corners (from the same detector the circuit diagram uses) + their speeds.
  const corners = detectCorners(route.points).map(c => {
    const span = spans.find(sp => c.distance >= sp.startM && c.distance < sp.endM) ?? spans[spans.length - 1];
    return {
      number: c.number, distanceM: c.distance, turnDeg: Math.abs(c.turn),
      sectorIndex: span ? span.index : null,
      speedKmh: hasTelemetry ? speedAtDistance(samples, c.distance) : null,
    };
  });
  const cornerSpeeds = corners.map(c => c.speedKmh).filter(v => v != null);
  const slowest = corners.reduce((m, c) => (c.speedKmh != null && (m == null || c.speedKmh < m.speedKmh)) ? c : m, null);

  const idealSectors = spans.map((_, i) => {
    const mine = record.sectorTimes?.[i], prev = bests.allSectors(i);
    const vals = [mine, prev].filter(t => t != null);
    return vals.length ? Math.min(...vals) : null;
  });
  const idealTotalMs = idealSectors.every(t => t != null) ? idealSectors.reduce((a, t) => a + t, 0) : null;
  const timeLostVsIdealMs = idealTotalMs != null && record.totalTime != null ? record.totalTime - idealTotalMs : null;

  const totalStoppedMs = stopsDetailed.reduce((a, s) => a + s.durationMs, 0);
  const movingMs = record.totalTime != null ? record.totalTime - totalStoppedMs : null;
  const maxKmh = sectors.reduce((m, s) => s.maxKmh != null && s.maxKmh > m ? s.maxKmh : m, 0) || null;
  const overall = {
    distanceM: totalDistanceM, totalTimeMs: record.totalTime,
    avgKmh: record.totalTime > 0 ? mps2kmh(totalDistanceM / (record.totalTime / 1000)) : null,
    movingAvgKmh: hasTelemetry && movingMs > 0 ? mps2kmh(totalDistanceM / (movingMs / 1000)) : null,
    maxKmh, stopCount: stopsDetailed.length, totalStoppedMs,
  };

  const speedStats = {
    topStraightKmh: maxKmh,
    avgCornerKmh: cornerSpeeds.length ? cornerSpeeds.reduce((a, b) => a + b, 0) / cornerSpeeds.length : null,
    slowestCornerKmh: slowest ? slowest.speedKmh : null,
    slowestCornerNumber: slowest ? slowest.number : null,
  };

  const others = comparable.filter(r => r.id !== record.id)
    .slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const compare = others.map(r => ({
    id: r.id, date: r.date, simulated: r.simulated === true, totalTime: r.totalTime,
    totalDeltaMs: r.totalTime != null && record.totalTime != null ? record.totalTime - r.totalTime : null,
    sectorTimes: spans.map((_, i) => r.sectorTimes?.[i] ?? null),
    sectorDeltas: spans.map((_, i) => {
      const mine = record.sectorTimes?.[i], theirs = r.sectorTimes?.[i];
      return mine != null && theirs != null ? mine - theirs : null;
    }),
  }));

  const rank = comparable.filter(r => r.totalTime != null && record.totalTime != null &&
    r.totalTime < record.totalTime).length + 1;

  return {
    route: { ...route, cum }, record, hasTelemetry, samples, sectorCount: n,
    sectors, corners, speedStats, overall, stops: stopsDetailed,
    ideal: { sectors: idealSectors, totalMs: idealTotalMs, timeLostVsIdealMs },
    compare, rank, lapCount: comparable.length,
    disqualified: record.disqualified === true, conformance: record.conformance,
    simulated: record.simulated === true, date: record.date,
    isPB: !record.disqualified && (bests.allTotal == null ||
      (record.totalTime != null && record.totalTime <= bests.allTotal)),
    prevBestTotalMs: bests.allTotal,
    deltaVsBestTotalMs: bests.allTotal != null && record.totalTime != null ? record.totalTime - bests.allTotal : null,
  };
}

// ---- rendering (DOM) ----

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shortDateTime(iso) {
  const d = new Date(iso);
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
               'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${mon} ${d.getFullYear()} · ${hh}:${mm}`;
}

function deltaCell(ms) {
  if (ms == null) return { text: '—', cls: 'flat' };
  if (Math.abs(ms) < 0.5) return { text: '±0.000', cls: 'flat' };
  const faster = ms < 0;
  return { text: `${faster ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`, cls: faster ? 'faster' : 'slower' };
}

// Red (slow) → yellow → green (fast). `frac` is 0..1.
function speedColor(frac) {
  const f = Math.max(0, Math.min(1, frac));
  const red = [225, 6, 0], yellow = [245, 190, 30], green = [18, 165, 63];
  const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = f < 0.5 ? lerp(red, yellow, f / 0.5) : lerp(yellow, green, (f - 0.5) / 0.5);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// Projected geometry for the speed map. Pure & cheap, so both the SVG builder
// and the interaction wiring recompute it rather than passing a closure around.
const MAP_W = 1000, MAP_H = 620, MAP_PAD = 78;
function computeMapGeom(data) {
  const points = data.route.points || [];
  const cum = data.route.cum;
  if (points.length < 2) return null;
  const { project } = computeProjection(points, { width: MAP_W, height: MAP_H, pad: MAP_PAD });
  const xy = points.map(project);
  const spans = sectorSpans(data.route);
  const sectorOf = d => (spans.find(sp => d >= sp.startM && d < sp.endM) ?? spans[spans.length - 1]).index;

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const mid = (cum[i] + cum[i + 1]) / 2;
    let kmh = data.hasTelemetry ? speedAtDistance(data.samples, mid, Math.max(30, cum[i + 1] - cum[i])) : null;
    if (kmh == null) { const s = data.sectors[sectorOf(mid)]; kmh = s ? (s.avgKmh ?? s.splitAvgKmh) : null; }
    segments.push({ i, sector: sectorOf(mid), p1: xy[i], p2: xy[i + 1], kmh });
  }
  const known = segments.map(s => s.kmh).filter(v => v != null);
  const lo = known.length ? Math.min(...known) : 0, hi = known.length ? Math.max(...known) : 1;
  const norm = v => (hi - lo) < 1e-6 ? 0.5 : (v - lo) / (hi - lo);
  segments.forEach(s => { s.color = s.kmh != null ? speedColor(norm(s.kmh)) : '#b8b8c0'; });

  const corners = detectCorners(points).map(c => {
    const [cx, cy] = project(c.point);
    return {
      number: c.number, xy: [cx, cy], labelXY: [cx + c.outward[0] * 40, cy + c.outward[1] * 40],
      speedKmh: data.hasTelemetry ? speedAtDistance(data.samples, c.distance) : null,
      turnDeg: Math.abs(c.turn), sector: sectorOf(c.distance), distanceM: c.distance,
    };
  });
  const stops = data.stops.filter(s => s.atM != null)
    .map(s => ({ ...s, xy: project(pointAtDistance(points, cum, s.atM)) }));
  return { W: MAP_W, H: MAP_H, viewBox: [0, 0, MAP_W, MAP_H], xy, segments, corners, stops, spans };
}

// The hero: a stylised track, each segment coloured by the speed driven there,
// with tappable corner markers, stop flags and start/finish. Interaction (zoom,
// pan, tap-to-inspect) is wired separately in wireSpeedMap.
function speedMapSvg(data, geom) {
  if (!geom) return '';
  const { xy, segments, corners, stops } = geom;
  let svg = `<path d="${xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"
    fill="none" stroke="#d7d7dd" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (const s of segments) {
    svg += `<line x1="${s.p1[0].toFixed(1)}" y1="${s.p1[1].toFixed(1)}" x2="${s.p2[0].toFixed(1)}" y2="${s.p2[1].toFixed(1)}"
      stroke="${s.color}" stroke-width="13" stroke-linecap="round"/>`;
  }
  const [sx, sy] = xy[0], [sx2, sy2] = xy[1];
  const sl = Math.hypot(sx2 - sx, sy2 - sy) || 1;
  const spx = -(sy2 - sy) / sl, spy = (sx2 - sx) / sl;
  svg += `<line x1="${(sx - spx * 26).toFixed(1)}" y1="${(sy - spy * 26).toFixed(1)}"
    x2="${(sx + spx * 26).toFixed(1)}" y2="${(sy + spy * 26).toFixed(1)}" stroke="#15151e" stroke-width="7"/>`;

  // selection highlight layer (populated on tap)
  svg += `<g class="dt-map-overlay"></g>`;

  for (const c of corners) {
    svg += `<circle cx="${c.xy[0].toFixed(1)}" cy="${c.xy[1].toFixed(1)}" r="15" fill="#fff" stroke="#15151e" stroke-width="3"/>`;
    svg += `<text x="${c.xy[0].toFixed(1)}" y="${c.xy[1].toFixed(1)}" class="dt-map-cnum" text-anchor="middle" dominant-baseline="central">${c.number}</text>`;
    if (c.speedKmh != null) {
      svg += `<text x="${c.labelXY[0].toFixed(1)}" y="${c.labelXY[1].toFixed(1)}" class="dt-map-cspd" text-anchor="middle" dominant-baseline="central">${Math.round(c.speedKmh)}</text>`;
    }
  }
  for (const s of stops) {
    svg += `<circle cx="${s.xy[0].toFixed(1)}" cy="${s.xy[1].toFixed(1)}" r="17" fill="#15151e"/>`;
    svg += `<text x="${s.xy[0].toFixed(1)}" y="${s.xy[1].toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="20">🚦</text>`;
  }
  return `<svg class="dt-map-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Speed map">${svg}</svg>`;
}

// A bar chart of each corner's speed — the "彎道速度圖表" the sheet lists below
// the map. Bars are coloured on the same slow→fast scale as the map.
function cornerChartSvg(data) {
  const cs = data.corners.filter(c => c.speedKmh != null);
  if (cs.length < 1) return '';
  const hi = Math.max(...cs.map(c => c.speedKmh));
  const cols = cs.map(c => {
    const h = hi > 0 ? (c.speedKmh / hi) * 100 : 0;
    const slow = c.number === data.speedStats.slowestCornerNumber;
    return `<div class="dt-cbar-col${slow ? ' slow' : ''}">
      <div class="dt-cbar-val">${Math.round(c.speedKmh)}</div>
      <div class="dt-cbar-track"><div class="dt-cbar" style="height:${h.toFixed(1)}%"></div></div>
      <div class="dt-cbar-lbl">T${c.number}</div>
    </div>`;
  }).join('');
  return `<div class="dt-cchart"><div class="dt-cchart-yaxis"><span>${Math.round(hi)}</span><span>0</span></div>
    <div class="dt-cchart-bars">${cols}</div></div>
    <div class="dt-cchart-cap">${L('kmh')} · ${L('cornerWord')}</div>`;
}

// Speed vs distance, with a labelled speed axis (km/h) and a sector axis.
function profileBlock(data) {
  const total = data.overall.distanceM || 1;
  const pts = data.samples.filter(s => s.atM != null && s.speedMps <= NOISE_MAX_MPS)
    .map(s => ({ x: s.atM / total, v: mps2kmh(s.speedMps) })).sort((a, b) => a.x - b.x);
  if (pts.length < 2) return '';
  const W = 1000, H = 240, padB = 4;
  const vmax = Math.ceil(Math.max(20, ...pts.map(p => p.v)) * 1.1 / 10) * 10;
  const X = x => x * W, Y = v => H - padB - (v / vmax) * (H - padB);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${X(pts.at(-1).x).toFixed(1)},${H} L${X(pts[0].x).toFixed(1)},${H} Z`;
  const spans = sectorSpans(data.route);
  // horizontal speed gridlines at 0, ¼, ½, ¾, max
  const hGrid = [0.25, 0.5, 0.75].map(f =>
    `<line x1="0" y1="${Y(vmax * f).toFixed(1)}" x2="${W}" y2="${Y(vmax * f).toFixed(1)}" class="dt-grid"/>`).join('');
  const vGrid = spans.slice(1).map(sp =>
    `<line x1="${X(sp.startM / total).toFixed(1)}" y1="0" x2="${X(sp.startM / total).toFixed(1)}" y2="${H}" class="dt-grid dt-grid-sector"/>`).join('');
  const stopMarks = data.stops.filter(s => s.atM != null).map(s =>
    `<line x1="${X(s.atM / total).toFixed(1)}" y1="0" x2="${X(s.atM / total).toFixed(1)}" y2="${H}" class="dt-stopmark"/>`).join('');
  const svg = `<svg class="dt-profile-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Speed profile">
    ${hGrid}${vGrid}<path d="${area}" class="dt-profile-area"/><path d="${line}" class="dt-profile-line" fill="none"/>${stopMarks}</svg>`;
  // y-axis labels (km/h), positioned by percentage to match the stretched svg
  const yLabels = [1, 0.75, 0.5, 0.25, 0].map(f =>
    `<span style="top:${((1 - f) * 100).toFixed(1)}%">${Math.round(vmax * f)}</span>`).join('');
  // x-axis: sector label centred within each sector's span
  const xLabels = spans.map(sp => {
    const c = ((sp.startM + sp.endM) / 2) / total * 100;
    return `<span style="left:${c.toFixed(1)}%">S${sp.index + 1}</span>`;
  }).join('');
  return `<div class="dt-profile">
    <div class="dt-profile-yunit">${L('kmh')}</div>
    <div class="dt-profile-plot"><div class="dt-profile-yaxis">${yLabels}</div>${svg}</div>
    <div class="dt-profile-xaxis">${xLabels}</div>
    <div class="dt-profile-xunit">${L('sectorWord').toUpperCase()}</div>
  </div>`;
}

function bar(fraction, cls) {
  const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return `<span class="dt-mbar"><span class="dt-mbar-fill ${cls}" style="width:${pct.toFixed(1)}%"></span></span>`;
}

function sectorRow(s, maxTime) {
  const cls = s.color ? `dt-${s.color}` : '';
  const d = deltaCell(s.deltaVsBestMs);
  const tag = s.isFirst ? `<span class="dt-tag dt-tag-new">${L('first')}</span>`
    : s.isRecord ? `<span class="dt-tag dt-tag-pb">${L('best')}</span>` : '';
  const stopBadge = s.stopCount ? `<span class="dt-stopbadge">🚦 ${s.stopCount} · ${fmtDuration(s.stoppedMs)}</span>` : '';
  return `<div class="dt-srow ${cls}">
    <div class="dt-srow-head">
      <span class="dt-slabel">${esc(s.label)} ${tag}</span>
      <span class="dt-stime">${fmtTime(s.timeMs)}</span>
      <span class="dt-sdelta ${d.cls}">${d.text}</span>
    </div>
    <div class="dt-srow-bar">${bar(maxTime ? (s.timeMs || 0) / maxTime : 0, `fill-${s.color || 'none'}`)}</div>
    <div class="dt-srow-meta">
      <span><b>${fmtSpeed(s.avgKmh)}</b> <i>${L('kmh')} ${L('avg')}</i></span>
      <span><b>${fmtSpeed(s.maxKmh)}</b> <i>${L('max')}</i></span>
      <span><b>${fmtDist(s.distanceM)}</b> <i>${(s.pctOfLap * 100).toFixed(0)}% ${L('ofLap')}</i></span>
      ${stopBadge}
    </div>
  </div>`;
}

function cornerSection(data) {
  if (!data.corners.length) return '';
  const stat = (label, val) => `<div class="dt-cstat"><div class="dt-cstat-val">${val}<span>${L('kmh')}</span></div><div class="dt-cstat-lbl">${esc(label)}</div></div>`;
  const stats = `<div class="dt-cstats">
    ${stat(L('topStraight'), fmtSpeed(data.speedStats.topStraightKmh))}
    ${stat(L('slowestCorner') + (data.speedStats.slowestCornerNumber ? ` T${data.speedStats.slowestCornerNumber}` : ''), fmtSpeed(data.speedStats.slowestCornerKmh))}
    ${stat(L('avgCorner'), fmtSpeed(data.speedStats.avgCornerKmh))}
  </div>`;
  const rows = data.corners.map(c => {
    const slow = c.number === data.speedStats.slowestCornerNumber;
    return `<div class="dt-corner${slow ? ' dt-corner-slow' : ''}">
      <span class="dt-corner-n">T${c.number}</span>
      <span class="dt-corner-spd">${fmtSpeed(c.speedKmh)} <i>${L('kmh')}</i></span>
      <span class="dt-corner-meta">${Math.round(c.turnDeg)}° ${L('turn')} · S${(c.sectorIndex ?? 0) + 1} · ${fmtDist(c.distanceM)}</span>
    </div>`;
  }).join('');
  return stats + `<div class="dt-corners">${rows}</div>`;
}

function stopsSection(data) {
  if (!data.hasTelemetry) return `<p class="dt-empty">${L('noTelemetry')}</p>`;
  if (!data.stops.length) return `<p class="dt-clean">🟢 ${L('noStops')}</p>`;
  const total = data.overall.distanceM || 1;
  const pct = data.record.totalTime ? (data.overall.totalStoppedMs / data.record.totalTime * 100).toFixed(0) : '0';
  const items = data.stops.map((s, i) => {
    const where = s.light ? `🚦 ${L('light')} #${s.light.index}`
      : (s.sectorIndex != null ? `S${s.sectorIndex + 1} ${L('segment')}` : L('segment'));
    return `<div class="dt-stop">
      <span class="dt-stop-n">${i + 1}</span>
      <div class="dt-stop-body">
        <div class="dt-stop-top"><span class="dt-stop-where">${where}</span><span class="dt-stop-dur">${fmtDuration(s.durationMs)}</span></div>
        <div class="dt-stop-sub">${L('fromStart')} ${fmtDist(s.atM)} · ${((s.atM ?? 0) / total * 100).toFixed(0)}% ${L('ofDist')}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="dt-stop-summary">${esc(L('stopSummary')(data.overall.stopCount, fmtDuration(data.overall.totalStoppedMs), pct))}</div>
    <div class="dt-stops">${items}</div>`;
}

function comparisonTable(data) {
  if (!data.compare.length) return `<p class="dt-empty">${L('firstLap')}</p>`;
  const head = `<tr><th>${L('lapByLap').split(' ')[0]}</th>${data.sectors.map(s => `<th>${esc(s.label)}</th>`).join('')}<th>${L('total')}</th></tr>`;
  const thisRow = `<tr class="dt-row-this">
    <td class="dt-lapname">${L('thisLap')}</td>
    ${data.sectors.map(s => `<td class="dt-t dt-${s.color || 'none'}">${fmtTime(s.timeMs)}</td>`).join('')}
    <td class="dt-t dt-total">${fmtTime(data.record.totalTime)}</td></tr>`;
  const rows = data.compare.slice(0, 6).map(r => {
    const dt = deltaCell(r.totalDeltaMs);
    return `<tr>
      <td class="dt-lapname">${esc(shortDateTime(r.date))}${r.simulated ? ` <span class="dt-sim">${L('sim').toLowerCase()}</span>` : ''}</td>
      ${r.sectorDeltas.map(dms => { const c = deltaCell(dms); return `<td class="dt-d ${c.cls}">${c.text}</td>`; }).join('')}
      <td class="dt-d dt-total ${dt.cls}">${dt.text}</td></tr>`;
  }).join('');
  return `<div class="dt-table-scroll"><table class="dt-table"><thead>${head}</thead><tbody>${thisRow}${rows}</tbody></table></div>
    <p class="dt-tablenote">${esc(L('tableNote'))}</p>`;
}

function statTile(value, unit, label) {
  return `<div class="dt-tile">
    <div class="dt-tile-val">${esc(value)}<span class="dt-tile-unit">${esc(unit)}</span></div>
    <div class="dt-tile-label">${esc(label)}</div></div>`;
}

export function renderDetail(container, data) {
  const maxTime = Math.max(0, ...data.sectors.map(s => s.timeMs || 0)) || 1;
  const badge = data.disqualified
    ? `<span class="dt-badge dt-badge-dsq">DSQ · ${L('dsqConf')} ${Math.round((data.conformance ?? 0) * 100)}%</span>`
    : data.isPB
      ? `<span class="dt-badge dt-badge-pb">${L('personalBest')} · P${data.rank}</span>`
      : `<span class="dt-badge">P${data.rank} / ${data.lapCount} · ${deltaCell(data.deltaVsBestTotalMs).text} ${L('vsPb')}</span>`;

  const ideal = data.ideal.totalMs != null ? `<section class="dt-sec"><div class="dt-ideal">
      <div class="dt-ideal-head"><span class="dt-ideal-title">${L('idealLap')}</span><span class="dt-ideal-time">${fmtLap(data.ideal.totalMs)}</span></div>
      <div class="dt-ideal-sub">${L('idealSub')} ${L('thisLapIs')} ${fmtLap(data.record.totalTime)} ·
        ${L('toFind')} <b class="slower">${data.ideal.timeLostVsIdealMs != null ? '+' + (data.ideal.timeLostVsIdealMs / 1000).toFixed(3) : '—'}</b></div>
    </div></section>` : '';

  const geom = computeMapGeom(data);
  const map = speedMapSvg(data, geom);
  const profile = profileBlock(data);

  container.innerHTML = `
    <article class="dt-sheet${data.disqualified ? ' dt-sheet-dsq' : ''}">
      <header class="dt-head">
        <div class="dt-head-row">
          <div class="dt-mark">CQ</div>
          <div class="dt-head-text">
            <div class="dt-kicker">${L('telemetry')}${data.simulated ? ' · ' + L('sim') : ''}</div>
            <h2 class="dt-title">${esc(data.route.name || 'UNNAMED ROUTE')}</h2>
            <div class="dt-subtitle">${esc(shortDateTime(data.date))} · ${data.sectorCount} ${L('sectors')} · ${fmtDist(data.overall.distanceM)}</div>
          </div>
        </div>
        <div class="dt-laprow">
          <div class="dt-laptime"><span class="dt-laptime-val">${fmtLap(data.record.totalTime)}</span><span class="dt-laptime-lbl">${L('lapTime')}</span></div>
          ${badge}
        </div>
      </header>

      <section class="dt-tiles">
        ${statTile(fmtSpeed(data.overall.avgKmh), ' ' + L('kmh'), L('avgSpeed'))}
        ${statTile(fmtSpeed(data.overall.maxKmh), ' ' + L('kmh'), L('topSpeed'))}
        ${statTile(data.hasTelemetry ? fmtSpeed(data.overall.movingAvgKmh) : '--', ' ' + L('kmh'), L('movingAvg'))}
        ${statTile(String(data.overall.stopCount), '', L('stopsTile'))}
        ${statTile(fmtDuration(data.overall.totalStoppedMs), '', L('stoppedTile'))}
        ${statTile(Math.round((data.conformance ?? 1) * 100) + '', '%', L('conformance'))}
      </section>

      ${map ? `<section class="dt-sec dt-sec-map"><div class="dt-bar"><span>${L('speedMap')}</span></div>
        <div class="dt-map">${map}
          <div class="dt-map-ctrl">
            <button type="button" data-zoom="in" aria-label="${esc(L('zoomIn'))}" title="${esc(L('zoomIn'))}">＋</button>
            <button type="button" data-zoom="out" aria-label="${esc(L('zoomOut'))}" title="${esc(L('zoomOut'))}">－</button>
            <button type="button" data-zoom="reset" aria-label="${esc(L('zoomReset'))}" title="${esc(L('zoomReset'))}">⟲</button>
          </div>
        </div>
        <div class="dt-map-legend"><span>${L('slow')}</span><span class="dt-map-scale"></span><span>${L('fast')}</span></div>
        <div class="dt-map-info dt-map-info-empty">${L('tapPrompt')}</div>
        <p class="dt-hint">${L('mapTapHint')}</p></section>` : ''}

      ${data.corners.length ? `<section class="dt-sec"><div class="dt-bar"><span>${L('cornerSpeeds')}</span></div>
        ${cornerChartSvg(data)}${cornerSection(data)}</section>` : ''}

      ${ideal}

      <section class="dt-sec"><div class="dt-bar"><span>${L('sectorAnalysis')}</span></div>
        <div class="dt-legend"><span class="dt-lg dt-purple">${L('legPurple')}</span><span class="dt-lg dt-green">${L('legGreen')}</span><span class="dt-lg dt-yellow">${L('legYellow')}</span></div>
        <div class="dt-sectors">${data.sectors.map(s => sectorRow(s, maxTime)).join('')}</div>
      </section>

      ${profile ? `<section class="dt-sec"><div class="dt-bar"><span>${L('speedProfile')}</span></div>${profile}</section>` : ''}

      <section class="dt-sec"><div class="dt-bar"><span>${L('stops')}</span></div>${stopsSection(data)}</section>

      <section class="dt-sec"><div class="dt-bar"><span>${L('lapByLap')}</span></div>${comparisonTable(data)}</section>

      <footer class="dt-foot">${L('footer')}</footer>
    </article>`;

  if (geom) wireSpeedMap(container, data, geom);
}

// ---- interactive speed map: zoom / pan / pinch + tap-to-inspect ----

const SVGNS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function wireSpeedMap(container, data, geom) {
  const svg = container.querySelector('.dt-map-svg');
  const section = container.querySelector('.dt-sec-map');
  if (!svg || !section) return;
  const overlay = svg.querySelector('.dt-map-overlay');
  const info = section.querySelector('.dt-map-info');
  const base = geom.viewBox;
  let vb = [...base];

  const setVB = () => svg.setAttribute('viewBox', vb.map(n => n.toFixed(2)).join(' '));
  const clamp = () => {
    const minW = base[2] / 8;
    vb[2] = Math.min(base[2], Math.max(minW, vb[2]));
    vb[3] = vb[2] * base[3] / base[2];
    vb[0] = Math.max(base[0], Math.min(base[0] + base[2] - vb[2], vb[0]));
    vb[1] = Math.max(base[1], Math.min(base[1] + base[3] - vb[3], vb[1]));
  };
  const toSvg = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    return [vb[0] + (cx - r.left) / (r.width || 1) * vb[2], vb[1] + (cy - r.top) / (r.height || 1) * vb[3]];
  };
  const zoomAt = (cx, cy, factor) => {
    const [ax, ay] = toSvg(cx, cy);
    const rx = (ax - vb[0]) / vb[2], ry = (ay - vb[1]) / vb[3];
    vb[2] /= factor; vb[3] = vb[2] * base[3] / base[2];
    vb[0] = ax - rx * vb[2]; vb[1] = ay - ry * vb[3];
    clamp(); setVB();
  };
  // fit a projected bounding box (padded) into the view, keeping base aspect
  const fitTo = (xs, ys, padFrac = 0.4) => {
    let minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    let w = Math.max(maxx - minx, (maxy - miny) * base[2] / base[3]) * (1 + padFrac);
    w = Math.max(base[2] / 8, w);
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    vb = [cx - w / 2, cy - w * base[3] / base[2] / 2, w, w * base[3] / base[2]];
    clamp(); setVB();
  };

  // --- selection + info ---
  const clearSel = () => { while (overlay.firstChild) overlay.removeChild(overlay.firstChild); };
  const selectCorner = (c) => {
    clearSel();
    overlay.appendChild(svgNode('circle', { cx: c.xy[0], cy: c.xy[1], r: 26, class: 'dt-sel-ring' }));
    fitTo([c.xy[0]], [c.xy[1]], 3);   // zoom toward the corner
    // widen a touch so the corner isn't pinned dead-centre at max zoom
    vb[2] = Math.min(base[2], base[2] / 3.2); vb[3] = vb[2] * base[3] / base[2];
    vb[0] = c.xy[0] - vb[2] / 2; vb[1] = c.xy[1] - vb[3] / 2; clamp(); setVB();
    info.className = 'dt-map-info';
    info.innerHTML = `<span class="dt-mi-tag" style="background:${speedColor(1)}">T${c.number}</span>
      <span class="dt-mi-main">${fmtSpeed(c.speedKmh)} <i>${L('kmh')}</i></span>
      <span class="dt-mi-sub">${L('cornerWord')} · ${Math.round(c.turnDeg)}° ${L('turn')} · S${c.sector + 1} · ${L('fromStart')} ${fmtDist(c.distanceM)}</span>`;
  };
  const selectSector = (i) => {
    clearSel();
    const segs = geom.segments.filter(s => s.sector === i);
    if (!segs.length) return;
    for (const s of segs) {
      overlay.appendChild(svgNode('line', {
        x1: s.p1[0], y1: s.p1[1], x2: s.p2[0], y2: s.p2[1], class: 'dt-sel-seg',
      }));
    }
    fitTo(segs.flatMap(s => [s.p1[0], s.p2[0]]), segs.flatMap(s => [s.p1[1], s.p2[1]]));
    const sec = data.sectors[i];
    info.className = 'dt-map-info';
    const stopTxt = sec.stopCount ? ` · 🚦 ${sec.stopCount} · ${fmtDuration(sec.stoppedMs)}` : '';
    info.innerHTML = `<span class="dt-mi-tag dt-mi-${sec.color || 'none'}">S${i + 1}</span>
      <span class="dt-mi-main">${fmtTime(sec.timeMs)}</span>
      <span class="dt-mi-sub">${L('avg')} ${fmtSpeed(sec.avgKmh)} · ${L('max')} ${fmtSpeed(sec.maxKmh)} ${L('kmh')} · ${fmtDist(sec.distanceM)}${stopTxt}</span>`;
  };

  const handleTap = (cx, cy) => {
    const [sx, sy] = toSvg(cx, cy);
    let bestC = null, bcd = Infinity;
    for (const c of geom.corners) {
      const d = Math.hypot(c.xy[0] - sx, c.xy[1] - sy);
      if (d < bcd) { bcd = d; bestC = c; }
    }
    if (bestC && bcd <= 34) { selectCorner(bestC); return; }
    // else nearest segment → its sector
    let bestS = null, bsd = Infinity;
    for (const s of geom.segments) {
      const mx = (s.p1[0] + s.p2[0]) / 2, my = (s.p1[1] + s.p2[1]) / 2;
      const d = Math.hypot(mx - sx, my - sy);
      if (d < bsd) { bsd = d; bestS = s; }
    }
    if (bestS) selectSector(bestS.sector);
  };

  // --- gestures ---
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  const pts = new Map();
  let drag = null, pinch = null, moved = 0;
  svg.style.touchAction = 'none';
  svg.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (pts.size === 1) drag = { cx: e.clientX, cy: e.clientY, vb: [...vb] };
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], vb: [...vb] };
      drag = null;
    }
    try { svg.setPointerCapture?.(e.pointerId); } catch { /* optional */ }
  });
  const onMove = e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
    const r = svg.getBoundingClientRect();
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const factor = dist / pinch.d;
      const srx = (pinch.mid[0] - r.left) / (r.width || 1), sry = (pinch.mid[1] - r.top) / (r.height || 1);
      const anchorX = pinch.vb[0] + srx * pinch.vb[2], anchorY = pinch.vb[1] + sry * pinch.vb[3];
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const crx = (mid[0] - r.left) / (r.width || 1), cry = (mid[1] - r.top) / (r.height || 1);
      const w = pinch.vb[2] / factor;
      vb = [anchorX - crx * w, anchorY - cry * w * base[3] / base[2], w, w * base[3] / base[2]];
      clamp(); setVB();
    } else if (drag && pts.size === 1) {
      vb[0] = drag.vb[0] - (e.clientX - drag.cx) / (r.width || 1) * drag.vb[2];
      vb[1] = drag.vb[1] - (e.clientY - drag.cy) / (r.height || 1) * drag.vb[3];
      clamp(); setVB();
    }
  };
  const onUp = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      if (moved < 6) handleTap(e.clientX, e.clientY);   // a tap, not a drag
      drag = null;
    }
  };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);

  // --- zoom buttons ---
  const center = () => {
    const r = svg.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  section.querySelector('[data-zoom="in"]')?.addEventListener('click', () => zoomAt(...center(), 1.6));
  section.querySelector('[data-zoom="out"]')?.addEventListener('click', () => zoomAt(...center(), 1 / 1.6));
  section.querySelector('[data-zoom="reset"]')?.addEventListener('click', () => {
    vb = [...base]; setVB(); clearSel();
    info.className = 'dt-map-info dt-map-info-empty';
    info.textContent = L('tapPrompt');
  });
}

// ---- overlay control ----

let wired = false;
let lastArgs = null;

function ensureWired() {
  if (wired) return;
  const overlay = document.getElementById('detail-overlay');
  if (!overlay) return;
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('.dt-close')) hideDetail();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.hidden) hideDetail();
  });
  // Re-render in the new language if it changes while the sheet is open.
  document.addEventListener('languagechange', () => {
    if (!overlay.hidden && lastArgs) {
      renderDetail(overlay.querySelector('.dt-host'), buildDetailData(lastArgs.route, lastArgs.record, lastArgs.runs));
    }
  });
  wired = true;
}

export function showDetail(route, record, runs) {
  ensureWired();
  const overlay = document.getElementById('detail-overlay');
  if (!overlay) return;
  const host = overlay.querySelector('.dt-host');
  lastArgs = { route, record, runs };
  renderDetail(host, buildDetailData(route, record, runs));
  overlay.hidden = false;
  overlay.scrollTop = 0;
}

export function hideDetail() {
  const overlay = document.getElementById('detail-overlay');
  if (overlay) overlay.hidden = true;
}
