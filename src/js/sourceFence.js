// In All, each source's part of the list opens with a title row, and an agent or
// a group is dragged only within its own source: a drop into another source
// changes nothing and saves nothing.
//
// Framework7's sortable takes the rows it may move past when the drag starts,
// every li of the list without .no-sorting or .disallow-sorting. So as an agent's
// handle is pressed, the rows of the other sources, and every source's title row,
// are marked .no-sorting for that drag: they never move aside and can never be the
// drop place, and the agent lands at the nearest place inside its own source.
// .source-fenced dims them meanwhile, the hint of where it cannot go. Let go
// outside its source, on another source's rows or on a source's title, the drop
// does not count, even where Framework7 found a place for it at the edge of its
// own source: the agent goes back where it was, with a buzz and a small shake,
// and the list's sort handler is told to save nothing.

const isSourceTitle = row => row.classList.contains('agent-source-title');

// The rows of the source the given row is in: from just after its source's title
// to just before the next title. A list with no title rows is one source.
export function sourceSegment(row) {
  const rows = [...row.parentElement.children], at = rows.indexOf(row);
  let start = at, end = at;
  while (start > 0 && !isSourceTitle(rows[start - 1])) start -= 1;
  while (end < rows.length - 1 && !isSourceTitle(rows[end + 1])) end += 1;
  return {rows, start, end, segment: rows.slice(start, end + 1), fenced: rows.filter((r, i) => i < start || i > end), above: rows[start - 1], below: rows[end + 1]};
}

// Whether a point is outside that source: up to the bottom of its own title, or
// from the top of the next source's title down. The titles do not move in a drag.
export const outsideSource = ({above, below}, y) => y != null && (!!above && y < above.getBoundingClientRect().bottom || !!below && y >= below.getBoundingClientRect().top);

export const hasSources = list => !!list?.querySelector(':scope > li.agent-source-title');

// The drop did not take: a light buzz where the device has one, and a shake.
export function refuseDrop(row) {
  try { navigator.vibrate?.(10); } catch {}
  if (!row?.classList) return;
  row.classList.remove('drop-refused');
  void row.offsetWidth;
  row.classList.add('drop-refused');
  setTimeout(() => row.classList.remove('drop-refused'), 450);
}

// The row whose drop was just refused: its sortable:sort, which Framework7 sends
// in the same release, after this module has seen it, is ignored.
let refused = null;
export const wasRefused = row => !!row && row === refused;

export function markFenced(rows, sortable) {
  for (const row of rows) { row.classList.add('source-fenced'); if (sortable) row.classList.add('no-sorting'); }
}
export function clearFenced(list) {
  for (const row of list.querySelectorAll(':scope > li.source-fenced')) row.classList.remove('source-fenced', 'no-sorting');
}

const pointY = e => e.changedTouches?.[0]?.clientY ?? e.touches?.[0]?.clientY ?? e.clientY;
const ENDS = ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'];
// One press makes a pointerdown and then a touchstart or mousedown: fenced once.
let pressed = null;

// Listened to in the capture phase on the page, so it runs before Framework7's own
// press handler, which listens on the document.
export function fenceSourceDrag(event) {
  const handle = event.target?.closest?.('.sortable-handler');
  if (!handle || handle.classList.contains('agent-group-handle')) return;
  const row = handle.closest('li'), list = row?.parentElement;
  if (!list || !list.closest('.conversation-list.sortable-enabled') || !hasSources(list)) return;
  if (row.classList.contains('disallow-sorting') || row === pressed) return;
  pressed = row;
  clearFenced(list);
  const part = sourceSegment(row), {fenced} = part, startY = pointY(event);
  markFenced(fenced, true);
  const done = e => {
    ENDS.forEach(name => document.removeEventListener(name, done, true));
    pressed = null;
    const y = pointY(e);
    const over = Math.abs((y ?? startY) - startY) > 8 && outsideSource(part, y);
    clearFenced(list);
    if (!over) return;
    refused = row;
    setTimeout(() => { refused = null; refuseDrop(row); }, 0);
  };
  ENDS.forEach(name => document.addEventListener(name, done, true));
}
