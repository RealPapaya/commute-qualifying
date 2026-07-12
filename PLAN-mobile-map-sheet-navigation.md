# Mobile map sheet and navigation adjustment

## Goal

Make every map mode rely on the top-left back control, remove map zoom controls and the bottom four-button navigation, and keep the mode content in a bottom sheet that is only slightly visible until the user drags it upward.

## Scope

- Remove the visible map `+` / `-` controls.
- Change the lower mode content to a draggable, low resting bottom sheet that can expand upward.
- Remove the bottom four-button navigation in every mode.
- Preserve the existing top-left back behavior.

## Out of scope

- Route calculation, recording, and mode business logic.
- Desktop-only redesign beyond what is required for consistent responsive behavior.
- New navigation destinations or gestures outside the bottom sheet.

## Assumptions

- [assumption] "每個模式" means every mode rendered by the shared application shell.
- [assumption] "只會顯示一點點" means the sheet's collapsed state should expose a grab handle / small preview, not the full controls.
- [assumption] Existing sheet drag behavior should be reused if present instead of introducing a new interaction library.

## Steps and verification

1. Trace the shared map controls, mode sheet, and navigation shell. Verify with targeted `rg` results and neighboring code reads.
2. Apply the smallest shared HTML/CSS/JS changes. Verify with the existing test suite and build command, if available.
3. Exercise each mode in a browser-sized smoke check and confirm: no zoom control, no four-button footer, top-left back remains, collapsed and expanded sheet states work.

## Review log

- Cross-agent planning/review is not permitted in this session because the user did not authorize delegation; verification will use executable checks and focused browser inspection.
