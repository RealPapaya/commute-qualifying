// The editor / run bottom sheet is resized by dragging its handle. The panel
// follows the pointer while dragging, but on release it SNAPS to one of a few
// fixed states — it is never a free/linear resize and a tap never cycles through
// sizes. A two-state sheet is collapsed ↔ expanded; a sheet that opts in with
// [data-sheet-mid] adds a middle state (collapsed → mid → expanded). MID is the
// "focus on the clock" size: only the hero clock and a strip of sector colour
// bars show (see the [data-sheet-state="mid"] rules in the stylesheet).
//
// A plain tap (or Enter / Space) toggles between collapsed and the default open
// state, so pointer- and keyboard-only users can open the sheet without dragging.

const COLLAPSED = 'collapsed';
const MID = 'mid';
const EXPANDED = 'expanded';
const PEEK_PX = 48;          // sliver left visible when collapsed (just the handle)
const TAP_MOVE_PX = 4;       // pointer travel under this is a tap, not a drag

// Where each state sits on the 0 (collapsed peek) → 1 (fully revealed) axis. Used
// both as the drag baseline for a state and to snap a released drag to the nearest
// state. mid < expanded because mid reveals less of the panel before its content
// reflows to the clock-focus layout.
const STATE_OPEN = { [COLLAPSED]: 0, [MID]: 0.55, [EXPANDED]: 1 };

function statesFor(sheet) {
  return sheet.hasAttribute('data-sheet-mid') ? [COLLAPSED, MID, EXPANDED] : [COLLAPSED, EXPANDED];
}

function defaultOpenState(sheet) {
  return sheet.hasAttribute('data-sheet-mid') ? MID : EXPANDED;
}

// The visible span the sheet can slide through: its full height minus the peek.
function maxOffsetFor(sheet) {
  return Math.max(0, sheet.getBoundingClientRect().height - PEEK_PX);
}

// Snap a free drag position to whichever available state's open fraction is nearest.
function snapState(sheet, open) {
  const states = statesFor(sheet);
  return states.reduce((best, s) =>
    Math.abs(STATE_OPEN[s] - open) < Math.abs(STATE_OPEN[best] - open) ? s : best, states[0]);
}

const sheets = [];

export function initBottomSheets() {
  document.querySelectorAll('[data-bottom-sheet]').forEach(sheet => {
    const handle = sheet.querySelector('.sheet-handle');
    const s = { sheet, handle, state: COLLAPSED };
    sheets.push(s);

    let startY = 0, startOpen = 0, maxOffset = 0, curOpen = 0, moved = false;

    const setState = state => {
      s.state = statesFor(sheet).includes(state) ? state : COLLAPSED;
      delete sheet.dataset.dragging;
      sheet.dataset.sheetState = s.state;
      // Clear the drag override so the state's own translateY (and, for mid, its
      // clock-focus reflow) takes over and the panel animates into place.
      sheet.style.removeProperty('--sheet-drag-offset');
      const open = s.state !== COLLAPSED;
      handle.setAttribute('aria-expanded', String(open));
      handle.setAttribute('aria-label', open ? '收合控制面板' : '展開控制面板');
    };
    s.setState = setState;

    const toggle = () => setState(s.state === COLLAPSED ? defaultOpenState(sheet) : COLLAPSED);

    handle.addEventListener('pointerdown', event => {
      maxOffset = maxOffsetFor(sheet);
      startOpen = curOpen = STATE_OPEN[s.state] ?? 0;
      startY = event.clientY;
      moved = false;
      // Drag against the full-content layout: drop the state so the mid reflow
      // lifts and the panel reveals continuously under the finger.
      delete sheet.dataset.sheetState;
      sheet.dataset.dragging = '';
      sheet.style.setProperty('--sheet-drag-offset', `${(1 - startOpen) * maxOffset}px`);
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const delta = event.clientY - startY;   // dragging up (negative) opens
      moved ||= Math.abs(delta) > TAP_MOVE_PX;
      curOpen = clamp01(maxOffset > 0 ? startOpen - delta / maxOffset : startOpen);
      sheet.style.setProperty('--sheet-drag-offset', `${(1 - curOpen) * maxOffset}px`);
    });

    const finish = event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      handle.releasePointerCapture(event.pointerId);
      if (moved) setState(snapState(sheet, curOpen));   // snap the drag to a state
      else toggle();                                    // a tap only opens / closes
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);

    // Keyboard users can't drag: Enter / Space toggle the sheet open or shut.
    handle.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });

    setState(COLLAPSED);
  });
}

export function collapseBottomSheets() {
  sheets.forEach(s => s.setState?.(COLLAPSED));
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
