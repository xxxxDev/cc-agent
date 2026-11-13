<template>
  <!-- 對話頁按鈕: the order of a conversation's buttons, a phone's and a computer's apart, set by
       an admin for everyone. On a phone the first ones show at the top right and the rest are in
       「⋯」, each row marked which. -->
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
        <f7-list-item v-for="(key, i) in phoneNavOrder" :key="key" :data-nav="key" :title="label(key)" :class="{ 'nav-in-menu': i >= shownCount }">
          <template #media><f7-icon :f7="icon(key)"/></template>
          <template #after><span class="nav-where" :class="i < shownCount ? 'top' : 'menu'">{{ i < shownCount ? ct('右上') : ct('「⋯」選單') }}</span></template>
        </f7-list-item>
      </f7-list>
      <f7-block-footer>{{ ct('標「右上」的顯示在右上，其餘收進「⋯」選單。沒開啟的功能不會出現，下一個會往前補。') }}</f7-block-footer>
    </template>

    <template v-else>
      <f7-block-title>{{ ct('順序') }}</f7-block-title>
      <f7-list inset sortable sortable-enabled :sortable-move-elements="false" class="fs-settings-list nav-order-list desktop-order" @sortable:sort="(e) => sort('desktop', e)">
        <f7-list-item v-for="key in navOrder" :key="key" :data-nav="key" :title="label(key)"><template #media><f7-icon :f7="icon(key)"/></template></f7-list-item>
      </f7-list>
      <f7-block-footer>{{ ct('對話頁上方和分割畫面每一格的按鈕都照這個順序，全部顯示。沒開啟的功能不會出現。') }}</f7-block-footer>
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
import { navOrder, NAV_KEYS, phoneNavOrder, PHONE_KEYS, phoneNavCount, loadAgentPreferences, saveAgentPreferences } from '../js/agentPreferences.js';

const view = ref('phone');
const countOpen = ref(false), countPoint = ref(null);
const countItems = [1, 2, 3].map((n) => ({ value: String(n), label: String(n) }));
function openCount(e) { countPoint.value = { clientX: e?.clientX ?? 0, clientY: e?.clientY ?? 0 }; countOpen.value = true; }
const NAMES = { usage: '用量統計', extensions: '擴充功能', checklist: '待辦事項', search: '搜尋對話', terminal: 'Claude 終端機', transcript: 'Transcript 檢視', profile: 'Agent Profile' };
const ICONS = { usage: 'gauge', checklist: 'checkmark_square', search: 'search', terminal: 'chevron_left_slash_chevron_right', transcript: 'ant', profile: 'info' };
const label = (key) => ct(NAMES[key] || key);
const icon = (key) => ICONS[key] || 'circle';
// With 「⋯」 among the count, the buttons shown are one fewer; all of them when they fit.
const shownCount = computed(() => (phoneNavOrder.value.length <= phoneNavCount.value ? phoneNavOrder.value.length : phoneNavCount.value - 1));
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
</style>
