const COLLAPSED = 'collapsed';
const MID = 'mid';
const EXPANDED = 'expanded';
const DRAG_THRESHOLD_PX = 36;

// A sheet is either two-state (collapsed ↔ expanded) or, when it opts in with
// [data-sheet-mid], three-state (collapsed → mid → expanded). MID is the
// "focus on the clock" size: only the hero clock and a strip of sector colour
// bars show (see the [data-sheet-state="mid"] rules in the stylesheet).
function statesFor(sheet) {
  return sheet.hasAttribute('data-sheet-mid') ? [COLLAPSED, MID, EXPANDED] : [COLLAPSED, EXPANDED];
}

export function initBottomSheets() {
  document.querySelectorAll('[data-bottom-sheet]').forEach(sheet => {
    const handle = sheet.querySelector('.sheet-handle');
    let startY = 0;
    let startOffset = 0;
    let maxOffset = 0;
    let moved = false;

    handle.addEventListener('pointerdown', event => {
      maxOffset = Math.max(0, sheet.getBoundingClientRect().height - handle.offsetHeight);
      // Collapsed sits at maxOffset; mid and expanded both sit flush at the top.
      startOffset = sheet.dataset.sheetState === COLLAPSED ? maxOffset : 0;
      startY = event.clientY;
      moved = false;
      sheet.dataset.dragging = '';
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const delta = event.clientY - startY;
      moved ||= Math.abs(delta) > 4;
      const offset = Math.max(0, Math.min(maxOffset, startOffset + delta));
      sheet.style.setProperty('--sheet-drag-offset', `${offset}px`);
    });

    const finishDrag = event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const delta = event.clientY - startY;
      const states = statesFor(sheet);
      const idx = Math.max(0, states.indexOf(sheet.dataset.sheetState));
      // Drag steps one size in the drag direction; a tap cycles up and wraps.
      const nextIdx = moved
        ? (delta < -DRAG_THRESHOLD_PX ? Math.min(states.length - 1, idx + 1)
          : delta > DRAG_THRESHOLD_PX ? Math.max(0, idx - 1) : idx)
        : (idx + 1) % states.length;
      setSheetState(sheet, states[nextIdx]);
      handle.releasePointerCapture(event.pointerId);
    };

    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    setSheetState(sheet, COLLAPSED);
  });
}

export function collapseBottomSheets() {
  document.querySelectorAll('[data-bottom-sheet]').forEach(sheet => setSheetState(sheet, COLLAPSED));
}

function setSheetState(sheet, state) {
  const next = statesFor(sheet).includes(state) ? state : COLLAPSED;
  sheet.dataset.sheetState = next;
  delete sheet.dataset.dragging;
  sheet.style.removeProperty('--sheet-drag-offset');
  const handle = sheet.querySelector('.sheet-handle');
  const open = next !== COLLAPSED;
  handle.setAttribute('aria-expanded', String(open));
  handle.setAttribute('aria-label', open ? '收合控制面板' : '展開控制面板');
}
