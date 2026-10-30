// Files dragged over a chat show where they will go before they are let go. dragover
// keeps firing while the files are over the chat, so the picture stays up until it
// stops: let go, taken away, or carried off the window.
import {ref} from 'vue';

export function useFileDrag() {
  const dragging = ref(false), count = ref(0);
  let timer = null;
  function over(e, enabled) {
    if (!enabled || !Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    // Safari names no items while dragging; then the number is left out.
    count.value = Array.from(e.dataTransfer.items || []).filter(item => item.kind === 'file').length;
    dragging.value = true;
    clearTimeout(timer);
    timer = setTimeout(end, 150);
  }
  function end() { clearTimeout(timer); dragging.value = false; }
  return {dragging, count, over, end};
}
