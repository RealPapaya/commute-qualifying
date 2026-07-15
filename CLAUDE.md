# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An F1-style qualifying lap timer for a daily commute: trace a route on a map, mark traffic
lights, split it into sectors, then drive it while browser GPS records sector splits and
compares them against personal bests (purple = all-time best sector, green = session best,
yellow = slower).

Static web app — no build step, no bundler, no backend, no API keys. Vanilla ES modules
loaded directly by `index.html`; Leaflet comes from a CDN as a global `L`. All state lives in
`localStorage` under the key `commute-qualifying-v1`.

## Commands

```bash
npm test                                  # node:test over test/*.test.mjs (pure modules only)
node --test test/timing.test.mjs          # single test file
node --test --test-name-pattern "off-route"   # single test by name

npm start                                 # npx serve -l 8080 . — required by every browser script
```

Browser scripts are **not** part of `npm test`. Each launches Playwright against
`http://localhost:8080`, so start the server first. They all pin `channel: 'msedge'`
(system Edge, not a downloaded Chromium), and they print `pageerrors:` at the end —
a non-empty list means a regression even if the script otherwise completed.

```bash
node test/e2e-drive.mjs      # full UI drive: trace → diagram → lights → sectors → 2 sim laps → history
node test/summary-smoke.mjs  # seeds localStorage, simulates a lap, asserts the summary card's live data
node test/shell-shot.mjs [w] [h]   # screenshots every view at phone size; fails if Archivo didn't load
node test/probe.mjs          # reachability check for OSRM / Nominatim / Photon from inside a browser
```

`test/shell-shot.mjs` asserts `document.fonts.check()` for the Archivo weights before shooting.
A silent webfont fallback produces a plausible-looking but wrong screenshot, so never trust a
shell screenshot from a run whose font check printed `MISS`.

## Architecture

### The pure core / DOM shell split

Everything timing- and geometry-related is deliberately kept free of DOM and Leaflet so it can
be imported straight into `node --test` with no jsdom:

- `js/geo.js` — haversine, cumulative distances, point→polyline projection, point-at-distance
- `js/timing.js` — the run state machine (`armed` → `running` → `finished`)
- `js/trackDiagram.js` — `computeProjection`, `splitIntoSectors`, `detectCorners` are pure;
  `renderTrackDiagram` is not (tests stub `globalThis.document.createElementNS`)
- `js/routeDrag.js` — `findInsertIndex` is pure
- `js/summary.js` — `fmtClock`, `fmtLap`, `splitTitle`, `buildSummaryData` are pure

When adding logic, push it above this line. A new pure helper is testable for free; the same
logic inside a Leaflet callback needs a whole browser.

### Data model

A **route** is `{ id, name, waypoints, snap, points, lights, sectorBoundaries, timingVersion }`.
`waypoints` are the user's clicks; `points` is the derived polyline (OSRM-snapped, or the
waypoints verbatim when snapping is off or fails). `sectorBoundaries` are **meters from start**,
ascending, exclusive of 0 and total — so N boundaries means N+1 sectors.

A **run** record is `{ id, routeId, timingVersion, date, sectorTimes[], totalTime, completed,
simulated, conformance, disqualified, actualTrace[] }`. `actualTrace` is the actually-driven
path (accepted GPS fixes for that lap); `conformance` (0–1) is the fraction of that path's
distance that stayed within the route corridor (`js/conformance.js`); `disqualified` is true
when `conformance < 0.95` (labelled **DSQ** in the UI).

### Conformance / DSQ

`js/conformance.js` is pure. `js/run.js` accumulates `lapTrace` from every accepted fix while
`running` (resetting it on arm / lap-complete / route continuation) and scores it in
`saveCompletedLap`. A DSQ lap is off-route driving, not a valid time: it is still saved and
shown (greyed **DSQ** in history, a DSQ badge on the summary) but never becomes a best, and the
off-route escape hatch (`continueOnNewRoute`) re-measures conformance against the new route.

### `timingVersion` is the central invariant

Old times are not comparable to a changed track. `routeBuilder.persist()` bumps
`route.timingVersion` whenever `points` or `sectorBoundaries` differ from the saved copy, and
`store.allTimeBests()` only considers runs whose `timingVersion` matches the route's current
one (and which are not `disqualified`). Anything that mutates route geometry must go through
`persist()`, and anything that reads bests must pass the current `timingVersion` — otherwise
PBs silently compare across different tracks.

### Timing engine invariants (`js/timing.js`)

`feedFix(run, fix)` returns `'start' | 'sector' | 'finish' | 'offroute' | null`. Its guarantees,
each of which has a test:

- **Progress is monotonic.** Backwards GPS jitter beyond `BACKWARDS_TOLERANCE_M` is discarded.
- **Projection is windowed** around the last known progress (`hint`), so a parallel street or a
  self-crossing route can't yank progress backwards. On window miss it retries unwindowed but
  only accepts a match ahead of `maxProgress`.
- **Boundary crossing times are linearly interpolated** between the two fixes that straddle the
  boundary — one fix can cross several boundaries at once (the `while` loop).
- **Duplicate / out-of-order timestamps are dropped** before they corrupt interpolation.
- Fixes worse than `MAX_ACCURACY_M` are the *caller's* job to drop (`run.js` does it), not the
  engine's.

### View routing (`js/app.js`)

`showView(name)` toggles `.view.active` and drives lazy loading. The two guards there are load-
bearing: `ensureEditorLoaded()` won't reload the editor for an unchanged route (reloading would
discard unsaved edits), and `ensureRunLoaded()` keys on `routeId:timingVersion` (reloading would
wipe a live run mid-lap). `openRoute()` is handed a `structuredClone` so editor edits can't leak
into the store before Save.

### Leaflet + hidden-container gotchas

A map or SVG sized while its container is `hidden` gets a useless box. Two rules recur:

- After showing a map tab, call `map.invalidateSize()` **before** `fitBounds` (`runInvalidate`,
  `editorInvalidate`, and the `setTimeout(…, 50)` in `openRoute`/`openRun`).
- Unhide the track-diagram overlay **before** calling `renderTrackDiagram` — it reads
  `container.getBoundingClientRect()` to shape its viewBox.

`renderTrackDiagram` is fully re-derived from the route on each call; there is no incremental
state to keep in sync. It's rendered from two places (the editor overlay and the run overlay)
with different filter checkboxes.

### External services, all optional

- **OSRM** (`router.project-osrm.org`) — road snapping. On failure the route falls back to
  straight lines between waypoints, with a `flashHelp` notice.
- **OSM tiles**, and **Google Street View** as a plain link-out from a light's popup (embedding
  needs a paid key).

The OSRM importer uses a monotonic sequence counter (`buildSeq` in `routeBuilder.js`) to discard
stale responses. Keep that pattern when adding another fetch.

### GPS session (`js/run.js`)

`watchPosition` must be called **synchronously inside the Start click handler** (`btn-arm`, now
labelled 開始/Start) — iOS Safari fails a geolocation request made after an `await` with
`PERMISSION_DENIED`, silently, even on an already-granted origin. The wake lock is requested
afterwards for that reason. Only `PERMISSION_DENIED` ends the watch; `TIMEOUT` and
`POSITION_UNAVAILABLE` are transient (tunnels, cold start) and the session stays live. The Run
view intentionally shows just the one Start button at rest (Abort appears once running).

Geolocation needs a **secure context**: `localhost` or HTTPS. A phone hitting
`http://<pc-ip>:8080` gets no GPS — tunnel it (`npx ngrok http 8080`) or host it over HTTPS.

`▶ Simulate run` replays a synthetic drive through the *same* `feedFix` path at 10× speed, so
it exercises the real timing engine. `record.simulated` is set from `simTimer != null`. It is a
**tester-only** control: `btn-simulate` starts `hidden` and `run.js`'s `testerMode()` only
reveals it under `?test=1` / `?tester=1` or `localStorage['commute-tester']='1'`. Browser tests
that drive it (`e2e-drive`, `summary-smoke`, `closed-loop`) navigate with `?test=1`.

### Recording breaks / auto-connect (`js/routeBuilder.js`)

GPS recording can be paused and resumed. If the driver moves while paused, the resume opens a
**break** — a straight jump in the polyline that isn't a real track. `startGpsRecording` arms
`resumeGapFromPoint`; the first accepted fix past `GAP_MIN_M` records a `{from,to}` into
`recordingGaps` (drawn as a dashed red overlay). Such a route can't be saved as-is: `persist()`
is async and, when `recordingGaps` is non-empty, confirms then `fillRecordingGaps()` road-snaps
(OSRM) each break and splices the routed shape points into `route.points`/`route.waypoints` in
lockstep (falling back to the straight segment if OSRM fails), so the saved track is continuous.

## Conventions

- UI copy is mixed English and Traditional Chinese; match whatever the surrounding strings use.
- Every value interpolated into `innerHTML` goes through the local `esc()` helper.
- Browser scripts reach the maps via the test hooks `window._editorMap` / `window._runMap`, and
  seed state by writing `commute-qualifying-v1` into `localStorage` then reloading.
- Purple/green/yellow are semantics (all-time best / session best / slower), not decoration.
  The colour comment at the top of `css/style.css` has purple and green swapped; `js/timing.js`
  `classifySector()` is the authority.
