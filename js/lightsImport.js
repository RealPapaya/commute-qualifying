// Auto-import traffic lights from OpenStreetMap (Overpass API) as the user
// traces/edits a route. Pure geometry filtering (testable under node) is kept
// separate from the fetch/debounce orchestration below it.
import { cumulativeDistances, projectOnRoute, haversine } from './geo.js';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const DEBOUNCE_MS = 1800; // wait for rebuilds to settle before querying
const FETCH_TIMEOUT_MS = 15000;
const BBOX_PAD_M = 100;
const NEAR_ROUTE_M = 25; // keep fetched lights within this of the polyline
const DEDUPE_M = 15;     // drop fetched lights this close to an existing one

// ---- pure helpers (node-testable, no fetch/DOM) ----

// Bounding box for a route's points, padded by padM meters on every side.
// Returns { south, west, north, east } — the order Overpass's node bbox
// filter expects.
export function computeBBox(points, padM = BBOX_PAD_M) {
  const lats = points.map(p => p[0]);
  const lngs = points.map(p => p[1]);
  const south = Math.min(...lats), north = Math.max(...lats);
  const west = Math.min(...lngs), east = Math.max(...lngs);
  const midLat = (south + north) / 2;
  const dLat = padM / 111320;
  const dLng = padM / (111320 * Math.cos(midLat * Math.PI / 180));
  return { south: south - dLat, west: west - dLng, north: north + dLat, east: east + dLng };
}

// Keep only Overpass nodes ({lat, lon}) within maxDistM of the route
// polyline. Returns [lat, lng] pairs.
export function filterNearRoute(nodes, routePoints, maxDistM = NEAR_ROUTE_M) {
  if (routePoints.length < 2) return [];
  const cum = cumulativeDistances(routePoints);
  const kept = [];
  for (const n of nodes) {
    const p = [n.lat, n.lon];
    const proj = projectOnRoute(p, routePoints, cum);
    if (proj && proj.offRoute <= maxDistM) kept.push(p);
  }
  return kept;
}

// Drop candidate lights within minDistM of an existing light (route.lights)
// or of each other, so repeated imports never pile up duplicates.
export function dedupeLights(candidates, existingLights, minDistM = DEDUPE_M) {
  const kept = [];
  for (const c of candidates) {
    const tooClose = existingLights.some(e => haversine(c, e) < minDistM) ||
      kept.some(k => haversine(c, k) < minDistM);
    if (!tooClose) kept.push(c);
  }
  return kept;
}

// Cheap signature of a route's geometry, used to skip re-importing when
// nothing has changed since the last successful fetch.
export function routeSignature(points) {
  if (!points || points.length < 2) return null;
  return JSON.stringify([points.length, points[0], points.at(-1)]);
}

// ---- Overpass fetch (impure) ----

async function fetchTrafficSignals(bbox, signal) {
  const query = `[out:json][timeout:10];node[highway=traffic_signals]` +
    `(${bbox.south},${bbox.west},${bbox.north},${bbox.east});out;`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();
  return data.elements ?? [];
}

// ---- orchestration: debounce + stale-response guard ----

let getRoute, onImported;
let debounceTimer = null;
let seq = 0; // stale-response guard, mirrors routeBuilder's buildSeq
let controller = null; // aborts an in-flight fetch superseded by a newer one
let lastImportKey = null; // routeId + geometry signature of the last success

// { getRoute, onImported, onAfterRebuild } — mirrors initRouteDrag's shape.
export function initLightsImport(opts) {
  ({ getRoute, onImported } = opts);
  opts.onAfterRebuild(scheduleImport);
}

function scheduleImport() {
  const route = getRoute();
  if (!route || route.points.length < 2) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runImport, DEBOUNCE_MS);
}

function importKey(route) {
  return `${route.id}|${routeSignature(route.points)}`;
}

async function runImport() {
  const route = getRoute();
  if (!route || route.points.length < 2) return;
  const key = importKey(route);
  if (key === lastImportKey) return; // geometry unchanged since last success

  controller?.abort(); // cancel any earlier in-flight import
  const myController = new AbortController();
  controller = myController;
  const mySeq = ++seq;
  const timeoutId = setTimeout(() => myController.abort(), FETCH_TIMEOUT_MS);

  try {
    const bbox = computeBBox(route.points);
    const nodes = await fetchTrafficSignals(bbox, myController.signal);
    if (mySeq !== seq) return; // a newer import superseded this one

    const current = getRoute();
    if (!current || current.points.length < 2) return;
    const near = filterNearRoute(nodes, current.points);
    const fresh = dedupeLights(near, current.lights);
    if (fresh.length) {
      current.lights.push(...fresh);
      onImported?.();
    }
    lastImportKey = importKey(current);
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('[lightsImport] Overpass import failed:', err);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
