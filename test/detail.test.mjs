import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeDistances } from '../js/geo.js';
import {
  sectorSpans, traceHasTime, computeSpeedSamples, sectorSpeed, speedAtDistance,
  detectStops, buildDetailData, fmtSpeed, fmtDist, fmtDuration,
} from '../js/detail.js';

// A straight west-to-east route near the equator. 0.01° lng ≈ 1113 m, so the
// three-vertex line is ~2226 m long; a boundary at the midpoint splits it 50/50.
const POINTS = [[0, 0], [0, 0.01], [0, 0.02]];
const CUM = cumulativeDistances(POINTS);
const TOTAL = CUM.at(-1);

function route(extra = {}) {
  return {
    id: 'r1', name: 'TEST LOOP', points: POINTS, cum: CUM,
    sectorBoundaries: [TOTAL / 2], timingVersion: 1, lights: [], ...extra,
  };
}

// ---- formatters ----

test('fmtSpeed / fmtDist / fmtDuration', () => {
  assert.equal(fmtSpeed(33.33), '33.3');
  assert.equal(fmtSpeed(null), '--');
  assert.equal(fmtDist(340), '340 m');
  assert.equal(fmtDist(1500), '1.50 km');
  assert.equal(fmtDuration(4200), '4.2s');
  assert.equal(fmtDuration(95000), '1:35');
});

// ---- sectorSpans ----

test('sectorSpans: N boundaries yield N+1 contiguous spans', () => {
  const spans = sectorSpans(route());
  assert.equal(spans.length, 2);
  assert.equal(spans[0].startM, 0);
  assert.ok(Math.abs(spans[0].endM - TOTAL / 2) < 1);
  assert.ok(Math.abs(spans[1].endM - TOTAL) < 1);
  // contiguous, no gaps
  assert.equal(spans[0].endM, spans[1].startM);
});

// ---- traceHasTime ----

test('traceHasTime: only true for timestamped ([lat,lng,t]) traces', () => {
  assert.equal(traceHasTime([[0, 0], [0, 1]]), false);
  assert.equal(traceHasTime([[0, 0, 100], [0, 1, 200]]), true);
  assert.equal(traceHasTime([[0, 0, 100]]), false);        // needs >= 2
  assert.equal(traceHasTime([[0, 0, 100], [0, 1]]), false); // mixed
  assert.equal(traceHasTime(null), false);
});

// ---- computeSpeedSamples ----

test('computeSpeedSamples: one sample per leg, speed = distance / time', () => {
  // three fixes, 60 s apart, ~556 m per leg → ~9.3 m/s
  const trace = [[0, 0, 0], [0, 0.005, 60000], [0, 0.01, 120000]];
  const samples = computeSpeedSamples(trace, POINTS, CUM);
  assert.equal(samples.length, 2);
  for (const s of samples) {
    assert.ok(s.speedMps > 8 && s.speedMps < 11, `unexpected speed ${s.speedMps}`);
    assert.ok(s.atM >= 0 && s.atM <= TOTAL);
  }
});

test('computeSpeedSamples: drops zero/negative dt legs', () => {
  const trace = [[0, 0, 0], [0, 0.005, 0], [0, 0.01, 60000]];
  const samples = computeSpeedSamples(trace, POINTS, CUM);
  assert.equal(samples.length, 1); // the t=0→t=0 leg is discarded
});

// ---- sectorSpeed ----

test('sectorSpeed: rolls samples into the right sector', () => {
  const trace = [[0, 0, 0], [0, 0.005, 60000], [0, 0.01, 120000], [0, 0.015, 180000]];
  const samples = computeSpeedSamples(trace, POINTS, CUM);
  const spans = sectorSpans(route());
  const s1 = sectorSpeed(samples, spans[0]);
  assert.ok(s1.avgKmh > 0);
  assert.ok(s1.maxKmh >= s1.avgKmh - 1e-6);
});

// ---- speedAtDistance ----

test('speedAtDistance: averages samples near a distance, km/h', () => {
  const trace = [[0, 0, 0], [0, 0.005, 60000], [0, 0.01, 120000]];
  const samples = computeSpeedSamples(trace, POINTS, CUM);
  const mid = samples[0].atM;
  const kmh = speedAtDistance(samples, mid, 100);
  assert.ok(kmh > 25 && kmh < 45, `unexpected ${kmh}`); // ~9.3 m/s → ~33 km/h
  assert.equal(speedAtDistance([], 100), null);
});

// ---- detectStops ----

test('detectStops: a stationary cluster >= 3 s becomes one stop', () => {
  const trace = [[0, 0, 0], [0, 0, 4000], [0, 0.0001, 4200], [0, 0.001, 6000]];
  const stops = detectStops(trace, POINTS, CUM);
  assert.equal(stops.length, 1);
  assert.ok(stops[0].durationMs >= 3000);
  assert.ok(stops[0].atM != null);
});

test('detectStops: brief pauses under the threshold are ignored', () => {
  const trace = [[0, 0, 0], [0, 0, 1000], [0, 0.001, 2000]];
  assert.deepEqual(detectStops(trace, POINTS, CUM), []);
});

test('detectStops: legacy trace without timestamps yields nothing', () => {
  assert.deepEqual(detectStops([[0, 0], [0, 0.01]], POINTS, CUM), []);
});

// ---- buildDetailData ----

function run(id, date, sectorTimes, opts = {}) {
  return {
    id, routeId: 'r1', timingVersion: 1, date,
    sectorTimes, totalTime: sectorTimes.reduce((a, b) => a + b, 0),
    completed: true, disqualified: false, conformance: 1,
    actualTrace: opts.trace ?? [], simulated: opts.simulated ?? false, ...opts,
  };
}

test('buildDetailData: sectors, ideal lap and rank across two laps', () => {
  // Same day, so the session-best (green) reference is populated by `prev`.
  const prev = run('a', '2026-07-16T07:00:00Z', [30000, 40000]);       // 70 s
  const cur = run('b', '2026-07-16T08:00:00Z', [28000, 42000]);        // 70 s
  const data = buildDetailData(route(), cur, [prev, cur]);

  assert.equal(data.sectorCount, 2);
  // S1 beat the previous best (28 < 30) → purple, new record
  assert.equal(data.sectors[0].color, 'purple');
  assert.equal(data.sectors[0].isRecord, true);
  assert.ok(data.sectors[0].deltaVsBestMs < 0);
  // S2 was slower than both the all-time and today's best (42 > 40) → yellow
  assert.equal(data.sectors[1].color, 'yellow');
  assert.ok(data.sectors[1].deltaVsBestMs > 0);

  // Ideal lap = best S1 (28) + best S2 (40) = 68 s; this lap 70 s → 2 s on table
  assert.equal(data.ideal.totalMs, 68000);
  assert.equal(data.ideal.timeLostVsIdealMs, 2000);

  // one previous lap to compare against, with a per-sector delta
  assert.equal(data.compare.length, 1);
  assert.equal(data.compare[0].sectorDeltas[0], -2000); // this lap 2 s faster in S1
  assert.equal(data.compare[0].sectorDeltas[1], 2000);  // 2 s slower in S2
  assert.equal(data.lapCount, 2);
});

test('buildDetailData: first clean lap has no comparison and every sector is FIRST', () => {
  const cur = run('only', '2026-07-16T08:00:00Z', [30000, 40000]);
  const data = buildDetailData(route(), cur, [cur]);
  assert.equal(data.compare.length, 0);
  assert.ok(data.sectors.every(s => s.isFirst));
  assert.equal(data.isPB, true);       // nothing to beat → it's the best
  assert.equal(data.hasTelemetry, false);
});

test('buildDetailData: disqualified runs are excluded from comparison', () => {
  const dsq = run('bad', '2026-07-15T08:00:00Z', [10000, 10000], { disqualified: true, conformance: 0.5 });
  const cur = run('good', '2026-07-16T08:00:00Z', [30000, 40000]);
  const data = buildDetailData(route(), cur, [dsq, cur]);
  assert.equal(data.compare.length, 0); // the DSQ lap is not a valid comparison
  assert.ok(data.sectors.every(s => s.isFirst));
});

test('buildDetailData: telemetry drives speed + stops for a timestamped lap', () => {
  const trace = [[0, 0, 0], [0, 0, 4000], [0, 0.01, 64000], [0, 0.02, 124000]];
  const cur = run('t', '2026-07-16T08:00:00Z', [64000, 60000], { trace });
  const data = buildDetailData(route(), cur, [cur]);
  assert.equal(data.hasTelemetry, true);
  assert.equal(data.overall.stopCount, 1);
  assert.ok(data.overall.totalStoppedMs >= 4000);
  assert.ok(data.overall.avgKmh > 0);
  assert.ok(data.overall.movingAvgKmh > data.overall.avgKmh); // moving avg excludes the stop
});

test('buildDetailData: corners detected on an L-bend carry a sector and speed', () => {
  // An L-shaped route (east then north) has one clear corner.
  const bend = [[0, 0], [0, 0.006], [0, 0.012], [0.006, 0.012], [0.012, 0.012]];
  const bcum = cumulativeDistances(bend);
  const r = { id: 'r2', name: 'L', points: bend, cum: bcum,
    sectorBoundaries: [bcum.at(-1) / 2], timingVersion: 1, lights: [] };
  // timestamped drive through the whole route
  const trace = bend.map((p, i) => [p[0], p[1], i * 60000]);
  const rec = { id: 'x', routeId: 'r2', timingVersion: 1, date: '2026-07-16T08:00:00Z',
    sectorTimes: [120000, 120000], totalTime: 240000, completed: true,
    disqualified: false, conformance: 1, simulated: false, actualTrace: trace };
  const data = buildDetailData(r, rec, [rec]);
  assert.ok(data.corners.length >= 1, `expected a corner, got ${data.corners.length}`);
  assert.ok(data.corners.every(c => c.sectorIndex === 0 || c.sectorIndex === 1));
  assert.ok(data.corners.every(c => c.speedKmh == null || c.speedKmh > 0));
  assert.ok('topStraightKmh' in data.speedStats);
});
