// The computer's sidebar folded to a rail of icons:
// folded by hand with the handle on its edge, or kept folded by the setting
// 自動收合電腦版選單, where it opens over the page while the mouse is on it. Both
// are kept on each device, since they are about that screen.
import {ref, computed} from 'vue';
import {PRODUCT} from './productConfig.js';

const KEYS = {folded: PRODUCT.storageKeys.sidebarFolded, auto: PRODUCT.storageKeys.sidebarAuto};
// A setting with no saved value takes its default: the automatic fold is on unless switched
// off on this device, the hand fold off.
const read = (key, fallback = false) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; } };
const write = (key, on) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch {} };

export const sidebarFolded = ref(read(KEYS.folded));
export const sidebarAuto = ref(read(KEYS.auto, true));
// The mouse is on the sidebar while it folds by itself.
export const sidebarPeek = ref(false);
// The page keeps the rail's room; the sidebar itself is narrow unless it is peeking.
export const sidebarRail = computed(() => sidebarAuto.value || sidebarFolded.value);
export const sidebarNarrow = computed(() => sidebarRail.value && !(sidebarAuto.value && sidebarPeek.value));

export function setSidebarFolded(on) { sidebarFolded.value = !!on; write(KEYS.folded, !!on); }
export function setSidebarAuto(on) { sidebarAuto.value = !!on; sidebarPeek.value = false; write(KEYS.auto, !!on); }

let timer = null;
// A short wait both ways, so passing the mouse across it does not open it.
export function peekSidebar(on) {
  clearTimeout(timer);
  if (!sidebarAuto.value) { sidebarPeek.value = false; return; }
  timer = setTimeout(() => { sidebarPeek.value = on; }, on ? 120 : 250);
}
