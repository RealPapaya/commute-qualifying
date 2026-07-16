// The editor / run bottom sheet is resized by dragging its handle. The panel
// follows the pointer while dragging, but on release it SNAPS to one of three
// fixed stop points (peek → half → full) — it is not a free/linear resize, and
// a tap never cycles through sizes. A plain tap (or keyboard activation) just
// toggles between collapsed and the half stop, so pointer- and keyboard-only
// users can open the sheet without a drag gesture.

const PEEK_PX = 48;          // sliver left visible at the smallest stop (the handle)
const STOPS = [0, 0.5, 1];   // the only three sizes: peek, half, full
const TAP_STOP = 0.5;        // where a tap-to-open lands
const OPEN_EPS = 0.02;       // below this the sheet counts as collapsed
const TAP_MOVE_PX = 4;       // pointer travel under this is a tap, not a drag

const sheets = [];

// The visible span the sheet can slide through: its full height minus the peek.
function maxOffsetFor(sheet) {
  return Math.max(0, sheet.getBoundingClientRect().height - PEEK_PX);
}

function nearestStop(open) {
  return STOPS.reduce((best, s) => Math.abs(s - open) < Math.abs(best - open) ? s : best, STOPS[0]);
}

export function initBottomSheets() {
  document.querySelectorAll('[data-bottom-sheet]').forEach(sheet => {
    const handle = sheet.querySelector('.sheet-handle');
    // open: 0 = collapsed (only the handle peeks), 1 = fully revealed.
    const s = { sheet, handle, open: 0 };
    sheets.push(s);

    let startY = 0, startOpen = 0, maxOffset = 0, moved = false;

    const render = () => {
      sheet.style.setProperty('--sheet-drag-offset', `${(1 - s.open) * maxOffsetFor(sheet)}px`);
      const isOpen = s.open > OPEN_EPS;
      handle.setAttribute('aria-expanded', String(isOpen));
      handle.setAttribute('aria-label', isOpen ? '收合控制面板' : '展開控制面板');
    };
    s.render = render;

    const toggle = () => {
      s.open = s.open > OPEN_EPS ? 0 : TAP_STOP;
      render();
    };

    handle.addEventListener('pointerdown', event => {
      maxOffset = maxOffsetFor(sheet);
      startOpen = s.open;
      startY = event.clientY;
      moved = false;
      sheet.dataset.dragging = '';   // suppress the snap transition while dragging
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const delta = event.clientY - startY;   // dragging up (negative) opens
      moved ||= Math.abs(delta) > TAP_MOVE_PX;
      s.open = clamp01(maxOffset > 0 ? startOpen - delta / maxOffset : startOpen);
      // Track the finger 1:1 using the offset captured at pointerdown.
      sheet.style.setProperty('--sheet-drag-offset', `${(1 - s.open) * maxOffset}px`);
    });

    const finish = event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      handle.releasePointerCapture(event.pointerId);
      delete sheet.dataset.dragging;               // re-enable the settle animation
      if (moved) s.open = nearestStop(s.open);      // snap the drag to a stop point
      else toggle();                                // a tap only opens / closes
      render();
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

    render();
  });
}

export function collapseBottomSheets() {
  sheets.forEach(s => { s.open = 0; s.render?.(); });
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
