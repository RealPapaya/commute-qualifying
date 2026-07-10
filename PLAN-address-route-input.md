# Address route input

## Frame

Goal: let a driver build a route from a start, end, and zero or more ordered via-place text inputs, while retaining map-click tracing.

In scope:
- Address/place search to latitude/longitude.
- Ordered start, via, and end fields in the route editor.
- Rebuild the existing OSRM route from the resolved coordinates.

Out of scope:
- Saving the source addresses in the route model.
- Autocomplete, result pickers, or turn-by-turn navigation.

[assumption] A "road name" may be supplied as an address or place name; the first matching Taiwan-capable Nominatim result is appropriate for this keyless static app.
[assumption] Existing manually placed waypoints remain available and are replaced only after every entered place resolves successfully.

## Pattern anchor

`js/routeBuilder.js`: `onMapClick()` appends a coordinate to `route.waypoints`, then `rebuildGeometry()` produces the existing route and sector state.

Contract: `searchPlace(query)` resolves to `{ point: [latitude, longitude], name }` or throws an error. The editor passes its ordered `point` values to `route.waypoints` and invokes `rebuildGeometry()`.

## File touch list

| File | Change |
| --- | --- |
| `index.html` | Add start, via, end inputs and route-build controls. |
| `css/style.css` | Style the compact place-input group. |
| `js/geocode.js` | New narrow Nominatim search module. |
| `js/routeBuilder.js` | Wire controls to ordered geocoding and existing rebuild. |
| `test/geocode.test.mjs` | Unit-test the response contract. |
| `test/address-route.mjs` | Browser smoke test for the visible controls and route rebuild. |

## Steps

1. Add the input controls and matching compact styling. Verify: controls fit in the editor panel at desktop and phone widths.
2. Add the narrow geocoding module and unit tests. Verify: `npm test` passes.
3. Resolve inputs sequentially, replace waypoints only after all succeed, then call the existing geometry rebuild. Verify: browser smoke test sees three markers and an OSRM/straight-line route.

## Risks

- Public geocoding can fail or rate-limit. Mitigation: sequential requests, clear status, and preserve the existing route on failure.
- A place name may be ambiguous. Mitigation: the displayed resolved place is reported in status; users can use a fuller address or fall back to map clicks.

## Review log

Cross-family review is waived: the repository instructions explicitly prohibit unrequested subagent/delegate work. The implementation is constrained to the existing waypoint contract and separately verified by automated tests.
