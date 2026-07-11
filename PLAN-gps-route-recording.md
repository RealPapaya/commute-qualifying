# GPS route recording

## Frame

Goal: add a second **New Route** choice that records a driven route from browser GPS, while allowing the driver to add checkpoint and traffic-light markers during the recording.

In scope:
- A New Route choice between the current planning flow and GPS recording.
- Recording accepted GPS fixes as the route polyline.
- Recording-time Checkpoint and Light controls.
- Persisting the result through the existing route contract, then using it in the existing editor, circuit diagram, and Run views.

Out of scope:
- Background/locked-screen location recording.
- GPX export/import, map matching, or automatic traffic-light discovery changes.
- Editing individual recorded GPS points.

[assumption] A checkpoint means the existing sector boundary marker. It is stored as its distance from the recorded start, so the timing engine and circuit diagram already understand it.
[assumption] GPS recording only accepts fixes with reported accuracy of 40 m or better and points at least 5 m apart. This avoids unusable noise without changing Run's existing GPS threshold.
[assumption] A recorded route starts with no automatic sectors; the driver may place checkpoints while recording, or use the existing sector editor afterwards.

## Pattern anchor

- `js/run.js: armGps()` starts `watchPosition` synchronously from a click and uses `enableHighAccuracy`, no cache, and a 15-second timeout.
- `js/routeBuilder.js: onMapClick() -> rebuildGeometry() -> redrawAll()` is the route-production chain; `persist()` is the existing storage boundary.
- `js/sectors.js: sectorBoundaries` owns checkpoint positions in metres from the start.
- `index.html: #place-route-form` and `css/style.css: .place-route-form` are the compact editor-panel form pattern.

## Contract

`acceptedRecordingPoint(previousPoint, position)` returns a `[latitude, longitude]` point only when the browser position has finite coordinates, accuracy at most 40 m, and is at least 5 m from `previousPoint`; otherwise it returns `null`.

Recorded routes retain the existing contract:

```js
{
  id, name,
  waypoints: [[lat, lng], ...],
  points: [[lat, lng], ...],
  snap: false,
  lights: [[lat, lng], ...],
  sectorBoundaries: [metresFromStart, ...],
  timingVersion,
  recorded: true,
}
```

`recorded` only prevents hundreds of raw GPS fixes being rendered as draggable waypoint markers. Existing routes without it remain unchanged.

## File touch list

| File | Change |
| --- | --- |
| `index.html` | Add the New Route choice and compact GPS recording controls. |
| `css/style.css` | Style the choice and recording controls using the existing panel/form vocabulary. |
| `js/gpsRouteRecorder.js` | New pure GPS-fix acceptance helper. |
| `js/routeBuilder.js` | Own the recording session, marker controls, and conversion to the existing route fields. |
| `js/app.js` | Select the planning or GPS creation mode before opening the editor. |
| `test/gpsRouteRecorder.test.mjs` | Test accepted, inaccurate, duplicate, and invalid fixes. |
| `test/gps-route-recording.mjs` | Browser smoke test for mode selection, mocked GPS recording, checkpoint/light marking, and save. |

## Steps

1. Add the pure fix filter and unit coverage. Verify: `npm test`.
2. Add the explicit New Route choices and recording panel. Verify: planning selection still opens the editor; GPS selection opens the recording controls.
3. Wire a synchronous `watchPosition` recording session. Append accepted fixes to both `waypoints` and `points` with snapping off; add recorded checkpoint/light points to the existing fields. Verify: browser smoke test asserts the saved localStorage route has the expected raw points, one sector boundary, and one light.
4. Preserve normal route behavior. Verify: `npm test`, the existing address-route browser smoke test, and the new browser smoke test complete without page errors.

## Risks

- Browser geolocation needs HTTPS or localhost and visible foreground execution. Mitigation: use the existing Run UX's secure-context notice and never claim background support.
- GPS jitter can create an excessive/noisy polyline. Mitigation: accuracy and minimum-distance acceptance in a tested pure helper.
- A checkpoint close to the start or previous checkpoint creates an unusable sector. Mitigation: reject checkpoints less than 50 m from the prior boundary.

## Review log

Cross-family review is waived: the supplied repository instructions and active harness rules prohibit unrequested subagent/delegate work. The change is kept inside the existing route contract and is covered by pure and browser checks.

## Implementation log

- Built in the primary session without delegation, as required by the supplied multi-agent hard stop.
- Added a pure fix filter, GPS recording controls, New Route mode selection, and recording smoke coverage.
- Verification: `npm.cmd test` passed 57/57 tests; `node test/gps-route-recording.mjs` passed against a local static server with mocked map/GPS APIs; `node --check js/routeBuilder.js`, `node --check js/app.js`, and `git diff --check` passed.
- The browser smoke test asserts three stored GPS points, a checkpoint, a light, and that returning to the New Route menu's planning option restores the original place planner with no page errors.
