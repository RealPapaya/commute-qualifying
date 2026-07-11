# Closed-loop circuit support plan

## Frame

Goal: add an explicit closed-loop circuit setting so a route that returns to its
start can be identified as a circuit and used for multiple laps.

In scope:

- Persist the closed-loop setting with a planned route.
- Let the route-planning UI set and display the setting.
- Pass the setting to the existing qualifying/race flow where a lap count is
  already supported.

Out of scope:

- Automatically inferring whether arbitrary start/end points form a circuit.
- Changing the route geometry or adding a new race mode.

Assumptions:

- [assumption] A user-selected boolean is the requested option; existing
  point-to-point routes remain unchanged by default.
- [assumption] Multiple laps are represented by an existing lap/count concept
  in the run history. A closed circuit will save each completed lap as its own
  existing run record; no schema migration is needed.

## Pattern anchor

- `js/routeBuilder.js:89` creates and edits the route contract, and
  `js/routeBuilder.js:562` is its persistence boundary.
- `js/timing.js:13` owns the pure one-lap state machine; `js/timing.js:68`
  interpolates every sector and finish crossing.
- `js/run.js:457` consumes those timing events; `js/run.js:480` converts a
  completed lap into the existing run-record contract.
- `index.html:80` uses an existing compact `.toggle` control beside route
  planning settings, so the new option needs no new component or CSS system.

Binding constraints:

- Existing routes must behave as one-way, one-lap routes unless explicitly
  opted in.
- Geometry and sector changes alone advance `timingVersion`; the closed-circuit
  flag changes whether a completed lap continues the session, not the lap data.
- The timing core must stay DOM-free and receive direct `node:test` coverage.

## Contract

Routes gain one optional, backwards-compatible field:

```js
{ closedLoop: boolean } // omitted or false: one-way; true: continuously timed laps
```

For `closedLoop: true`, `feedFix(run, fix)` may return `'lap'` on every finish
crossing. It keeps the run active and exposes the completed lap as:

```js
run.completedLap = { number, sectorTimes, totalTime }
```

The DOM shell saves that data using the unchanged run-record fields, refreshes
the personal-best references, and times the next lap immediately. Non-closed
routes retain the existing `'finish'` event and summary flow.

## File touch list

| File | Change |
| --- | --- |
| `index.html` | Add the closed-circuit checkbox beside existing route options. |
| `js/routeBuilder.js` | Read and persist `closedLoop`, defaulting it to false. |
| `js/timing.js` | Emit a completed-lap event and reset only the lap state for closed circuits. |
| `js/run.js` | Save each closed-circuit lap without ending the active GPS/simulator session. |
| `test/timing.test.mjs` | Cover two consecutive, interpolated closed-circuit laps. |
| `test/closed-loop.mjs` | Browser-smoke the checkbox, persistence, and first continuous simulated lap. |

## Steps

1. Add the backwards-compatible route option and save it with the route.
   Verify: a new route defaults to unchecked; an existing route without the
   field still opens unchecked.
2. Extend the pure timing state machine for closed circuits. Verify:
   `npm test` proves one finish crossing yields a saved lap payload, returns to
   an active state, and accepts a second lap.
3. Save closed-circuit laps through the existing run-record path without
   interrupting the GPS watch. Verify: `npm test` and `node --check` on changed
   browser modules pass.
4. Check the user-facing flow. Verify: start the static app, run
   `node test/closed-loop.mjs`, and confirm its checkbox, persistence, first
   simulated lap, and page-error assertions pass.

## Risks

- A route marked closed but whose end does not actually return to its start can
  produce meaningless later laps. Mitigation: the explicit opt-in makes the
  user responsible for declaring the loop; v1 does not guess geometry.
- A final GPS fix can land directly on the start/finish point. Mitigation: the
  timing engine resets its projection hint to the start immediately after a lap
  so the next forward fix begins the new lap.

## Review log

Cross-family review is waived: the supplied repository instructions and active
harness rules prohibit unrequested subagent/delegate work. The change follows
the existing route/timing/run wiring and has a narrow pure-core regression test.

## Implementation log

- Added the `closedLoop` route field and the editor toggle; missing fields on
  saved routes behave as `false`.
- Closed circuits now save each completed lap using the existing run-record
  shape, update PBs, reset only lap timing state, and keep the GPS/simulator
  session active. Start/finish crossings are interpolated even when GPS jumps
  from just before the endpoint to just after the start.
- Verification: `npm test` passed 58/58; the Leaflet-stubbed browser smoke
  passed while checking option persistence, a simulated first lap, continued
  session state, and page errors; `git diff --check` passed.
- Independent review is waived because the active multi-agent hard stop
  prohibits unrequested delegation.
