# Animated home hero

## Goal

Replace the route list as the startup surface with a fashion-forward, non-interactive real map that starts at a random city and roams automatically, while keeping route management reachable from the first bottom function.

## Scope

- Add a dedicated home view with a full-screen real map and automatic camera motion.
- After each arrival, draw a random loop or point-to-point course using real road geometry, then hold before moving on.
- Keep the first bottom navigation destination as My Routes.
- Make the shared back control return Home.

## Out of scope

- Real map data, live traffic, user interaction with the hero map, or new dependencies.
- Route, GPS, timing, and storage behavior.

## Assumptions

- [assumption] The requested map uses the existing real map layer but remains promotional ambience.
- [assumption] My Routes is reached from the first bottom function without an extra CTA.
- [assumption] Existing Editor and Run availability rules remain unchanged.

## Steps and verification

1. Add the home view and randomized real map motion. Verify the map fills the viewport and has `pointer-events: none`.
2. Generate a loop or line, resolve it against OSRM roads, animate the line, and hold for ten seconds after completion.
3. Route the first tab and back control. Verify Home, Routes, Editor, Run, and History transitions in a browser.
4. Run `npm test`, `git diff --check`, and a focused mobile browser smoke check.

## Review log

- Cross-agent review is unavailable because this session does not authorize delegation. The change will be checked with executable unit and browser tests.
