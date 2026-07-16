// Post-run DETAIL analysis — a deep, professional telemetry sheet that opens
// from the summary card. Everything above `renderDetail` is pure (no DOM), so
// the analysis imports straight into `node --test`.
//
// The detail sheet answers four questions the summary card can't:
//   1. How fast was each sector, and where did the lap actually spend its time?
//   2. Where did the driver stop (lights, junctions), and for how long?
//   3. Against every previous lap: which sectors got faster, which got slower?
//   4. What is the theoretical best (ideal lap) and how much time is on the table?
//
// The raw material is `record.actualTrace`. New laps store timestamped fixes as
// [lat, lng, t]; older laps stored only [lat, lng]. Speed profiles and stops
// need the timestamps, so those views degrade gracefully to "unavailable" for
// legacy laps, while the sector/comparison analysis (derived from sectorTimes
// and the route geometry) always works.

import { haversine, cumulativeDistances, projectOnRoute, pointAtDistance } from './geo.js';
import { classifySector, fmtTime, fmtDelta } from './timing.js';
import { fmtLap } from './summary.js';

// A GPS segment slower than this is treated as "stopped" (≈2.9 km/h — covers the
// creep at a red light without flagging a slow crawl as a full stop).
const STOP_SPEED_MPS = 0.8;
// A stop must last at least this long to be reported (filters a momentary GPS dip).
const STOP_MIN_MS = 3000;
// A trace segment faster than this is GPS noise, not a real speed; excluded from
// max-speed so a single bad fix can't invent a 300 km/h peak.
const NOISE_MAX_MPS = 60;
// A stop is attributed to a light when the nearest light is within this radius.
const LIGHT_NEAR_M = 45;

// ---- small formatters ----

export function fmtSpeed(kmh) {
  if (kmh == null || !Number.isFinite(kmh)) return '--';
  return kmh.toFixed(1);
}

// "1.2 km" / "340 m" — human distance.
export function fmtDist(m) {
  if (m == null || !Number.isFinite(m)) return '--';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

// "12.4 s" / "1:07" — a stopped/elapsed duration in the friendliest unit.
export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
}

const mps2kmh = mps => mps * 3.6;

// ---- geometry ----

// The N+1 sectors as distance spans along the route. `sectorBoundaries` are
// meters-from-start (exclusive of 0 and total); the last sector runs to `total`.
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

// Does the trace carry per-fix timestamps? New laps do ([lat,lng,t]); legacy
// laps don't ([lat,lng]). Requires at least two timed points to mean anything.
export function traceHasTime(trace) {
  return Array.isArray(trace) && trace.length >= 2 &&
    trace.every(p => Array.isArray(p) && p.length >= 3 && Number.isFinite(p[2]));
}

// Per-segment speed samples along a timestamped trace. Each sample is the leg
// between two consecutive fixes: its midpoint progress along the route, its
// speed, and how long/far it took. Off-route fixes still contribute distance
// (they were still driving), projected to their nearest point on the route.
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

// Roll speed samples up per sector: average (distance/time, so it matches the
// sector split) and a noise-filtered maximum.
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

// Clusters of consecutive near-stationary fixes, each lasting at least
// STOP_MIN_MS. Returns { atM (progress), point, durationM s, tStart } per stop.
export function detectStops(trace, points, cum,
                            { stopSpeed = STOP_SPEED_MPS, minMs = STOP_MIN_MS } = {}) {
  if (!traceHasTime(trace)) return [];
  const stops = [];
  let run = null;   // { startIdx, endIdx, durationMs }
  const flush = () => {
    if (run && run.durationMs >= minMs) {
      const p = trace[run.startIdx];
      const pr = points && points.length >= 2 ? projectOnRoute([p[0], p[1]], points, cum) : null;
      stops.push({
        atM: pr ? pr.progress : null,
        point: [p[0], p[1]],
        durationMs: run.durationMs,
        tStart: p[2],
      });
    }
    run = null;
  };
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    const dtMs = b[2] - a[2];
    if (!(dtMs > 0)) continue;
    const distM = haversine([a[0], a[1]], [b[0], b[1]]);
    const stopped = distM / (dtMs / 1000) < stopSpeed;
    if (stopped) {
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

// Nearest traffic light to a point, and its (1-based) index, if within radiusM.
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

// Bests reference across comparable runs, computed EXCLUDING `record` — so a
// sector is "purple" only when this lap beat every *previous* lap, matching how
// the live board classifies before the run is merged into the bests.
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
    sessionTotal: (() => { const ts = today.map(r => r.totalTime).filter(t => t != null); return ts.length ? Math.min(...ts) : null; })(),
  };
}

// Build the entire detail model. `record` is the just-finished lap; `runs` is
// every stored run for the route (already includes `record`).
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

  // Attribute each stop to its sector + nearest light, and tag its distance.
  const stopsDetailed = stops.map(s => {
    const span = spans.find(sp => s.atM != null && s.atM >= sp.startM && s.atM < sp.endM) ?? spans[spans.length - 1];
    return {
      ...s,
      sectorIndex: span ? span.index : null,
      light: nearestLight(s.point, route.lights),
    };
  });

  // Per-sector breakdown.
  const sectors = spans.map((span, i) => {
    const timeMs = record.sectorTimes?.[i] ?? null;
    const prevAll = bests.allSectors(i);
    const prevSession = bests.sessionSectors(i);
    const color = timeMs != null ? classifySector(timeMs, prevAll, prevSession) : null;
    const sp = hasTelemetry ? sectorSpeed(samples, span) : { avgKmh: null, maxKmh: null };
    // Fallback average speed straight from the sector split (always available).
    const splitAvgKmh = timeMs > 0 ? mps2kmh(span.distanceM / (timeMs / 1000)) : null;
    const sectorStops = stopsDetailed.filter(s => s.sectorIndex === i);
    return {
      index: i,
      label: `S${i + 1}`,
      distanceM: span.distanceM,
      pctOfLap: totalDistanceM > 0 ? span.distanceM / totalDistanceM : 0,
      timeMs,
      color,
      bestMs: prevAll != null ? Math.min(prevAll, timeMs ?? Infinity) : timeMs,
      prevBestMs: prevAll,
      deltaVsBestMs: prevAll != null && timeMs != null ? timeMs - prevAll : null,
      isRecord: color === 'purple' && prevAll != null,        // beat a previous best
      isFirst: prevAll == null,                                // no prior lap to compare
      avgKmh: sp.avgKmh ?? splitAvgKmh,
      splitAvgKmh,
      maxKmh: sp.maxKmh,
      stops: sectorStops,
      stopCount: sectorStops.length,
      stoppedMs: sectorStops.reduce((a, s) => a + s.durationMs, 0),
    };
  });

  // Ideal / theoretical-best lap: sum of each sector's best-ever time (incl this
  // lap). Time lost is how far this lap sits above that ceiling.
  const idealSectors = spans.map((_, i) => {
    const mine = record.sectorTimes?.[i];
    const prev = bests.allSectors(i);
    const vals = [mine, prev].filter(t => t != null);
    return vals.length ? Math.min(...vals) : null;
  });
  const idealTotalMs = idealSectors.every(t => t != null)
    ? idealSectors.reduce((a, t) => a + t, 0) : null;
  const timeLostVsIdealMs = idealTotalMs != null && record.totalTime != null
    ? record.totalTime - idealTotalMs : null;

  // Overall speed stats.
  const totalStoppedMs = stopsDetailed.reduce((a, s) => a + s.durationMs, 0);
  const movingMs = record.totalTime != null ? record.totalTime - totalStoppedMs : null;
  const overall = {
    distanceM: totalDistanceM,
    totalTimeMs: record.totalTime,
    avgKmh: record.totalTime > 0 ? mps2kmh(totalDistanceM / (record.totalTime / 1000)) : null,
    movingAvgKmh: hasTelemetry && movingMs > 0 ? mps2kmh(totalDistanceM / (movingMs / 1000)) : null,
    maxKmh: sectors.reduce((m, s) => s.maxKmh != null && s.maxKmh > m ? s.maxKmh : m, 0) || null,
    stopCount: stopsDetailed.length,
    totalStoppedMs,
  };

  // Multi-lap comparison: previous laps ranked most-recent-first, each with a
  // per-sector delta vs this lap (negative = this lap was faster there).
  const others = comparable.filter(r => r.id !== record.id)
    .slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const compare = others.map(r => ({
    id: r.id,
    date: r.date,
    simulated: r.simulated === true,
    totalTime: r.totalTime,
    totalDeltaMs: r.totalTime != null && record.totalTime != null ? record.totalTime - r.totalTime : null,
    sectorTimes: spans.map((_, i) => r.sectorTimes?.[i] ?? null),
    sectorDeltas: spans.map((_, i) => {
      const mine = record.sectorTimes?.[i], theirs = r.sectorTimes?.[i];
      return mine != null && theirs != null ? mine - theirs : null;
    }),
  }));

  // Rank of this lap among all comparable laps (1 = fastest).
  const rank = comparable.filter(r => r.totalTime != null && record.totalTime != null &&
    r.totalTime < record.totalTime).length + 1;

  return {
    route,
    record,
    hasTelemetry,
    sectorCount: n,
    sectors,
    overall,
    stops: stopsDetailed,
    ideal: { sectors: idealSectors, totalMs: idealTotalMs, timeLostVsIdealMs },
    compare,
    prev: compare[0] ?? null,
    rank,
    lapCount: comparable.length,
    disqualified: record.disqualified === true,
    conformance: record.conformance,
    simulated: record.simulated === true,
    date: record.date,
    isPB: !record.disqualified && (bests.allTotal == null ||
      (record.totalTime != null && record.totalTime <= bests.allTotal)),
    prevBestTotalMs: bests.allTotal,
    deltaVsBestTotalMs: bests.allTotal != null && record.totalTime != null
      ? record.totalTime - bests.allTotal : null,
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

// A signed delta with an explicit faster/slower sign, for cells that compare
// two times. Returns { text, cls }.
function deltaCell(ms) {
  if (ms == null) return { text: '—', cls: 'flat' };
  if (Math.abs(ms) < 0.5) return { text: '±0.000', cls: 'flat' };
  const faster = ms < 0;
  return {
    text: `${faster ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`,
    cls: faster ? 'faster' : 'slower',
  };
}

// A horizontal bar (0..1) for the sector time-share / speed visualisations.
function bar(fraction, cls) {
  const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return `<span class="dt-bar ${cls}"><span class="dt-bar-fill" style="width:${pct.toFixed(1)}%"></span></span>`;
}

// Speed profile: an SVG area chart of speed vs distance along the lap, with
// sector-boundary gridlines and stop markers.
function speedProfileSvg(data) {
  const samples = data.hasTelemetry
    ? computeSpeedSamples(data.record.actualTrace, data.route.points,
        data.route.cum ?? cumulativeDistances(data.route.points))
    : [];
  const total = data.overall.distanceM || 1;
  const pts = samples.filter(s => s.atM != null && s.speedMps <= NOISE_MAX_MPS)
    .map(s => ({ x: s.atM / total, v: mps2kmh(s.speedMps) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2) return '';
  const W = 1000, H = 260, padB = 4;
  const vmax = Math.max(20, ...pts.map(p => p.v)) * 1.1;
  const X = x => x * W;
  const Y = v => H - padB - (v / vmax) * (H - padB);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${X(pts.at(-1).x).toFixed(1)},${H} L${X(pts[0].x).toFixed(1)},${H} Z`;

  // sector boundary gridlines
  const spans = sectorSpans({ ...data.route, cum: data.route.cum ?? cumulativeDistances(data.route.points) });
  const grid = spans.slice(1).map(sp =>
    `<line x1="${X(sp.startM / total).toFixed(1)}" y1="0" x2="${X(sp.startM / total).toFixed(1)}" y2="${H}" class="dt-grid"/>`).join('');
  const stopMarks = data.stops.filter(s => s.atM != null).map(s =>
    `<line x1="${X(s.atM / total).toFixed(1)}" y1="0" x2="${X(s.atM / total).toFixed(1)}" y2="${H}" class="dt-stopmark"/>`).join('');

  return `<svg class="dt-profile-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Speed profile">
    ${grid}
    <path d="${area}" class="dt-profile-area"/>
    <path d="${line}" class="dt-profile-line" fill="none"/>
    ${stopMarks}
  </svg>`;
}

function sectorRow(s, maxTime, maxSpeed) {
  const cls = s.color ? `dt-${s.color}` : 'dt-none';
  const d = deltaCell(s.deltaVsBestMs);
  const tag = s.isFirst ? '<span class="dt-tag dt-tag-new">FIRST</span>'
    : s.isRecord ? '<span class="dt-tag dt-tag-pb">BEST</span>' : '';
  const stopBadge = s.stopCount
    ? `<span class="dt-stopbadge" title="停等">🛑 ${s.stopCount} · ${fmtDuration(s.stoppedMs)}</span>` : '';
  return `<div class="dt-srow ${cls}">
    <div class="dt-srow-head">
      <span class="dt-slabel">${esc(s.label)} ${tag}</span>
      <span class="dt-stime">${fmtTime(s.timeMs)}</span>
      <span class="dt-sdelta ${d.cls}">${d.text}</span>
    </div>
    <div class="dt-srow-bar">${bar(maxTime ? (s.timeMs || 0) / maxTime : 0, `fill-${s.color || 'none'}`)}</div>
    <div class="dt-srow-meta">
      <span><b>${fmtSpeed(s.avgKmh)}</b> <i>km/h avg</i></span>
      <span><b>${fmtSpeed(s.maxKmh)}</b> <i>max</i></span>
      <span><b>${fmtDist(s.distanceM)}</b> <i>${(s.pctOfLap * 100).toFixed(0)}% 賽段</i></span>
      ${stopBadge}
    </div>
  </div>`;
}

function comparisonTable(data) {
  if (!data.compare.length) {
    return `<p class="dt-empty">這是這條路線的第一筆有效紀錄，之後再跑就能在這裡比較每一段的快慢。<br>
      <span class="dt-empty-en">First clean lap on this route — future laps compare here.</span></p>`;
  }
  const spans = data.sectors;
  const head = `<tr><th>LAP · 圈</th>${spans.map(s => `<th>${esc(s.label)}</th>`).join('')}<th>TOTAL</th></tr>`;
  // this lap row
  const thisRow = `<tr class="dt-row-this">
    <td class="dt-lapname">THIS · 本圈</td>
    ${data.sectors.map(s => `<td class="dt-t dt-${s.color || 'none'}">${fmtTime(s.timeMs)}</td>`).join('')}
    <td class="dt-t dt-total">${fmtTime(data.record.totalTime)}</td>
  </tr>`;
  const rows = data.compare.slice(0, 6).map(r => {
    const dt = deltaCell(r.totalDeltaMs);
    return `<tr>
      <td class="dt-lapname">${esc(shortDateTime(r.date))}${r.simulated ? ' <span class="dt-sim">sim</span>' : ''}</td>
      ${r.sectorDeltas.map(dms => { const c = deltaCell(dms); return `<td class="dt-d ${c.cls}">${c.text}</td>`; }).join('')}
      <td class="dt-d dt-total ${dt.cls}">${dt.text}</td>
    </tr>`;
  }).join('');
  return `<div class="dt-table-scroll"><table class="dt-table">
    <thead>${head}</thead>
    <tbody>${thisRow}${rows}</tbody>
  </table></div>
  <p class="dt-tablenote">數字為<strong>本圈相對於該圈</strong>的差距：<span class="faster">綠色−</span> 表示本圈較快，<span class="slower">紅色＋</span> 表示較慢。</p>`;
}

function stopsSection(data) {
  if (!data.hasTelemetry) {
    return `<p class="dt-empty">這筆紀錄沒有逐點時間資料，無法重建停等點。<br>
      <span class="dt-empty-en">This lap predates telemetry capture — stop detection unavailable. New laps record it automatically.</span></p>`;
  }
  if (!data.stops.length) {
    return `<p class="dt-clean">🟢 全程沒有偵測到停等 — 一氣呵成。<br>
      <span class="dt-empty-en">No stops detected — a clean, flowing lap.</span></p>`;
  }
  const total = data.overall.distanceM || 1;
  const items = data.stops.map((s, i) => {
    const where = s.light ? `🚦 紅綠燈 #${s.light.index}` : (s.sectorIndex != null ? `S${s.sectorIndex + 1} 路段` : '路段');
    return `<div class="dt-stop">
      <span class="dt-stop-n">${i + 1}</span>
      <div class="dt-stop-body">
        <div class="dt-stop-top"><span class="dt-stop-where">${where}</span><span class="dt-stop-dur">${fmtDuration(s.durationMs)}</span></div>
        <div class="dt-stop-sub">距起點 ${fmtDist(s.atM)} · ${((s.atM ?? 0) / total * 100).toFixed(0)}% 賽程</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="dt-stop-summary">共 <b>${data.overall.stopCount}</b> 次停等，合計 <b>${fmtDuration(data.overall.totalStoppedMs)}</b>
    （占全程 ${data.record.totalTime ? (data.overall.totalStoppedMs / data.record.totalTime * 100).toFixed(0) : '0'}%）</div>
    <div class="dt-stops">${items}</div>`;
}

function statTile(value, unit, label) {
  return `<div class="dt-tile">
    <div class="dt-tile-val">${esc(value)}<span class="dt-tile-unit">${esc(unit)}</span></div>
    <div class="dt-tile-label">${esc(label)}</div>
  </div>`;
}

export function renderDetail(container, data) {
  const maxTime = Math.max(0, ...data.sectors.map(s => s.timeMs || 0)) || 1;
  const badge = data.disqualified
    ? `<span class="dt-badge dt-badge-dsq">DSQ · 符合度 ${Math.round((data.conformance ?? 0) * 100)}%</span>`
    : data.isPB
      ? `<span class="dt-badge dt-badge-pb">PERSONAL BEST · P${data.rank}</span>`
      : `<span class="dt-badge">P${data.rank} / ${data.lapCount} · ${deltaCell(data.deltaVsBestTotalMs).text} vs PB</span>`;

  const ideal = data.ideal.totalMs != null
    ? `<div class="dt-ideal">
        <div class="dt-ideal-head">
          <span class="dt-ideal-title">IDEAL LAP · 理論最速圈</span>
          <span class="dt-ideal-time">${fmtLap(data.ideal.totalMs)}</span>
        </div>
        <div class="dt-ideal-sub">
          由每段的歷史最速拼成。本圈 ${fmtLap(data.record.totalTime)} ·
          可再進步 <b class="slower">${data.ideal.timeLostVsIdealMs != null ? '+' + (data.ideal.timeLostVsIdealMs / 1000).toFixed(3) : '—'}</b>
          <span class="dt-empty-en">Sum of your best-ever sectors. Time on the table shown in red.</span>
        </div>
      </div>`
    : '';

  const profile = data.hasTelemetry ? speedProfileSvg(data) : '';
  const profileSection = profile
    ? `<section class="dt-sec">
        <h3 class="dt-h">SPEED PROFILE · 速度曲線</h3>
        <div class="dt-profile">${profile}
          <div class="dt-profile-axis"><span>起點 START</span><span>終點 FINISH</span></div>
        </div>
      </section>`
    : `<section class="dt-sec"><h3 class="dt-h">SPEED PROFILE · 速度曲線</h3>
        <p class="dt-empty">此圈無逐點時間資料，無法繪製速度曲線。<span class="dt-empty-en">Legacy lap — no per-fix timing.</span></p></section>`;

  container.innerHTML = `
    <article class="dt-sheet${data.disqualified ? ' dt-sheet-dsq' : ''}">
      <header class="dt-head">
        <div class="dt-head-top">
          <div class="dt-kicker">TELEMETRY · 詳細數據${data.simulated ? ' · SIM' : ''}</div>
          ${badge}
        </div>
        <h2 class="dt-title">${esc(data.route.name || 'UNNAMED ROUTE')}</h2>
        <div class="dt-subtitle">${esc(shortDateTime(data.date))} · ${data.sectorCount} sectors · ${fmtDist(data.overall.distanceM)}</div>
        <div class="dt-laptime">
          <span class="dt-laptime-val">${fmtLap(data.record.totalTime)}</span>
          <span class="dt-laptime-lbl">LAP TIME</span>
        </div>
      </header>

      <section class="dt-tiles">
        ${statTile(fmtSpeed(data.overall.avgKmh), ' km/h', '平均速度 AVG SPEED')}
        ${statTile(fmtSpeed(data.overall.maxKmh), ' km/h', '最高速度 TOP SPEED')}
        ${statTile(data.hasTelemetry ? fmtSpeed(data.overall.movingAvgKmh) : '--', ' km/h', '行進均速 MOVING AVG')}
        ${statTile(String(data.overall.stopCount), '', '停等次數 STOPS')}
        ${statTile(fmtDuration(data.overall.totalStoppedMs), '', '停等時間 STOPPED')}
        ${statTile(Math.round((data.conformance ?? 1) * 100) + '', '%', '符合度 CONFORMANCE')}
      </section>

      ${ideal}

      <section class="dt-sec">
        <h3 class="dt-h">SECTOR ANALYSIS · 分段分析</h3>
        <div class="dt-legend">
          <span class="dt-lg dt-purple">紫 新最速</span>
          <span class="dt-lg dt-green">綠 時段最速</span>
          <span class="dt-lg dt-yellow">黃 較慢</span>
        </div>
        <div class="dt-sectors">${data.sectors.map(s => sectorRow(s, maxTime)).join('')}</div>
      </section>

      ${profileSection}

      <section class="dt-sec">
        <h3 class="dt-h">STOPS · 停等紀錄</h3>
        ${stopsSection(data)}
      </section>

      <section class="dt-sec">
        <h3 class="dt-h">LAP-BY-LAP · 逐圈比較</h3>
        ${comparisonTable(data)}
      </section>

      <footer class="dt-foot">Commute Qualifying · 詳細遙測 / detailed telemetry</footer>
    </article>`;
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
  host.scrollTop = 0;
}

export function hideDetail() {
  const overlay = document.getElementById('detail-overlay');
  if (overlay) overlay.hidden = true;
}
