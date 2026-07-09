// Pure timing engine — a state machine fed GPS fixes, no DOM.
// F1-style: sector boundaries are distances along the route; crossing times
// are linearly interpolated between the two fixes straddling a boundary.

import { projectOnRoute } from './geo.js';

export const OFF_ROUTE_M = 60;        // reject fixes farther than this from route
export const START_RADIUS_M = 40;     // must be near start line to trigger launch
export const BACKWARDS_TOLERANCE_M = 25; // GPS jitter may step back this much
export const MAX_ACCURACY_M = 40;     // callers should drop fixes worse than this

// states: 'armed' -> 'running' -> 'finished'
export function createRun(route) {
  const { points, cum, sectorBoundaries } = route; // boundaries: meters, ascending, exclusive of 0 and total
  const total = cum[cum.length - 1];
  // crossing distances: each sector ends at boundaries[i], last ends at total
  const ends = [...sectorBoundaries, total];
  return {
    points, cum, total, ends,
    state: 'armed',
    startTime: null,
    lastFix: null,          // { t (ms), progress }
    maxProgress: 0,
    crossings: [],          // ms timestamps when each sector end was crossed
    sectorTimes: ends.map(() => null),
  };
}

// Feed one fix: { lat, lng, t (epoch ms) }. Returns an event string or null:
// 'start' | 'sector' | 'finish' | 'offroute' | null.
export function feedFix(run, fix) {
  if (run.state === 'finished') return null;
  // duplicate or out-of-order timestamps would corrupt interpolation
  if (run.lastFix && fix.t <= run.lastFix.t) return null;

  const hint = run.state === 'running' ? run.maxProgress : 0;
  let proj = projectOnRoute([fix.lat, fix.lng], run.points, run.cum,
    run.state === 'running' ? hint : null);
  // Windowed search failed (e.g. long GPS dropout carried us past the search
  // window): retry unwindowed, but only accept a match ahead of us so a
  // parallel or earlier section of the route can't yank progress backwards.
  if (run.state === 'running' && (!proj || proj.offRoute > OFF_ROUTE_M)) {
    const full = projectOnRoute([fix.lat, fix.lng], run.points, run.cum);
    if (full && full.offRoute <= OFF_ROUTE_M &&
        full.progress >= run.maxProgress - BACKWARDS_TOLERANCE_M) {
      proj = full;
    }
  }
  if (!proj || proj.offRoute > OFF_ROUTE_M) {
    return run.state === 'running' ? 'offroute' : null;
  }

  if (run.state === 'armed') {
    // Launch when we are on the route near its start and begin moving forward.
    if (proj.progress < START_RADIUS_M) {
      run.state = 'running';
      run.startTime = fix.t;
      run.maxProgress = proj.progress;
      run.lastFix = { t: fix.t, progress: proj.progress };
      return 'start';
    }
    return null;
  }

  // running
  const prev = run.lastFix;
  const progress = proj.progress;
  if (progress < run.maxProgress - BACKWARDS_TOLERANCE_M) {
    // jitter or wrong projection; ignore this fix
    return null;
  }
  const effective = Math.max(progress, run.maxProgress);

  let event = null;
  // check boundary crossings between prev.progress and current progress
  while (run.crossings.length < run.ends.length &&
         effective >= run.ends[run.crossings.length]) {
    const bd = run.ends[run.crossings.length];
    const tCross = interpolateTime(prev, { t: fix.t, progress }, bd);
    run.crossings.push(tCross);
    const i = run.crossings.length - 1;
    const sectorStart = i === 0 ? run.startTime : run.crossings[i - 1];
    run.sectorTimes[i] = tCross - sectorStart;
    event = i === run.ends.length - 1 ? 'finish' : 'sector';
  }

  run.maxProgress = effective;
  run.lastFix = { t: fix.t, progress };
  if (event === 'finish') run.state = 'finished';
  return event;
}

// Linear interpolation of the timestamp at which `boundary` meters was passed,
// given the fixes before and after.
function interpolateTime(prev, curr, boundary) {
  if (!prev || curr.progress <= prev.progress) return curr.t;
  const f = (boundary - prev.progress) / (curr.progress - prev.progress);
  return prev.t + Math.max(0, Math.min(1, f)) * (curr.t - prev.t);
}

export function elapsed(run, nowMs) {
  if (run.startTime == null) return 0;
  if (run.state === 'finished') {
    return run.crossings[run.crossings.length - 1] - run.startTime;
  }
  return nowMs - run.startTime;
}

// Classify a completed sector time against bests.
// allTime/session: ms or null (no previous time).
// Returns 'purple' (all-time best), 'green' (session best), 'yellow'.
export function classifySector(timeMs, allTimeMs, sessionMs) {
  if (allTimeMs == null || timeMs < allTimeMs) return 'purple';
  if (sessionMs == null || timeMs < sessionMs) return 'green';
  return 'yellow';
}

export function fmtTime(ms) {
  if (ms == null) return '--:--.--';
  const neg = ms < 0;
  ms = Math.abs(ms);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function fmtDelta(ms) {
  if (ms == null) return '';
  const sign = ms < 0 ? '−' : '+';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(2)}`;
}
