<template>
  <!-- 對話頁按鈕: the order of a conversation's buttons, a phone's and a computer's apart, set by
       an admin for everyone, with an eye on each row to hide a button (the terminal's and the
       Transcript's are the switches they replaced on the Admin page). On a phone the first ones
       show at the top right and the rest are in 「⋯」, each row marked which. -->
  <f7-page name="nav-buttons" class="page-large-static nav-buttons-page" @page:afterin="load">
    <f7-navbar large>
      <f7-nav-left :back-link="true"></f7-nav-left>
      <f7-nav-title sliding>{{ ct('對話頁按鈕') }}</f7-nav-title>
      <f7-nav-title-large>{{ ct('對話頁按鈕') }}</f7-nav-title-large>
    </f7-navbar>

    <div class="nav-buttons-views">
      <f7-segmented strong tag="div">
        <f7-button :active="view === 'phone'" class="nav-view-phone" @click="view = 'phone'">{{ ct('手機版') }}</f7-button>
        <f7-button :active="view === 'desktop'" class="nav-view-desktop" @click="view = 'desktop'">{{ ct('電腦版') }}</f7-button>
      </f7-segmented>
    </div>

    <template v-if="view === 'phone'">
      <!-- A row with its value, choosing from a menu as the Admin page's other choices do. -->
      <f7-list inset class="fs-settings-list">
        <f7-list-item link no-chevron class="phone-nav-count" :title="ct('右上按鈕數量')" :after="String(phoneNavCount)" :footer="ct('含「⋯」。')" @click.prevent="openCount"><template #media><f7-icon f7="device_phone_portrait"/></template></f7-list-item>
      </f7-list>
      <f7-block-title>{{ ct('順序') }}</f7-block-title>
      <f7-list inset sortable sortable-enabled :sortable-move-elements="false" class="fs-settings-list nav-order-list phone-order" @sortable:sort="(e) => sort('phone', e)">
        <f7-list-item v-for="key in phoneNavOrder" :key="key" :data-nav="key" :title="label(key)" :class="{ 'nav-in-menu': !hidden(key) && place(key) >= shownCount, 'nav-hidden': hidden(key) }">
          <template #media><f7-icon :f7="icon(key)"/></template>
          <template #after><span class="nav-where" :class="hidden(key) ? 'off' : place(key) < shownCount ? 'top' : 'menu'">{{ hidden(key) ? ct('已隱藏') : place(key) < shownCount ? ct('右上') : ct('「⋯」選單') }}</span><button type="button" class="nav-eye" :class="{ off: hidden(key) }" :aria-pressed="String(!hidden(key))" :aria-label="(hidden(key) ? ct('顯示') : ct('隱藏')) + ' ' + label(key)" @click.stop.prevent="toggle(key)"><f7-icon :f7="hidden(key) ? 'eye_slash' : 'eye'"/></button></template>
        </f7-list-item>
      </f7-list>
      <f7-block-footer>{{ ct('標「右上」的顯示在右上，其餘收進「⋯」選單。按眼睛隱藏按鈕，手機和電腦一起。沒開啟的功能不會出現，下一個會往前補。') }}</f7-block-footer>
    </template>

    <template v-else>
      <f7-block-title>{{ ct('順序') }}</f7-block-title>
      <f7-list inset sortable sortable-enabled :sortable-move-elements="false" class="fs-settings-list nav-order-list desktop-order" @sortable:sort="(e) => sort('desktop', e)">
        <f7-list-item v-for="key in navOrder" :key="key" :data-nav="key" :title="label(key)" :class="{ 'nav-hidden': hidden(key) }"><template #media><f7-icon :f7="icon(key)"/></template><template #after><button type="button" class="nav-eye" :class="{ off: hidden(key) }" :aria-pressed="String(!hidden(key))" :aria-label="(hidden(key) ? ct('顯示') : ct('隱藏')) + ' ' + label(key)" @click.stop.prevent="toggle(key)"><f7-icon :f7="hidden(key) ? 'eye_slash' : 'eye'"/></button></template></f7-list-item>
      </f7-list>
      <f7-block-footer>{{ ct('對話頁上方和分割畫面每一格的按鈕都照這個順序。按眼睛隱藏按鈕，手機和電腦一起。沒開啟的功能不會出現。') }}</f7-block-footer>
    </template>

    <f7-block><f7-link class="nav-order-reset" @click="reset">{{ view === 'phone' ? ct('恢復手機版預設') : ct('恢復電腦版預設') }}</f7-link></f7-block>
    <GlassDropdown :open="countOpen" :point="countPoint" :items="countItems" :selected="String(phoneNavCount)" @close="countOpen = false" @select="(v) => { countOpen = false; setCount(Number(v)); }" />
  </f7-page>
</template>

<script setup>
import { computed, ref } from 'vue';
import { f7 } from 'framework7-vue';
import { t } from '../js/i18n.js';
import { ct } from '../js/agent-i18n.js';
import GlassDropdown from '../components/GlassDropdown.vue';
import { navOrder, NAV_KEYS, phoneNavOrder, PHONE_KEYS, phoneNavCount, navHidden, navShown, terminalSwitch, transcriptSwitch, loadAgentPreferences, saveAgentPreferences } from '../js/agentPreferences.js';

const view = ref('phone');
const countOpen = ref(false), countPoint = ref(null);
const countItems = [1, 2, 3].map((n) => ({ value: String(n), label: String(n) }));
function openCount(e) { countPoint.value = { clientX: e?.clientX ?? 0, clientY: e?.clientY ?? 0 }; countOpen.value = true; }
const NAMES = { usage: '用量統計', extensions: '擴充功能', checklist: '待辦事項', files: '檔案清單', search: '搜尋對話', terminal: 'Claude 終端機', transcript: 'Transcript 檢視', profile: 'Agent Profile' };
const ICONS = { usage: 'gauge', checklist: 'checkmark_square', files: 'folder', search: 'search', terminal: 'chevron_left_slash_chevron_right', transcript: 'ant', profile: 'info' };
const label = (key) => ct(NAMES[key] || key);
const icon = (key) => ICONS[key] || 'circle';
// The eyes: a hidden button is on neither a phone nor a computer, and the next one takes its
// place; the terminal's and the Transcript's are the switches they replaced.
const hidden = (key) => !navShown(key);
const phoneVisible = computed(() => phoneNavOrder.value.filter((k) => !hidden(k)));
const place = (key) => phoneVisible.value.indexOf(key);
function toggle(key) {
  const now = NAV_KEYS.filter(hidden), next = hidden(key) ? now.filter((k) => k !== key) : NAV_KEYS.filter((k) => k === key || now.includes(k));
  const was = [navHidden.value, terminalSwitch.value, transcriptSwitch.value];
  navHidden.value = next; terminalSwitch.value = !next.includes('terminal'); transcriptSwitch.value = !next.includes('transcript');
  save({ navHidden: next }, () => { [navHidden.value, terminalSwitch.value, transcriptSwitch.value] = was; });
}
// With 「⋯」 among the count, the buttons shown are one fewer; all of them when they fit.
const shownCount = computed(() => (phoneVisible.value.length <= phoneNavCount.value ? phoneVisible.value.length : phoneNavCount.value - 1));
const toast = (text) => f7.toast.create({ text, closeTimeout: 1800 }).open();
const load = () => loadAgentPreferences().catch(() => {});

async function save(patch, undo) {
  try { await saveAgentPreferences(patch); toast(t('settingsSaved')); } catch (e) { undo(); f7.dialog.alert(e.message); }
}
function sort(which, { from, to }) {
  if (from === to) return;
  const list = which === 'phone' ? phoneNavOrder : navOrder, was = list.value, next = [...was];
  next.splice(to, 0, next.splice(from, 1)[0]);
  list.value = next;
  save(which === 'phone' ? { phoneNavOrder: next } : { navOrder: next }, () => { list.value = was; });
}
function setCount(n) {
  if (n === phoneNavCount.value) return;
  const was = phoneNavCount.value; phoneNavCount.value = n;
  save({ phoneNavCount: n }, () => { phoneNavCount.value = was; });
}
function reset() {
  const [list, keys, field] = view.value === 'phone' ? [phoneNavOrder, PHONE_KEYS, 'phoneNavOrder'] : [navOrder, NAV_KEYS, 'navOrder'];
  if (JSON.stringify(list.value) === JSON.stringify(keys)) return;
  const was = list.value; list.value = [...keys];
  save({ [field]: [...keys] }, () => { list.value = was; });
}
</script>

<style>
.nav-buttons-views { margin: 8px auto 0; padding: 0 16px; max-width: 828px; box-sizing: border-box; }
@media (min-width: 768px) { .nav-buttons-views { padding: 0; max-width: min(828px, calc(100% - 32px)); } }
.nav-buttons-page .nav-where { font-size: 13px; color: var(--f7-list-item-after-text-color); }
.nav-buttons-page .nav-where.top { color: var(--cc-accent-blue, var(--f7-theme-color)); }
.nav-buttons-page .nav-in-menu .item-title, .nav-buttons-page .nav-in-menu .item-media { opacity: .6; }
.nav-buttons-page .nav-hidden .item-title, .nav-buttons-page .nav-hidden .item-media { opacity: .35; }
.nav-buttons-page .nav-order-list .item-after { display: flex; align-items: center; align-self: center; }
.nav-buttons-page .nav-eye { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; margin: 0 2px 0 6px; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--cc-accent-blue, var(--f7-theme-color)); cursor: pointer; }
.nav-buttons-page .nav-eye .f7-icons { font-size: 20px; }
.nav-buttons-page .nav-eye.off { color: var(--f7-list-item-after-text-color); }
@media (hover: hover) { .nav-buttons-page .nav-eye:hover { background: rgba(127,127,127,.15); } }
</style>
