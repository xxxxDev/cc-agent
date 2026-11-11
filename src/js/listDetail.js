// The Agents list beside the conversation on a wide computer window
// (2026-11-10): with 清單在左、聊天在右 on, a tap on an agent narrows the list into a column
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
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

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
