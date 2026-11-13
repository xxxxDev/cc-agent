<template>
  <!-- Group chats: several agents in one room, on
       a tab of their own, apart from the Agents list. -->
  <f7-page name="groups" class="page-large-static" @page:afterin="load" @page:position="onPosition">
    <f7-navbar large>
      <!-- Edit drags the groups into the owner's order, as on the Agents list. -->
      <f7-nav-left v-if="groups.length > 1"><f7-link class="group-edit" :aria-label="ct('編輯群組順序')" @click="toggleEdit">{{ editMode ? 'Done' : 'Edit' }}</f7-link></f7-nav-left>
      <f7-nav-title sliding>{{ t('tabGroups') }}</f7-nav-title>
      <f7-nav-right><f7-link icon-only icon-f7="plus" class="group-add" :aria-label="ct('新增群組')" @click="openForm()" /></f7-nav-right>
      <f7-nav-title-large>{{ t('tabGroups') }}</f7-nav-title-large>
    </f7-navbar>
    <div v-if="loaded && !error && groups.length" class="group-search-row">
      <f7-searchbar class="group-search" :inline="true" :disable-button="false" :clear-button="true" :placeholder="ct('搜尋群組或成員')" :value="search" @input="search = $event.target.value" @searchbar:clear="search = ''" />
    </div>
    <f7-block v-if="!loaded && !error" class="group-state"><f7-preloader /></f7-block>
    <f7-block v-else-if="error" class="group-state">{{ error }}</f7-block>
    <f7-block v-else-if="!groups.length" class="group-empty">{{ ct('還沒有群組。按右上角的＋，挑幾個 agent 組成一個聊天室，指定一位主負責。') }}</f7-block>
    <f7-block v-else-if="!shown.length" class="group-state">{{ ct('沒有符合的群組') }}</f7-block>
    <f7-list v-else inset media-list sortable :sortable-enabled="editMode && !search && !orderBusy" :sortable-move-elements="false" class="group-list" :class="{ editing: editMode }" @sortable:sort="reorder">
      <f7-list-item v-for="g in shown" :key="g.id" :swipeout="!editMode" :link="editMode ? false : '#'" :class="{ 'row-current': viewingGroup === g.id }" :data-id="g.id" @click.prevent="!editMode && open(g)">
        <template #media><span class="group-avatar"><img v-if="leadOf(g)?.avatar" :src="leadOf(g).avatar" :class="'group-avatar-' + avatarShape(leadOf(g).avatar)" alt="" /><img v-else-if="leadOf(g)" :src="defaultAvatar(leadOf(g))" class="group-avatar-icon" alt="" /><span class="group-count" :aria-label="g.members.length + ' ' + ct('位成員')">{{ g.members.length }}</span></span></template>
        <template #title>{{ g.name }}<i v-if="g.notify === false" class="icon f7-icons group-muted" :aria-label="ct('通知已關')">bell_slash_fill</i></template>
        <template #after>{{ when(g.updatedAt) }}</template>
        <template #subtitle>{{ g.members.length }} {{ ct('位成員') }} · {{ ct('主負責') }} {{ leadName(g) }}</template>
        <template #text>{{ g.preview || ct('尚無對話') }}</template>
        <f7-swipeout-actions v-if="!editMode" right>
          <!-- The group's notifications, on or off. -->
          <f7-swipeout-button close class="swipe-round notify" :aria-label="ct(g.notify === false ? '開啟通知' : '關閉通知') + ' ' + g.name" @click="toggleNotify(g)"><span class="swipe-circle"><i class="icon f7-icons">{{ g.notify === false ? 'bell_fill' : 'bell_slash_fill' }}</i></span></f7-swipeout-button>
          <f7-swipeout-button close class="swipe-round edit" :aria-label="ct('編輯') + ' ' + g.name" @click="openForm(g)"><span class="swipe-circle"><i class="icon f7-icons">pencil</i></span></f7-swipeout-button>
          <f7-swipeout-button close class="swipe-round delete" :aria-label="ct('刪除') + ' ' + g.name" @click="remove(g)"><span class="swipe-circle"><i class="icon f7-icons">trash_fill</i></span></f7-swipeout-button>
        </f7-swipeout-actions>
      </f7-list-item>
    </f7-list>
    <Teleport to=".framework7-root">
      <GroupForm :open="formOpen" :group="editing" @close="formOpen = false" @saved="saved" />
    </Teleport>
  </f7-page>
</template>

<script setup>
import { ref, computed, inject, nextTick, onMounted, onBeforeUnmount, watch, Teleport } from 'vue';
import { f7 } from 'framework7-vue';
import { t, timeLocale } from '../js/i18n.js';
import { ct } from '../js/agent-i18n.js';
import { avatarShape, defaultAvatar } from '../js/avatarShape.js';
import { activeTab } from '../js/tab-session.js';
import { groups, viewingGroup, loadGroups, removeGroup, reorderGroups, updateGroup } from '../js/groups.js';
import { listIsColumn } from '../js/listDetail.js';
import GroupForm from '../components/GroupForm.vue';

// The lead, or the first member if the lead is gone.
const leadOf = (g) => g.members.find((m) => m.id === g.lead) || g.members[0];

const w = inject('workspace');
const loaded = ref(false), error = ref(''), formOpen = ref(false), editing = ref(null);
const editMode = ref(false), orderBusy = ref(false), search = ref('');
// A group by its name or any member's; what was
// said in it is searched inside the room.
const shown = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? groups.value.filter((g) => g.name.toLowerCase().includes(q) || g.members.some((m) => String(m.title).toLowerCase().includes(q))) : groups.value;
});
function toggleEdit() { editMode.value = !editMode.value; if (editMode.value) search.value = ''; }
async function reorder({ from, to }) {
  if (from === to || orderBusy.value) return;
  const list = [...groups.value];
  list.splice(to, 0, list.splice(from, 1)[0]);
  groups.value = list;
  orderBusy.value = true;
  try { await reorderGroups(list.map((g) => g.id)); } catch (e) { f7.dialog.alert(e.message, ct('編輯群組順序')); await load(); } finally { orderBusy.value = false; }
}
async function load() {
  try { await loadGroups(); error.value = ''; } catch (e) { error.value = e.message; } finally { loaded.value = true; }
}
const leadName = (g) => g.members.find((m) => m.id === g.lead)?.title || '';
function when(iso) {
  if (!iso) return '';
  const d = new Date(iso), today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString(timeLocale(), { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(timeLocale(), { month: 'numeric', day: 'numeric' });
}
// The room over the list, or beside it as the list's column, where another row switches the
// room in place (listDetail.js, agent-chat.js openGroup).
function open(g) { w.openGroup(g.id); }
// Framework7 hides the page under the current one from assistive technology; as the
// column it is in use.
function onPosition() { nextTick(() => { const el = document.querySelector('#view-groups > .page[data-name="groups"]'); if (listIsColumn(el, 'group')) el.removeAttribute('aria-hidden'); }); }
function openForm(g = null) { editing.value = g; formOpen.value = true; }
function saved(g) { formOpen.value = false; if (!editing.value && g?.id) open(g); }
async function toggleNotify(g) {
  try { await updateGroup(g.id, { notify: g.notify === false }); } catch (e) { f7.dialog.alert(e.message, ct('群組')); }
}
function remove(g) {
  f7.dialog.confirm(ct('刪除群組「') + g.name + ct('」和裡面的對話？成員 agent 自己的聊天室不受影響。'), ct('刪除群組'), async () => {
    try { await removeGroup(g.id); } catch (e) { f7.dialog.alert(e.message, ct('刪除群組')); }
  });
}
// Kept current while the tab is in front: a reply changes a row's preview.
const onChanged = () => { if (activeTab.value === 'view-groups') load(); };
onMounted(() => { load(); window.addEventListener('cc-agent-changed', onChanged); });
onBeforeUnmount(() => window.removeEventListener('cc-agent-changed', onChanged));
watch(activeTab, (tab) => { if (tab === 'view-groups') load(); });
</script>

<style scoped>
.group-search-row { padding: 0 16px; margin: var(--f7-list-margin-vertical, 32px) 0; }
@media (min-width: 1024px) { .group-search-row { max-width: min(828px, calc(100% - 32px)); margin-left: auto; margin-right: auto; padding: 0; } }
.group-state, .group-empty { color: var(--cc-color-text-secondary); line-height: 1.5; }
.list.group-list > ul > li.swipeout { border-radius: var(--cc-radius-card); }
.group-list :deep(.swipeout-actions-right) { display: flex; align-items: center; gap: 10px; padding: 0 14px 0 6px; background: transparent; }
.group-list :deep(.swipeout-actions-right > a.swipe-round) { background: transparent; padding: 0; min-width: 0; width: auto; height: auto; }
.swipe-circle { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 22px; color: #fff; }
.swipe-circle .icon { font-size: 19px; }
.notify .swipe-circle { background: #5e5ce6; }
.edit .swipe-circle { background: #8e8e93; }
.group-muted { font-size: 14px; margin-left: 6px; vertical-align: 0; opacity: .55; }
.delete .swipe-circle { background: #ff3b30; }
/* The lead's face, and the number of members at its lower right. */
/* The same tile as an agent on the Agents list. */
.group-avatar { position: relative; display: flex; align-items: center; justify-content: center; width: 45px; height: 45px; border-radius: 38%; background: var(--cc-surface-card); box-shadow: var(--cc-glass-ring) 2px 2px 2px -2px inset, var(--cc-glass-ring) -2px -2px 2px -2px inset; }
.group-avatar-photo { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.group-avatar-icon { width: 76%; height: 76%; object-fit: contain; }
.group-avatar-unknown { width: 28px; height: 28px; visibility: hidden; }
.group-count { position: absolute; right: -6px; bottom: -5px; min-width: 20px; height: 20px; box-sizing: border-box; padding: 0 5px; border-radius: 10px; border: 2px solid var(--f7-list-bg-color); background: #3a3a3c; color: #fff; font-size: 11px; font-weight: 700; line-height: 16px; text-align: center; }
</style>
