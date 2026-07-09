// localStorage persistence: routes, runs, personal bests.
const KEY = 'commute-qualifying-v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? { routes: [], runs: [] };
  } catch {
    return { routes: [], runs: [] };
  }
}

function save(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

export function listRoutes() {
  return load().routes;
}

export function getRoute(id) {
  return load().routes.find(r => r.id === id) ?? null;
}

export function saveRoute(route) {
  const db = load();
  const i = db.routes.findIndex(r => r.id === route.id);
  if (i >= 0) db.routes[i] = route;
  else db.routes.push(route);
  save(db);
}

export function deleteRoute(id) {
  const db = load();
  db.routes = db.routes.filter(r => r.id !== id);
  db.runs = db.runs.filter(r => r.routeId !== id);
  save(db);
}

export function listRuns(routeId) {
  const runs = load().runs;
  return routeId ? runs.filter(r => r.routeId === routeId) : runs;
}

export function saveRun(run) {
  const db = load();
  db.runs.push(run);
  save(db);
}

export function deleteRun(id) {
  const db = load();
  db.runs = db.runs.filter(r => r.id !== id);
  save(db);
}

// All-time bests for a route: per-sector minimums and best total, across
// completed runs whose timingVersion matches the route's current geometry
// (editing the route or its sectors invalidates old comparisons).
// Returns { sectors: [ms|null,...], total: ms|null }.
export function allTimeBests(routeId, sectorCount, timingVersion) {
  const runs = listRuns(routeId)
    .filter(r => r.completed && r.timingVersion === timingVersion);
  const sectors = Array.from({ length: sectorCount }, (_, i) => {
    const times = runs.map(r => r.sectorTimes[i]).filter(t => t != null);
    return times.length ? Math.min(...times) : null;
  });
  const totals = runs.map(r => r.totalTime).filter(t => t != null);
  return { sectors, total: totals.length ? Math.min(...totals) : null };
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}
