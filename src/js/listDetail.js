// The Agents list beside the conversation on a wide computer window:
// with 清單在左、聊天在右 on, a tap on an agent narrows the list into a column
// on the left and opens the conversation beside it; a tap on another agent in that column
// changes the conversation without a page push. The list and the conversation are the
// same two pages of #view-chat as always (ChatListPage under ConversationPage); the
// layout is styles/listDetail.css, keyed on <html>.list-detail-on and the same width as
// LIST_DETAIL_WIDE here. Kept on each device, as the sidebar's fold is (sidebarState.js).
import {ref, computed} from 'vue';
import {PRODUCT} from './productConfig.js';
import {embedded, splitView} from './embed.js';

// The list column (320-360px) and the conversation with a side panel open still fit:
// 1280 less the open sidebar (260) and the column leaves the conversation about 700px.
export const LIST_DETAIL_WIDE = '(min-width: 1280px)';
const KEY = PRODUCT.storageKeys.listDetail;
// On unless switched off on this device: no key yet, or no
// storage at all, means on; only a saved '0' keeps it off.
const read = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };

export const listDetailOn = ref(read());
const query = typeof window !== 'undefined' ? window.matchMedia?.(LIST_DETAIL_WIDE) : null;
export const listDetailWide = ref(!!query?.matches);
query?.addEventListener?.('change', () => { listDetailWide.value = !!query.matches; });
// The split view's cells and the split view itself keep their own layout.
export const listDetailActive = computed(() => listDetailOn.value && listDetailWide.value && !embedded && !splitView);

export function setListDetail(on) {
  listDetailOn.value = !!on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
}

// The list's page is the column right now: it sits under an open conversation.
export function listIsColumn(pageEl) {
  return listDetailActive.value && !!pageEl?.classList?.contains('page-previous') && pageEl.nextElementSibling?.dataset?.name === 'conversation';
}

// The column's width, dragged at its edge: kept on the device;
// null is the built-in width. Never narrower than LIST_MIN, nor so wide that the
// conversation keeps less than CHAT_KEEP; a double click goes back to the built-in width.
const WIDTH_KEY = PRODUCT.storageKeys.listColumn;
export const LIST_MIN = 260, LIST_MAX = 640, CHAT_KEEP = 560;
const readWidth = () => { try { const n = Number(localStorage.getItem(WIDTH_KEY)); return Number.isFinite(n) && n >= LIST_MIN && n <= LIST_MAX ? n : null; } catch { return null; } };
export const listColumnWidth = ref(readWidth());
export function clampListColumn(width, viewWidth) {
  return Math.round(Math.max(LIST_MIN, Math.min(width, LIST_MAX, viewWidth - CHAT_KEEP)));
}
export function setListColumnWidth(width) {
  listColumnWidth.value = width == null ? null : Math.round(width);
  try { width == null ? localStorage.removeItem(WIDTH_KEY) : localStorage.setItem(WIDTH_KEY, String(Math.round(width))); } catch {}
}
export function startListColumnResize(event) {
  const view = event.currentTarget?.closest?.('#view-chat');
  if (!view) return;
  event.preventDefault();
  const handle = event.currentTarget, box = view.getBoundingClientRect();
  try { handle.setPointerCapture(event.pointerId); } catch {}
  document.body.classList.add('col-resizing');
  document.documentElement.classList.add('list-resizing');
  const move = (e) => { listColumnWidth.value = clampListColumn(e.clientX - box.left, box.width); };
  const end = () => {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
    document.body.classList.remove('col-resizing');
    document.documentElement.classList.remove('list-resizing');
    setListColumnWidth(listColumnWidth.value);
  };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
}
