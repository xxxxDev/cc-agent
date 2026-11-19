// The Terminal tab's two pages, as the Groups tab has its list and one room (agent-chat.js
// openGroup): the list, and one machine over it, or beside it as the list's column
// (listDetail.js); another machine takes the open one's place, and back is the list.
import {ref} from 'vue';
import {f7} from 'framework7-vue';
import {listDetailActive} from './listDetail.js';

export const viewingHost = ref(null);

export function openHost(h, mode = '') {
  const router = f7.views?.get('#view-terminal')?.router; if (!router) return;
  // The mode always written, empty too: an address updated in place keeps the query keys it does
  // not name (Framework7 merges them), so a machine opened by its SSH button left the next one
  // tapped connecting at once.
  const url = '/terminal-host/?id=' + encodeURIComponent(h.id) + '&mode=' + mode;
  const cur = router.currentRoute;
  if (cur.path === '/terminal-host/') {
    if (cur.query?.id === h.id && (cur.query?.mode || '') === mode) return;
    if (listDetailActive.value) router.updateCurrentUrl(url); else router.navigate(url, {reloadCurrent: true});
    return;
  }
  if (cur.path !== '/terminal-hosts/') router.back('/terminal-hosts/', {force: true, animate: false});
  router.navigate(url, {animate: !listDetailActive.value});
}
export function closeHost() {
  const router = f7.views?.get('#view-terminal')?.router; if (!router) return;
  const h = router.history || [];
  const animate = !listDetailActive.value;
  if (h.length >= 2 && h[h.length - 2] === '/terminal-hosts/') router.back({animate}); else router.back('/terminal-hosts/', {force: true, animate});
}
