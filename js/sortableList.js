export function initSortableList(list, { itemSelector, handleSelector, onChange }) {
  let dragged = null;
  let pointerId = null;
  let startIndex = -1;

  const items = () => [...list.querySelectorAll(`:scope > ${itemSelector}`)];
  const finish = () => {
    if (!dragged) return;
    const item = dragged;
    const from = startIndex;
    const to = items().indexOf(item);
    item.classList.remove('dragging');
    dragged = null;
    pointerId = null;
    startIndex = -1;
    if (from !== to) onChange?.(item, from, to);
  };

  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest(handleSelector);
    const item = handle?.closest(itemSelector);
    if (!item || item.parentElement !== list) return;
    event.preventDefault();
    dragged = item;
    pointerId = event.pointerId;
    startIndex = items().indexOf(item);
    item.classList.add('dragging');
    try { handle.setPointerCapture?.(pointerId); } catch { /* capture is optional */ }
  });

  window.addEventListener('pointermove', event => {
    if (!dragged || event.pointerId !== pointerId) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(itemSelector);
    if (!target || target === dragged || target.parentElement !== list) return;
    const before = event.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2;
    list.insertBefore(dragged, before ? target : target.nextSibling);
  });
  window.addEventListener('pointerup', event => {
    if (event.pointerId === pointerId) finish();
  });
  window.addEventListener('pointercancel', event => {
    if (event.pointerId === pointerId) finish();
  });

  list.addEventListener('keydown', event => {
    const handle = event.target.closest(handleSelector);
    const item = handle?.closest(itemSelector);
    if (!item || item.parentElement !== list || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const rows = items();
    const from = rows.indexOf(item);
    const to = Math.max(0, Math.min(rows.length - 1, from + (event.key === 'ArrowUp' ? -1 : 1)));
    if (from === to) return;
    event.preventDefault();
    if (to < from) list.insertBefore(item, rows[to]);
    else list.insertBefore(item, rows[to].nextSibling);
    onChange?.(item, from, to);
    handle.focus();
  });
}
