// F1-circuit-style diagram of a traced route: stylized SVG, no map tiles.
// Pure geometry helpers (computeProjection, normalizeToViewBox,
// splitIntoSectors) do no DOM work and are node-testable; renderTrackDiagram
// builds the actual SVG into a container element.
import { cumulativeDistances, pointAtDistance, haversine } from './geo.js';

const VIEW_W = 1000, VIEW_H = 700, VIEW_PAD = 60;
const SECTOR_COLORS = ['#e10600', '#2979ff', '#ffd600']; // F1 S1 red / S2 blue / S3 yellow, cycled
const CASING_COLOR = '#2a2a36'; // matches css var(--border)
const TRACK_COLOR = '#f2f2f2';
const CASING_WIDTH = 13;
const TRACK_WIDTH = 7;
const LOOP_THRESHOLD_M = 30; // start ~= finish within this distance counts as a loop

// ---- pure geometry (no DOM) ----

// Equirectangular projection of [lat,lng] points onto a plane, then fit that
// plane into a fixed-size, padded viewBox while preserving aspect ratio.
// Returns { viewBox: [x,y,w,h], project(point) -> [x,y] }.
export function computeProjection(points, { width = VIEW_W, height = VIEW_H, pad = VIEW_PAD } = {}) {
  const meanLat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cosLat = Math.cos(meanLat * Math.PI / 180);
  const xs = points.map(p => p[1] * cosLat);
  const ys = points.map(p => -p[0]); // flip: increasing lat should go up (smaller SVG y)
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = (maxX - minX) || 1e-9;
  const spanY = (maxY - minY) || 1e-9;
  const innerW = width - 2 * pad, innerH = height - 2 * pad;
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const offX = pad + (innerW - spanX * scale) / 2;
  const offY = pad + (innerH - spanY * scale) / 2;
  const project = ([lat, lng]) => [
    offX + (lng * cosLat - minX) * scale,
    offY + (-lat - minY) * scale,
  ];
  return { viewBox: [0, 0, width, height], project };
}

// Convenience wrapper: project a whole point list at once.
export function normalizeToViewBox(points, opts) {
  const { viewBox, project } = computeProjection(points, opts);
  return { viewBox, points: points.map(project) };
}

// Split a route's points into per-sector polylines using sectorBoundaries
// (meters from start, reusing geo.js's cumulativeDistances/pointAtDistance).
// Adjacent segments share the interpolated split point so they draw with no
// visual gap. No boundaries (or all out of range) => a single segment.
export function splitIntoSectors(points, sectorBoundaries) {
  if (!points || points.length < 2) return points && points.length ? [points] : [];
  const cum = cumulativeDistances(points);
  const total = cum[cum.length - 1];
  const boundaries = [...(sectorBoundaries || [])]
    .filter(d => d > 0 && d < total)
    .sort((a, b) => a - b);
  if (boundaries.length === 0) return [points];

  const segments = [];
  let cursor = [points[0]];
  let bi = 0;
  for (let i = 1; i < points.length; i++) {
    while (bi < boundaries.length && boundaries[bi] < cum[i]) {
      const splitPt = pointAtDistance(points, cum, boundaries[bi]);
      cursor.push(splitPt);
      segments.push(cursor);
      cursor = [splitPt];
      bi++;
    }
    cursor.push(points[i]);
  }
  segments.push(cursor);
  return segments;
}

// ---- DOM rendering ----

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function pathD(pts) {
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

function startFinishTick(points, project, atIdx, dirIdx, label) {
  const [x1, y1] = project(points[atIdx]);
  const [x2, y2] = project(points[dirIdx]);
  let dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const px = -dy, py = dx; // perpendicular to the route direction
  const half = CASING_WIDTH * 0.9;
  const g = el('g', {});
  g.appendChild(el('line', {
    x1: x1 - px * half, y1: y1 - py * half,
    x2: x1 + px * half, y2: y1 + py * half,
    stroke: '#fff', 'stroke-width': 3,
  }));
  const t = el('text', {
    x: x1 + px * (half + 8), y: y1 + py * (half + 8), class: 'track-label-tick',
  });
  t.textContent = label;
  g.appendChild(t);
  return g;
}

// Build the stylized circuit SVG for `route` into `container` (a plain DOM
// element). Re-derives everything from route.points/sectorBoundaries/lights
// each call — cheap, no incremental state to keep in sync.
export function renderTrackDiagram(container, route, options = {}) {
  container.innerHTML = '';
  const points = route?.points || [];
  if (points.length < 2) return;
  const {
    showLights = false,
    showSectorCheckpoints = true,
    showSectorColors = true,
    currentDistance = null,
  } = options;

  const cum = cumulativeDistances(points);
  const total = cum.at(-1);
  const { viewBox, project } = computeProjection(points);
  const svg = el('svg', { viewBox: viewBox.join(' '), preserveAspectRatio: 'xMidYMid meet' });

  // dark casing: one continuous stroke under everything, so sector-color
  // seams never show a gap
  svg.appendChild(el('path', {
    d: pathD(points.map(project)),
    fill: 'none', stroke: CASING_COLOR, 'stroke-width': CASING_WIDTH,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));

  // sector-tinted top stroke, or one neutral stroke when color grouping is off
  const segments = showSectorColors ?
    splitIntoSectors(points, route.sectorBoundaries || []) :
    [points];
  segments.forEach((seg, i) => {
    svg.appendChild(el('path', {
      d: pathD(seg.map(project)),
      fill: 'none',
      stroke: showSectorColors ? SECTOR_COLORS[i % SECTOR_COLORS.length] : TRACK_COLOR,
      'stroke-width': TRACK_WIDTH,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
  });

  // start / finish ticks — commutes are point-to-point, so mark both unless
  // the route happens to loop back on itself
  const looped = haversine(points[0], points.at(-1)) < LOOP_THRESHOLD_M;
  svg.appendChild(startFinishTick(points, project, 0, 1, looped ? 'S/F' : 'START'));
  if (!looped) {
    svg.appendChild(startFinishTick(points, project, points.length - 1, points.length - 2, 'FINISH'));
  }

  if (showSectorCheckpoints) {
    const checkpoints = [...(route.sectorBoundaries || [])]
      .filter(d => d > 0 && d < total)
      .sort((a, b) => a - b);
    checkpoints.forEach((d, i) => {
      const [x, y] = project(pointAtDistance(points, cum, d));
      const g = el('g', { class: 'track-checkpoint' });
      g.appendChild(el('circle', {
        cx: x, cy: y, r: 9, fill: '#ffd600', stroke: '#000', 'stroke-width': 2,
      }));
      g.appendChild(el('circle', {
        cx: x, cy: y, r: 3.5, fill: '#111', stroke: '#fff', 'stroke-width': 1,
      }));
      const label = el('text', {
        x: x + 12, y: y - 10, class: 'track-label-checkpoint',
      });
      label.textContent = `CP${i + 1}`;
      g.appendChild(label);
      svg.appendChild(g);
    });
  }

  if (showLights) {
    (route.lights || []).forEach(p => {
      const [x, y] = project(p);
      svg.appendChild(el('circle', {
        cx: x, cy: y, r: 6, class: 'track-light-dot', fill: '#ffd600', stroke: '#000', 'stroke-width': 1.5,
      }));
    });
  }

  if (Number.isFinite(currentDistance)) {
    const d = Math.max(0, Math.min(total, currentDistance));
    const [x, y] = project(pointAtDistance(points, cum, d));
    const g = el('g', { class: 'track-player-marker' });
    g.appendChild(el('circle', {
      cx: x, cy: y, r: 15, class: 'track-player-halo', fill: '#00c853', opacity: 0.22,
    }));
    g.appendChild(el('circle', {
      cx: x, cy: y, r: 7, class: 'track-player-dot', fill: '#00c853', stroke: '#fff', 'stroke-width': 2,
    }));
    svg.appendChild(g);
  }

  // name + total distance, matching the editor's existing stats format
  const km = (total / 1000).toFixed(2);
  const nameText = el('text', { x: 24, y: 40, class: 'track-label-name' });
  nameText.textContent = route.name || 'Unnamed route';
  svg.appendChild(nameText);
  const statsText = el('text', { x: 24, y: 62, class: 'track-label-stats' });
  statsText.textContent = `${km} km`;
  svg.appendChild(statsText);

  container.appendChild(svg);
}
