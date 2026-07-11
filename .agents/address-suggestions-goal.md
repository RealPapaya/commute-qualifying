# Address suggestions

Goal: Let users select a matching location from a dropdown while entering a start, via, or end address.

Acceptance criteria:
- Typing a partial address shows up to five valid Nominatim matches beneath that field.
- Selecting a match fills the field and the route planner uses that selected coordinate.
- Existing typed-address routing remains available and the automated tests pass.
