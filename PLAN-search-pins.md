# Place-search relevance and map pins

## Frame

Goal: make place search behave like a local map search: return useful Taiwan
matches and show a map pin as soon as the user confirms a suggestion.

In scope:
- Prefer relevant, de-duplicated Taiwan place results.
- Show each suggestion's name and address so same-named places are distinguishable.
- Preserve a confirmed result's coordinates and show it as a Leaflet pin.
- Keep the existing route-building and OSRM snapping flow.

Out of scope:
- Google Places API integration (this static app has no API key or backend).
- Turn-by-turn directions or a new map provider.

[assumption] The editor's Taipei default and current users mean Taiwan is the
right search scope; this keeps generic place names from resolving overseas.
[assumption] A selected suggestion is the user's confirmation; typed-but-
unselected text retains the existing first-match fallback.

## Pattern anchor

`js/geocode.js`: validates external search results before the UI consumes them.
`js/routeBuilder.js`: owns Leaflet marker lifecycle and builds routes from the
selected `point` contract.

## File touch list

| File | Change |
| --- | --- |
| `js/geocode.js` | Scope and rank valid Nominatim suggestions. |
| `js/routeBuilder.js` | Render and clean up confirmed-place markers. |
| `test/geocode.test.mjs` | Cover result ranking and request scope. |
| `test/address-suggestions.mjs` | Assert selection creates a pin on the map. |

## Steps

1. Improve the pure suggestion parser and Nominatim request. Verify: targeted
   unit tests prove exact matches rank first and the request is Taiwan-scoped.
2. Render a standard Leaflet marker whenever a suggestion is selected, and keep
   it through route building. Verify: browser smoke sees the selected pins.
3. Run the pure suite and address-suggestion browser smoke. Verify: both exit
   successfully with no browser page errors.

## Review log

Cross-family review is waived: the project's global instructions prohibit
unrequested delegation. The change is constrained to the existing place-result
and Leaflet-marker contracts.
