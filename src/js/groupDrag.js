// Dragging a whole group, its title and its agents as one block (moving only the title, with the agents catching up on
// release, was not what a group move means). Framework7's sortable moves one row
// at a time, so a group's handle is driven here: the block follows the pointer,
// the other groups make room, and the new order of the groups goes to onDrop.
// The untitled agents at the top are not a block and stay where they are.
// In All a group moves only among its own source's groups: the blocks are that
// source's, and the other sources' rows stay put, dimmed (src/js/sourceFence.js).
import {sourceSegment, markFenced, clearFenced, outsideSource, refuseDrop} from './sourceFence.js';
const EDGE = 60, SCROLL_STEP = 8;

function blocksOf(rows) {
  const blocks = [];
  for (const row of rows) {
    if (row.classList.contains('agent-group-row')) blocks.push({id: row.dataset.group, rows: [row]});
    else if (blocks.length) blocks.at(-1).rows.push(row);
  }
  for (const block of blocks) {
    block.top = block.rows[0].getBoundingClientRect().top;
    block.bottom = block.rows.at(-1).getBoundingClientRect().bottom;
  }
  // A block's slot is its height and the gap after it: what the others move by.
  const gap = blocks[1] ? blocks[1].top - blocks[0].bottom : 0;
  blocks.forEach((block, i) => { block.slot = (blocks[i + 1] ? blocks[i + 1].top : block.bottom + gap) - block.top; });
  return blocks;
}

export function startGroupDrag(event, onDrop) {
  if (event.button !== undefined && event.button !== 0) return;
  const handle = event.currentTarget, title = handle.closest('li'), list = title?.parentElement;
  if (!list) return;
  const part = sourceSegment(title), {segment, fenced} = part;
  const blocks = blocksOf(segment), index = blocks.findIndex(block => block.rows[0] === title);
  if (index < 0 || blocks.length < 2) return;
  event.preventDefault();
  const dragged = blocks[index], scroller = list.closest('.page-content');
  const startY = event.clientY, startScroll = scroller?.scrollTop || 0;
  let target = index, lastY = event.clientY, frame = 0;
  list.classList.add('group-sorting');
  markFenced(fenced, false);
  dragged.rows.forEach(row => row.classList.add('group-dragging'));
  try { handle.setPointerCapture(event.pointerId); } catch {}

  const place = () => {
    const dy = lastY - startY + ((scroller?.scrollTop || 0) - startScroll);
    dragged.rows.forEach(row => { row.style.transform = `translate3d(0,${dy}px,0)`; });
    const centre = (dragged.top + dragged.bottom) / 2 + dy;
    target = blocks.filter((block, i) => i !== index && (block.top + block.bottom) / 2 < centre).length;
    blocks.forEach((block, i) => {
      if (i === index) return;
      const shift = index < target && i > index && i <= target ? -dragged.slot : target < index && i >= target && i < index ? dragged.slot : 0;
      block.rows.forEach(row => { row.style.transform = shift ? `translate3d(0,${shift}px,0)` : ''; });
    });
  };
  // Near the top or bottom edge the page scrolls, as it does for an agent's row.
  const scroll = () => {
    frame = 0;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const step = lastY < box.top + EDGE ? -SCROLL_STEP : lastY > box.bottom - EDGE ? SCROLL_STEP : 0;
    if (!step) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += step;
    if (scroller.scrollTop !== before) { place(); frame = requestAnimationFrame(scroll); }
  };
  const move = e => {
    e.preventDefault();
    lastY = e.clientY;
    place();
    if (!frame) frame = requestAnimationFrame(scroll);
  };
  const end = e => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    if (frame) cancelAnimationFrame(frame);
    for (const block of blocks) block.rows.forEach(row => { row.style.transform = ''; });
    dragged.rows.forEach(row => row.classList.remove('group-dragging'));
    list.classList.remove('group-sorting');
    // Let go over another source's rows, it goes back where it was.
    const refused = outsideSource(part, e?.clientY);
    clearFenced(list);
    if (refused) { refuseDrop(title); return; }
    if (target === index) return;
    const order = blocks.map(block => block.id);
    order.splice(target, 0, order.splice(index, 1)[0]);
    onDrop(order);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
