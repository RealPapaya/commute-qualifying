const MAX_ZOOM = 8;
const states = new WeakMap();

const formatViewBox = viewBox =>
  viewBox.map(value => Number(value.toFixed(3))).join(' ');

function parseViewBox(svg) {
  const values = svg?.getAttribute('viewBox')?.split(/\s+/).map(Number);
  return values?.length === 4 && values.every(Number.isFinite) ? values : null;
}

function clampViewBox(viewBox, base) {
  const [bx, by, bw, bh] = base;
  const width = Math.max(bw / MAX_ZOOM, Math.min(bw, viewBox[2]));
  const height = width * bh / bw;
  return [
    Math.max(bx, Math.min(bx + bw - width, viewBox[0])),
    Math.max(by, Math.min(by + bh - height, viewBox[1])),
    width,
    height,
  ];
}

function applyViewBox(state, viewBox) {
  state.userViewBox = clampViewBox(viewBox, state.baseViewBox);
  state.svg?.setAttribute('viewBox', formatViewBox(state.userViewBox));
}

function pointerRatio(svg, x, y) {
  const rect = svg.getBoundingClientRect();
  return [
    Math.max(0, Math.min(1, (x - rect.left) / (rect.width || 1))),
    Math.max(0, Math.min(1, (y - rect.top) / (rect.height || 1))),
  ];
}

function startGesture(state) {
  const pointers = [...state.pointers.values()];
  const viewBox = parseViewBox(state.svg);
  if (!viewBox || pointers.length === 0) {
    state.gesture = null;
  } else if (pointers.length === 1) {
    state.gesture = { type: 'drag', point: pointers[0], viewBox };
  } else {
    const [a, b] = pointers;
    state.gesture = {
      type: 'pinch',
      distance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      midpoint: [(a.x + b.x) / 2, (a.y + b.y) / 2],
      viewBox,
    };
  }
}

function updateGesture(state) {
  const pointers = [...state.pointers.values()];
  const gesture = state.gesture;
  if (!gesture || !state.svg) return;

  if (gesture.type === 'drag' && pointers.length === 1) {
    const point = pointers[0];
    const rect = state.svg.getBoundingClientRect();
    applyViewBox(state, [
      gesture.viewBox[0] - (point.x - gesture.point.x) * gesture.viewBox[2] / (rect.width || 1),
      gesture.viewBox[1] - (point.y - gesture.point.y) * gesture.viewBox[3] / (rect.height || 1),
      gesture.viewBox[2],
      gesture.viewBox[3],
    ]);
  } else if (gesture.type === 'pinch' && pointers.length >= 2) {
    const [a, b] = pointers;
    const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const midpoint = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const startRatio = pointerRatio(state.svg, ...gesture.midpoint);
    const currentRatio = pointerRatio(state.svg, ...midpoint);
    const anchor = [
      gesture.viewBox[0] + startRatio[0] * gesture.viewBox[2],
      gesture.viewBox[1] + startRatio[1] * gesture.viewBox[3],
    ];
    const width = gesture.viewBox[2] / (distance / gesture.distance);
    const height = width * state.baseViewBox[3] / state.baseViewBox[2];
    applyViewBox(state, [
      anchor[0] - currentRatio[0] * width,
      anchor[1] - currentRatio[1] * height,
      width,
      height,
    ]);
  }
}

function initInteraction(container) {
  const state = {
    container,
    svg: null,
    baseViewBox: [0, 0, 1, 1],
    initialViewBox: [0, 0, 1, 1],
    userViewBox: null,
    pointers: new Map(),
    gesture: null,
  };
  states.set(container, state);
  Object.assign(container.style, { touchAction: 'none', userSelect: 'none', cursor: 'grab' });

  container.addEventListener('wheel', event => {
    const viewBox = parseViewBox(state.svg);
    if (!viewBox) return;
    event.preventDefault();
    const [rx, ry] = pointerRatio(state.svg, event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.045 : 0.0015));
    const width = viewBox[2] / factor;
    const height = width * state.baseViewBox[3] / state.baseViewBox[2];
    const anchorX = viewBox[0] + rx * viewBox[2];
    const anchorY = viewBox[1] + ry * viewBox[3];
    applyViewBox(state, [anchorX - rx * width, anchorY - ry * height, width, height]);
  }, { passive: false });

  container.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try { container.setPointerCapture?.(event.pointerId); } catch { /* capture is optional */ }
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture(state);
    container.style.cursor = 'grabbing';
  });
  window.addEventListener('pointermove', event => {
    if (!state.pointers.has(event.pointerId)) return;
    event.preventDefault();
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updateGesture(state);
  });
  const endPointer = event => {
    if (!state.pointers.delete(event.pointerId)) return;
    startGesture(state);
    if (state.pointers.size === 0) container.style.cursor = 'grab';
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  return state;
}

function preserveViewBox(viewBox, oldBase, newBase) {
  const zoom = oldBase[2] / viewBox[2];
  const centerX = (viewBox[0] + viewBox[2] / 2 - oldBase[0]) / oldBase[2];
  const centerY = (viewBox[1] + viewBox[3] / 2 - oldBase[1]) / oldBase[3];
  const width = newBase[2] / zoom;
  const height = newBase[3] / zoom;
  return clampViewBox([
    newBase[0] + centerX * newBase[2] - width / 2,
    newBase[1] + centerY * newBase[3] - height / 2,
    width,
    height,
  ], newBase);
}

export function bindTrackDiagramInteraction(container, svg, baseViewBox, initialViewBox) {
  if (typeof container.addEventListener !== 'function') return;
  const state = states.get(container) || initInteraction(container);
  const oldBase = state.baseViewBox;
  state.svg = svg;
  state.baseViewBox = baseViewBox;
  state.initialViewBox = initialViewBox;
  if (state.userViewBox) {
    state.userViewBox = preserveViewBox(state.userViewBox, oldBase, baseViewBox);
    svg.setAttribute('viewBox', formatViewBox(state.userViewBox));
  }
}

export function resetTrackDiagramView(container) {
  const state = states.get(container);
  if (!state) return;
  state.userViewBox = null;
  state.pointers.clear();
  state.gesture = null;
  state.container.style.cursor = 'grab';
  state.svg?.setAttribute('viewBox', formatViewBox(state.initialViewBox));
}
