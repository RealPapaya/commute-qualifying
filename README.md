# Commute Qualifying 🏁

An F1-style qualifying lap timer for your daily commute. Trace your route on a
map, mark the traffic lights, split it into sectors, then drive it — GPS records
your sector splits and compares them against your personal bests
(**purple** = all-time best sector, **green** = session best, yellow = slower).

Pure static web app: no build step, no backend, no API keys. Data lives in your
browser's localStorage.

## Run it

```
cd "D:\Google AI\Qualifying"
npx -y serve -l 8080 .
```

then open http://localhost:8080. Any static file server works
(`python -m http.server 8080` too).

### On your phone (where it actually matters)

Browser geolocation only works in a **secure context** — `localhost` or HTTPS.
Your phone hitting `http://<your-pc-ip>:8080` will NOT get GPS access. Options:

- **Quickest:** a tunnel that gives you HTTPS, e.g. `npx ngrok http 8080` or
  `npx localtunnel --port 8080`, and open that URL on the phone.
- Or host the folder on any static HTTPS host (GitHub Pages, Netlify drop).

Note: routes are stored per-browser (localStorage), so build the route on the
same device/browser you run with — i.e. build it on your phone via the tunnel
URL, or re-trace it there.

## Using it

1. **Routes → + New Route.** Click along your commute to drop waypoints.
   With *Snap to roads* on, the trace follows actual roads (via the public
   OSRM demo server; falls back to straight lines if it's unreachable).
   Drag waypoints to adjust, double-click one to delete, ✏️/🚦/⏱ switch tools.
2. **🚦 Lights:** click to mark traffic lights. Click a light marker for an
   *Open Street View* link (opens Google Street View in a new tab) so you can
   verify you put it at the right intersection.
3. **⏱ Sectors:** the route defaults to 3 equal sectors. Drag the yellow
   handles to move boundaries, +/− Sector to change the count (1–10).
4. **Save**, then **Run**. Press **ARM GPS** before you set off — timing starts
   automatically when you cross the start of the route and stops at the end.
   Don't touch the phone after arming; just keep the screen on and visible
   (a dash mount is ideal).
5. **▶ Simulate run** replays a synthetic drive through the real timing engine —
   useful to demo the sector/PB logic without driving.

## Honest limitations (browser GPS, by design of this demo)

- **The screen must stay on and the tab visible.** Browsers throttle or pause
  background tabs and locked phones; there is no true background tracking
  outside a native app. The app requests a *screen wake lock* where supported
  (Chrome/Android, iOS Safari 16.4+), but if the OS kills the screen anyway,
  fixes stop until it's back.
- **GPS fixes arrive at roughly 1 Hz with 5–20 m urban accuracy** (worse in
  street canyons). Sector crossing times are linearly interpolated between the
  two fixes straddling a boundary, so splits are typically good to a few tenths
  — genuinely F1-ish — but a bad multipath day can shift a split by a second or
  two. Fixes with reported accuracy worse than 40 m are discarded.
- **Dropouts (tunnels, underpasses)** are tolerated: timing continues and the
  crossing is interpolated across the gap, at reduced precision.
- **Timing never runs backwards.** Progress along the route is monotonic;
  brief off-route drift or backwards GPS jitter is ignored. Routes that
  genuinely double back on themselves (U-turn commutes) may confuse
  progress-matching — out of scope for this demo.
- **Editing a route (geometry or sector boundaries) retires its old PBs** —
  old times aren't comparable to a changed track, so bests reset (old runs
  stay in History).
- External niceties degrade gracefully: OSRM snapping → straight lines,
  Street View is a link-out (embedding it needs a paid API key).

## Architecture

Vanilla ES modules + Leaflet/OpenStreetMap (CDN). The timing core is pure and
node-testable:

- `js/geo.js` — haversine, cumulative distances, point→polyline projection
- `js/timing.js` — run state machine: windowed progress matching, boundary
  interpolation, purple/green/yellow classification
- `js/store.js` — localStorage CRUD + per-`timingVersion` personal bests
- `js/routeBuilder.js`, `js/sectors.js` — map editing
- `js/run.js` — GPS session, wake lock, simulator, sector board UI
- `test/timing.test.mjs` — `npm test` (13 tests incl. jitter, dropouts,
  duplicate/out-of-order fixes, off-route rejection)
