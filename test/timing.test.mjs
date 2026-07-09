import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, cumulativeDistances, projectOnRoute, pointAtDistance }
  from '../js/geo.js';
import { createRun, feedFix, classifySector, fmtTime, fmtDelta } from '../js/timing.js';

// ---- fixture: 3 km straight route heading north, points every 100 m ----
const M_PER_DEG_LAT = 111195;
const points = Array.from({ length: 31 },
  (_, i) => [25.0 + (i * 100) / M_PER_DEG_LAT, 121.5]);
const cum = cumulativeDistances(points);
const TOTAL = cum.at(-1);

function makeRoute(boundaries = [1000, 2000]) {
  return { points, cum, sectorBoundaries: boundaries };
}

// position at `dist` meters along the route, optionally offset east by `offM`
function posAt(dist, offM = 0) {
  const [lat, lng] = pointAtDistance(points, cum, dist);
  return { lat, lng: lng + offM / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180)) };
}

// ---- geo.js ----

test('haversine: 0.01 deg latitude ~ 1112 m', () => {
  const d = haversine([25, 121.5], [25.01, 121.5]);
  assert.ok(Math.abs(d - 1112) < 2, `got ${d}`);
});

test('cumulative distances are monotonic and total ~3000 m', () => {
  for (let i = 1; i < cum.length; i++) assert.ok(cum[i] > cum[i - 1]);
  assert.ok(Math.abs(TOTAL - 3000) < 5, `total ${TOTAL}`);
});

test('projectOnRoute recovers progress and lateral offset', () => {
  const p = posAt(1234, 20);
  const proj = projectOnRoute([p.lat, p.lng], points, cum);
  assert.ok(Math.abs(proj.progress - 1234) < 2, `progress ${proj.progress}`);
  assert.ok(Math.abs(proj.offRoute - 20) < 2, `offRoute ${proj.offRoute}`);
});

test('pointAtDistance / projectOnRoute round-trip', () => {
  for (const d of [0, 250, 1500, 2999, TOTAL]) {
    const [lat, lng] = pointAtDistance(points, cum, d);
    const proj = projectOnRoute([lat, lng], points, cum);
    assert.ok(Math.abs(proj.progress - d) < 1, `d=${d} got ${proj.progress}`);
  }
});

// ---- timing.js: clean run ----

test('clean run: start, sector crossings interpolated, finish', () => {
  const run = createRun(makeRoute());
  const V = 15; // m/s, 1 Hz fixes
  const events = [];
  for (let s = 0; s * V <= TOTAL + V; s++) {
    const p = posAt(Math.min(s * V, TOTAL));
    const ev = feedFix(run, { lat: p.lat, lng: p.lng, t: s * 1000 });
    if (ev) events.push(ev);
  }
  assert.deepEqual(events, ['start', 'sector', 'sector', 'finish']);
  // boundary 1000 m at 15 m/s -> 66.67 s; linear motion -> exact interpolation
  assert.ok(Math.abs(run.sectorTimes[0] - 66667) < 300, `S1 ${run.sectorTimes[0]}`);
  assert.ok(Math.abs(run.sectorTimes[1] - 66667) < 300, `S2 ${run.sectorTimes[1]}`);
  const total = run.sectorTimes.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - TOTAL / V * 1000) < 500, `total ${total}`);
});

test('interpolation: crossing time between two straddling fixes', () => {
  const run = createRun(makeRoute([1000, 2000]));
  feedFix(run, { ...posAt(0), t: 0 });               // start
  feedFix(run, { ...posAt(995), t: 100000 });
  const ev = feedFix(run, { ...posAt(1010), t: 101000 });
  assert.equal(ev, 'sector');
  // crossed 1000 m at 100000 + 5/15*1000 ms
  assert.ok(Math.abs(run.crossings[0] - 100333) < 5, `got ${run.crossings[0]}`);
});

// ---- timing.js: noise robustness (codex review cases) ----

test('GPS jitter (±6 m) still produces a valid finish', () => {
  const run = createRun(makeRoute());
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5;
  for (let s = 0; s * 15 <= TOTAL + 30; s++) {
    const p = posAt(Math.min(s * 15, TOTAL), rnd() * 12);
    feedFix(run, { lat: p.lat + rnd() * 0.00005, lng: p.lng, t: s * 1000 });
  }
  assert.equal(run.state, 'finished');
  const total = run.sectorTimes.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 200000) < 3000, `total ${total}`);
});

test('multi-second GPS gap: crossing interpolated inside the gap', () => {
  const run = createRun(makeRoute([1000, 2000]));
  feedFix(run, { ...posAt(0), t: 0 });
  feedFix(run, { ...posAt(900), t: 60000 });
  const ev = feedFix(run, { ...posAt(1200), t: 68000 }); // 8 s dropout over the boundary
  assert.equal(ev, 'sector');
  assert.ok(run.crossings[0] > 60000 && run.crossings[0] < 68000);
  // 100 m of the 300 m gap -> t = 60000 + 8000/3
  assert.ok(Math.abs(run.crossings[0] - 62667) < 10, `got ${run.crossings[0]}`);
});

test('duplicate and out-of-order timestamps are ignored', () => {
  const run = createRun(makeRoute());
  feedFix(run, { ...posAt(0), t: 0 });
  feedFix(run, { ...posAt(500), t: 30000 });
  const before = { ...run.lastFix };
  assert.equal(feedFix(run, { ...posAt(510), t: 30000 }), null); // duplicate t
  assert.equal(feedFix(run, { ...posAt(520), t: 29000 }), null); // out of order
  assert.deepEqual(run.lastFix, before);
});

test('backwards jitter never un-crosses or reverses progress', () => {
  const run = createRun(makeRoute([1000, 2000]));
  feedFix(run, { ...posAt(0), t: 0 });
  feedFix(run, { ...posAt(1050), t: 70000 });
  assert.equal(run.crossings.length, 1);
  feedFix(run, { ...posAt(1020), t: 71000 }); // 30 m backwards (> tolerance) — ignored
  assert.equal(run.maxProgress > 1040, true);
  assert.equal(run.crossings.length, 1);
});

test('off-route fixes are rejected and do not advance progress', () => {
  const run = createRun(makeRoute());
  feedFix(run, { ...posAt(0), t: 0 });
  feedFix(run, { ...posAt(500), t: 30000 });
  const ev = feedFix(run, { ...posAt(600, 150), t: 31000 }); // 150 m off route
  assert.equal(ev, 'offroute');
  assert.ok(run.maxProgress < 550);
});

test('run does not start away from the start line', () => {
  const run = createRun(makeRoute());
  assert.equal(feedFix(run, { ...posAt(800), t: 0 }), null);
  assert.equal(run.state, 'armed');
  assert.equal(feedFix(run, { ...posAt(10), t: 5000 }), 'start');
});

// ---- best classification ----

test('classifySector: purple / green / yellow', () => {
  assert.equal(classifySector(60000, null, null), 'purple');      // first ever
  assert.equal(classifySector(59000, 60000, 61000), 'purple');    // beats all-time
  assert.equal(classifySector(60500, 60000, 61000), 'green');     // beats session
  assert.equal(classifySector(62000, 60000, 61000), 'yellow');    // beats neither
});
test('fmtTime: displays minutes, seconds, and milliseconds', () => {
  assert.equal(fmtTime(null), '--:--:---');
  assert.equal(fmtTime(65432), '01:05:432');
  assert.equal(fmtTime(-1234), '-00:01:234');
});

test('fmtDelta: displays signed seconds with two decimals', () => {
  assert.equal(fmtDelta(-1234), '−1.23');
  assert.equal(fmtDelta(987), '+0.99');
});
