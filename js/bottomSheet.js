const COLLAPSED = 'collapsed';
const EXPANDED = 'expanded';
const DRAG_THRESHOLD_PX = 36;

export function initBottomSheets() {
  document.querySelectorAll('[data-bottom-sheet]').forEach(sheet => {
    const handle = sheet.querySelector('.sheet-handle');
    let startY = 0;
    let startOffset = 0;
    let maxOffset = 0;
    let moved = false;

    handle.addEventListener('pointerdown', event => {
      maxOffset = Math.max(0, sheet.getBoundingClientRect().height - handle.offsetHeight);
      startOffset = sheet.dataset.sheetState === EXPANDED ? 0 : maxOffset;
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
      const currentState = sheet.dataset.sheetState;
      const nextState = moved
        ? (delta < -DRAG_THRESHOLD_PX ? EXPANDED : delta > DRAG_THRESHOLD_PX ? COLLAPSED : currentState)
        : (currentState === EXPANDED ? COLLAPSED : EXPANDED);
      setSheetState(sheet, nextState);
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
  const expanded = state === EXPANDED;
  sheet.dataset.sheetState = expanded ? EXPANDED : COLLAPSED;
  delete sheet.dataset.dragging;
  sheet.style.removeProperty('--sheet-drag-offset');
  const handle = sheet.querySelector('.sheet-handle');
  handle.setAttribute('aria-expanded', String(expanded));
  handle.setAttribute('aria-label', expanded ? '收合控制面板' : '展開控制面板');
}
