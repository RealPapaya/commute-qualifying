// Post-run summary: an F1-style circuit info card.
// Layout, type scale and colours are traced from the official F1 circuit card
// (see test/summary-fixture.html, which reproduces the reference 1:1).
//
// Geometry is expressed against a 224px-wide card via --u, so the whole card
// scales with one custom property and never needs a second set of numbers.
import { cumulativeDistances } from './geo.js';
import { computeProjection, detectCorners } from './trackDiagram.js';
import { allTimeBests } from './store.js';

const NS = 'http://www.w3.org/2000/svg';

// The card's track panel is 181x168 css px; match that aspect so the projection
// fills it without letterboxing. Pad leaves room for corner numbers.
const TRACK_W = 1000, TRACK_H = 928, TRACK_PAD = 52;
const TRACK_STROKE = 17;
const CORNER_OFFSET = 36;    // how far a corner number sits off the racing line
const START_TICK_LEN = 46;
const START_TICK_W = 13;

// ---- pure formatting ----

// "15:30" — minutes:seconds, for commute-length durations.
export function fmtClock(ms) {
  if (ms == null) return '--:--';
  const t = Math.round(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// "1:19.813" — F1 lap-time notation.
export function fmtLap(ms) {
  if (ms == null) return '--:--.---';
  const total = Math.round(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export function fmtKm(metres) {
  return `${(metres / 1000).toFixed(3)}KM`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Formula1 Display draws a slashed zero and our substitute face does not, so
// every 0 is wrapped and CSS strikes it through. Escape first — this emits HTML.
function numHtml(text) {
  return esc(text).replace(/0/g, '<span class="f1c-zero">0</span>');
}

function shortDate(iso) {
  const d = new Date(iso);
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
               'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  return `${d.getDate()} ${mon}`;
}

// Split a route name onto (at most) two lines the way "ADELAIDE / STREET
// CIRCUIT" wraps: break at the midpoint word boundary, longest line first.
export function splitTitle(name) {
  // `|| fallback` is not enough: a whitespace-only name is truthy but yields
  // no words, which would render an empty header.
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['UNNAMED', 'ROUTE'];
  if (words.length === 1) return [words[0], ''];
  let best = 1, bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    const score = Math.abs(a - b);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

// ---- data ----

// `record` is the run just saved; `runs` is every run stored for this route
// (store.saveRun has already appended `record`, so it is included here).
export function buildSummaryData(route, record, runs) {
  const lengthM = cumulativeDistances(route.points).at(-1);
  // Disqualified laps (strayed too far off the route) are not valid times, so
  // they never feed lap counts, ranking or the fastest-lap stat.
  const disqualified = record.disqualified === true;
  const done = runs.filter(r => r.completed && !r.disqualified);
  const comparable = done.filter(r => r.timingVersion === route.timingVersion);

  const best = allTimeBests(route.id, route.sectorBoundaries.length + 1,
                            route.timingVersion).total;
  const isPB = !disqualified && best != null && record.totalTime <= best;
  // Rank this run against every comparable run, including itself.
  const rank = comparable.filter(r => r.totalTime < record.totalTime).length + 1;
  const firstYear = done.length
    ? new Date(Math.min(...done.map(r => +new Date(r.date)))).getFullYear()
    : new Date(record.date).getFullYear();

  const [line1, line2] = splitTitle(route.name);
  return {
    eyebrow: 'QUALIFYING',
    title1: line1,
    title2: line2,
    route,
    lengthM,
    firstYear,
    laps: done.length,
    fastest: best,
    raceDistanceM: lengthM * done.length,
    round: comparable.length,
    date: shortDate(record.date),
    tag: line1,
    myTime: record.totalTime,
    trackTime: best,
    rank,
    isPB,
    disqualified,
    conformance: record.conformance,
    badge: disqualified ? {
      num: 'DSQ',
      l1: `符合度 ${Math.round((record.conformance ?? 0) * 100)}%`,
      l2: '取消資格',
    } : {
      num: `P${rank}`,
      l1: isPB || best == null ? 'PERSONAL' : `+${((record.totalTime - best) / 1000).toFixed(3)}`,
      l2: isPB || best == null ? 'BEST' : 'OFF PB',
    },
  };
}

// ---- track drawing ----

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function trackSvg(route) {
  const points = route.points || [];
  const svg = svgEl('svg', {
    viewBox: `0 0 ${TRACK_W} ${TRACK_H}`,
    preserveAspectRatio: 'xMidYMid meet',
    class: 'f1c-track-svg',
  });
  if (points.length < 2) return svg;

  const { project } = computeProjection(points, {
    width: TRACK_W, height: TRACK_H, pad: TRACK_PAD,
  });
  const xy = points.map(project);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  svg.appendChild(svgEl('path', {
    d, fill: 'none', stroke: '#15151e', 'stroke-width': TRACK_STROKE,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));

  // start/finish tick: perpendicular to the opening leg, in F1 red
  const [x1, y1] = xy[0];
  const [x2, y2] = xy[1];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const px = -(y2 - y1) / len, py = (x2 - x1) / len;
  svg.appendChild(svgEl('line', {
    x1: x1 - px * START_TICK_LEN / 2, y1: y1 - py * START_TICK_LEN / 2,
    x2: x1 + px * START_TICK_LEN / 2, y2: y1 + py * START_TICK_LEN / 2,
    stroke: '#e10600', 'stroke-width': START_TICK_W, 'stroke-linecap': 'butt',
  }));

  for (const c of detectCorners(points)) {
    const [cx, cy] = project(c.point);
    const t = svgEl('text', {
      x: (cx + c.outward[0] * CORNER_OFFSET).toFixed(1),
      y: (cy + c.outward[1] * CORNER_OFFSET).toFixed(1),
      class: 'f1c-corner',
      'text-anchor': 'middle', 'dominant-baseline': 'central',
    });
    t.textContent = c.number;
    svg.appendChild(t);
  }
  return svg;
}

// ---- card ----

function statCell(label, valueText, big = false) {
  return `<div class="f1c-stat">
    <div class="f1c-stat-label">${esc(label)}</div>
    <div class="f1c-stat-value${big ? ' f1c-stat-value-big' : ''}">${numHtml(valueText)}</div>
  </div>`;
}

export function renderSummary(container, data) {
  const badge = data.badge;

  container.innerHTML = `
    <div class="f1c-card${data.disqualified ? ' f1c-dsq' : ''}">
      <div class="f1c-head">
        <div class="f1c-mark" aria-label="Commute Qualifying">CQ</div>
        <div class="f1c-head-text">
          <div class="f1c-eyebrow">${esc(data.eyebrow)}</div>
          <div class="f1c-title">${esc(data.title1)}<br>${esc(data.title2)}</div>
        </div>
      </div>

      <div class="f1c-track"></div>

      <div class="f1c-stats">
        ${statCell('CIRCUIT LENGTH', fmtKm(data.lengthM), true)}
        <div class="f1c-stat-row">
          ${statCell('FIRST GRAND PRIX', String(data.firstYear))}
          ${statCell('NUMBER OF LAPS', String(data.laps))}
        </div>
        <div class="f1c-stat-row">
          ${statCell('FASTEST LAP TIME', fmtLap(data.fastest))}
          ${statCell('RACE DISTANCE', fmtKm(data.raceDistanceM))}
        </div>
      </div>

      <div class="f1c-panel">
        <div class="f1c-bar">
          <span class="f1c-bar-round">ROUND ${esc(String(data.round))} · ${esc(data.date)}</span>
          <span class="f1c-bar-tag">${esc(data.tag)}</span>
        </div>
        <div class="f1c-panel-body">
          <div class="f1c-times">
            <div class="f1c-times-label">MY TIME</div>
            <div class="f1c-mytime">${numHtml(fmtClock(data.myTime))}</div>
            <div class="f1c-tracktime">
              <span class="f1c-times-label">TRACK TIME</span>
              <span class="f1c-tracktime-value">${numHtml(fmtClock(data.trackTime))}</span>
            </div>
          </div>
          <div class="f1c-badge${data.disqualified ? ' f1c-badge-dsq' : ''}">
            <div class="f1c-badge-num">${numHtml(badge.num)}</div>
            <div class="f1c-badge-team">${numHtml(badge.l1)}<br>${esc(badge.l2)}</div>
          </div>
        </div>
      </div>

      <button type="button" class="f1c-details">詳細數據 / DETAILS ›</button>
    </div>`;

  container.querySelector('.f1c-track').appendChild(trackSvg(data.route));
}

// ---- overlay ----

let onClose = null;
let lastShown = null;   // { route, record, runs } for the detail sheet

export function initSummary() {
  const overlay = document.getElementById('summary-overlay');
  overlay.addEventListener('click', e => {
    if (e.target.closest('.f1c-details')) {
      // Lazy-load the (heavier) detail analysis only when it's actually opened.
      if (lastShown) import('./detail.js').then(m =>
        m.showDetail(lastShown.route, lastShown.record, lastShown.runs));
      return;
    }
    if (e.target === overlay || e.target.closest('.f1c-close')) hideSummary();
  });
  document.addEventListener('keydown', e => {
    // When the detail sheet is stacked on top, let it consume Escape first.
    const detail = document.getElementById('detail-overlay');
    if (e.key === 'Escape' && !overlay.hidden && (!detail || detail.hidden)) hideSummary();
  });
}

export function showSummary(route, record, runs, closeCb) {
  const overlay = document.getElementById('summary-overlay');
  const host = overlay.querySelector('.f1c-host');
  lastShown = { route, record, runs };
  renderSummary(host, buildSummaryData(route, record, runs));
  overlay.hidden = false;
  onClose = closeCb ?? null;
}

export function hideSummary() {
  const overlay = document.getElementById('summary-overlay');
  overlay.hidden = true;
  onClose?.();
  onClose = null;
}
