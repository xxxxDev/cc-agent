<template>
  <!-- The Terminal tab: this computer, the machines saved
       here and the ones in ~/.ssh/config, laid out as the Groups tab is (GroupsPage.vue): Edit,
       the title, + and the search, and on a wide computer window the list as a column beside the
       open machine (listDetail.js, styles/listDetail.css). Edit drags the machines into an order
       and into categories of their own, as on the Agents list. An admin's only. -->
  <f7-page name="terminal-hosts" class="page-large-static terminal-hosts-page" @page:afterin="load" @page:position="onPosition">
    <f7-navbar large>
      <f7-nav-left><f7-link v-show="hosts.length > 1 || editMode || hiddenCount > 0" class="hosts-edit" :aria-label="ct('編輯主機清單')" @click="toggleEdit">{{ editMode ? 'Done' : 'Edit' }}</f7-link></f7-nav-left>
      <f7-nav-title sliding>{{ t('tabTerminal') }}</f7-nav-title>
      <f7-nav-right><f7-link icon-only icon-f7="plus" class="host-add" :aria-label="ct('新增主機')" :title="ct('新增主機')" @click="openForm(null)" /></f7-nav-right>
      <f7-nav-title-large>{{ t('tabTerminal') }}</f7-nav-title-large>
    </f7-navbar>
    <div v-if="loaded && hosts.length" class="hosts-search-row">
      <f7-searchbar class="hosts-search" :inline="true" :disable-button="false" :clear-button="true" :placeholder="ct('搜尋主機')" :value="query" @input="query = $event.target.value" @searchbar:clear="query = ''" />
    </div>
    <div v-if="editMode" class="hosts-edit-row">
      <f7-button v-if="hiddenCount" small round tonal icon-f7="eye" @click="restoreHidden"><span>{{ fmt('找回刪掉的 {n} 台', { n: hiddenCount }) }}</span></f7-button>
      <f7-button small round tonal icon-f7="folder_badge_plus" :disabled="!!query" @click="addGroup"><span>{{ ct('新增分類') }}</span></f7-button>
    </div>
    <f7-block v-if="!loaded && !error" class="hosts-state"><f7-preloader /></f7-block>
    <f7-block v-else-if="error" class="hosts-error">{{ error }}</f7-block>
    <f7-list inset media-list sortable :sortable-enabled="editMode && !query && !savingLayout" :sortable-move-elements="false" class="hosts-list no-chevron" :class="{ editing: editMode }" @sortable:sort="reorder">
      <template v-for="row in rows" :key="row.kind + ':' + row.id">
        <li v-if="row.kind === 'group'" class="host-group-row" :class="{ 'host-group-block': editMode, 'group-end': editMode && row.empty }" :data-group="row.id">
          <div class="host-group-title">
            <input v-if="editMode && renaming === row.id" v-focus class="host-group-name-input" :value="row.name" maxlength="40" :aria-label="ct('分類名稱')" @keydown.enter.prevent="$event.target.blur()" @keydown.esc.prevent="renaming = ''" @blur="finishRename(row, $event.target.value)" />
            <span v-else-if="editMode" class="host-group-name" role="button" tabindex="0" :title="ct('點一下改名')" @click="renaming = row.id" @keydown.enter="renaming = row.id">{{ row.name }}</span>
            <button v-else type="button" class="host-group-fold" :aria-expanded="String(!row.collapsed)" @click="toggleFold(row.id)">
              <span class="host-group-name">{{ row.name }}</span>
              <span v-if="row.collapsed" class="host-group-count">{{ row.count }}</span>
              <i class="icon f7-icons host-group-chevron" :class="{ collapsed: row.collapsed }" aria-hidden="true">chevron_down</i>
            </button>
            <f7-button v-if="editMode" class="host-group-delete" color="red" icon-f7="minus_circle_fill" :aria-label="ct('刪除分類') + ' ' + row.name" @click.stop="deleteGroup(row)" />
          </div>
          <!-- Its handle drags the whole category, title and machines, as a group of agents is dragged. -->
          <div v-if="editMode && !query" class="sortable-handler host-group-handle" :aria-label="ct('拖曳整個分類')" @touchstart.stop @mousedown.stop @pointerdown.stop="startGroupDrag($event, moveGroups)"></div>
          <!-- Folded, its machines as small tags, as a folded group of agents shows them: a tap opens one. -->
          <div v-if="row.collapsed" class="host-group-tags">
            <button v-for="m in row.members" :key="m.id" type="button" class="host-group-tag" @click="openHost(m, '')"><f7-preloader v-if="busyOf(m)" class="host-group-busy" :size="10" /><span v-else class="tag-dot" :class="{ online: status[m.id] === 'online' || m.kind === 'local' }"></span>{{ m.name }}</button>
          </div>
        </li>
        <li v-else-if="row.kind === 'slot'" class="host-group-slot in-group group-end disallow-sorting" :data-group="row.group"><p>{{ ct('把主機拖到這裡') }}</p></li>
        <f7-list-item v-else :swipeout="!editMode && row.host.kind !== 'local'" :class="{ 'row-current': viewingHost === row.host.id, 'in-group': editMode && !!row.group, 'group-end': editMode && !!row.group && row.last }" :link="editMode ? false : '#'" :data-id="row.host.id" @click="!editMode && !justSwiped($event) && openHost(row.host, '')" @swipeout="swiped" @contextmenu.prevent="!editMode && menuFor(row.host, $event)" @keydown.shift.f10.prevent="!editMode && menuFor(row.host, $event)">
          <template #media>
            <div class="host-avatar"><i class="icon f7-icons">{{ row.host.kind === 'local' ? 'device_laptop' : 'desktopcomputer' }}</i><span class="host-dot" :class="status[row.host.id] || 'unknown'"></span></div>
          </template>
          <template #title>{{ row.host.name }}<span v-if="row.host.tabs && row.host.tabs.length" class="host-tabs-count" :title="fmt('{n} 個終端機開著', { n: row.host.tabs.length })"><f7-preloader v-if="busyOf(row.host)" :size="11" class="host-tabs-busy" /><i v-else class="icon" v-html="TERMINAL_ICON"></i>{{ row.host.tabs.length }}</span></template>
          <template #text>{{ subtitle(row.host) }}</template>
          <!-- Editing: change or delete any machine but this computer, as an agent is deleted on the Agents list. -->
          <template v-if="editMode && row.host.kind !== 'local'" #content-end>
            <span class="host-actions">
              <f7-button class="host-edit-button" icon-f7="pencil_circle_fill" :aria-label="ct('編輯') + ' ' + row.host.name" @click.stop="openForm(row.host)" />
              <f7-button class="host-edit-button" color="red" :icon-f7="row.host.from ? 'arrow_uturn_left_circle_fill' : 'minus_circle_fill'" :aria-label="(row.host.from ? ct('還原') : ct('刪除')) + ' ' + row.host.name" @click.stop="remove(row.host)" />
            </span>
          </template>
          <template v-if="!editMode" #content-end>
            <span class="host-actions" @click.stop>
              <a href="#" class="host-action" :aria-label="row.host.kind === 'local' ? ct('終端機') : 'SSH'" :title="row.host.kind === 'local' ? ct('終端機') : 'SSH'" @click.prevent.stop="openHost(row.host, 'ssh')"><i class="icon" v-html="TERMINAL_ICON"></i></a>
              <a v-if="row.host.kind !== 'local'" href="#" class="host-action" aria-label="SFTP" title="SFTP" @click.prevent.stop="openHost(row.host, 'sftp')"><i class="icon f7-icons">folder</i></a>
            </span>
          </template>
          <f7-swipeout-actions v-if="!editMode && row.host.kind !== 'local'" right>
            <f7-swipeout-button close class="swipe-round edit" :aria-label="ct('編輯') + ' ' + row.host.name" @click="openForm(row.host)"><span class="swipe-circle"><i class="icon f7-icons">pencil</i></span></f7-swipeout-button>
            <f7-swipeout-button close class="swipe-round" :class="row.host.from ? 'edit' : 'delete'" :aria-label="(row.host.from ? ct('還原') : ct('刪除')) + ' ' + row.host.name" @click="remove(row.host)"><span class="swipe-circle"><i class="icon f7-icons">{{ row.host.from ? 'arrow_uturn_left' : 'trash_fill' }}</i></span></f7-swipeout-button>
          </f7-swipeout-actions>
        </f7-list-item>
      </template>
    </f7-list>
    <f7-block v-if="loaded && query && !rows.length" class="hosts-empty">{{ ct('沒有符合的主機') }}</f7-block>

    <f7-popup class="host-form-popup" :opened="formOpen" push @popup:closed="formOpen = false">
      <f7-page>
        <!-- Laid out as the group form is (GroupForm.vue): close at the left, the title, save at the right. -->
        <f7-navbar>
          <f7-nav-left><f7-link icon-only icon-f7="xmark" popup-close :aria-label="ct('關閉')" /></f7-nav-left>
          <f7-nav-title>{{ form.id ? ct('編輯主機') : ct('新增主機') }}</f7-nav-title>
          <f7-nav-right><f7-link :class="{ disabled: saving }" @click="saveForm">{{ form.id ? ct('保存') : ct('新增') }}</f7-link></f7-nav-right>
        </f7-navbar>
        <f7-list inset strong-ios>
          <f7-list-input :label="ct('名稱')" type="text" :placeholder="ct('例如 公司伺服器')" :value="form.name" @input="form.name = $event.target.value" />
          <f7-list-input :label="ct('主機位址')" type="text" placeholder="example.com / 192.168.1.20" :value="form.host" autocapitalize="off" autocorrect="off" @input="form.host = $event.target.value" />
          <f7-list-input :label="ct('使用者')" type="text" placeholder="ubuntu" :value="form.user" autocapitalize="off" autocorrect="off" @input="form.user = $event.target.value" />
          <f7-list-input :label="ct('連接埠')" type="number" placeholder="22" :value="form.port" @input="form.port = $event.target.value" />
          <f7-list-input :label="ct('金鑰檔（可不填）')" type="text" placeholder="~/.ssh/id_ed25519" :value="form.identityFile" autocapitalize="off" autocorrect="off" @input="form.identityFile = $event.target.value" />
        </f7-list>
        <f7-block v-if="form.from" class="host-form-note">{{ fmt('這台來自 ~/.ssh/config（{alias}）。改過的設定存在這頁，~/.ssh/config 不會被改；之後刪掉這頁的設定就回到原本的。', { alias: form.from }) }}</f7-block>
        <f7-block class="host-form-note">{{ ct('CC Agent 不存密碼也不存金鑰：用這台電腦現有的 ssh 金鑰；要密碼的主機，在 SSH 分頁自己輸入。第一次連一台新主機時，終端機會問要不要信任它的指紋。') }}</f7-block>
        <f7-block v-if="formError" class="hosts-error">{{ formError }}</f7-block>
      </f7-page>
    </f7-popup>
    <GlassDropdown :open="!!menu" :point="menuPoint" :items="menuItems" @close="menu = null" @select="choose" />
  </f7-page>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { activeTab } from '../js/tab-session.js';
import { f7 } from 'framework7-vue';
import { api } from '../js/api.js';
import { t } from '../js/i18n.js';
import { ct } from '../js/agent-i18n.js';
import { TERMINAL_ICON } from '../js/terminalIcon.js';
import GlassDropdown from '../components/GlassDropdown.vue';
import { hostMessage } from '../js/hostText.js';
import { listIsColumn } from '../js/listDetail.js';
import { startGroupDrag } from '../js/groupDrag.js';
import { viewingHost, openHost, closeHost } from '../js/hostView.js';

const vFocus = { mounted: (el) => el.focus() };
const fmt = (text, vars) => ct(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const hosts = ref([]), status = ref({}), loaded = ref(false), error = ref(''), query = ref('');
const layout = ref({ order: [], groups: [] });
const editMode = ref(false), savingLayout = ref(false), renaming = ref(''), hiddenCount = ref(0);

// Folded categories, kept on this device as the Agents list's are.
const FOLD_KEY = 'cc-agent.hosts.folded';
const folded = ref((() => { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); } })());
function toggleFold(id) { const s = new Set(folded.value); s.has(id) ? s.delete(id) : s.add(id); folded.value = s; try { localStorage.setItem(FOLD_KEY, JSON.stringify([...s])); } catch {} }

const match = (h) => { const q = query.value.trim().toLowerCase(); return !q || [h.name, h.host, h.user].some((x) => String(x || '').toLowerCase().includes(q)); };
// The rows as shown: machines outside any category first, in the account's order (this computer,
// then the page's own, then ~/.ssh/config's, for those not placed yet), then each category with its
// machines; an empty one shows a place to drop onto while editing.
const rows = computed(() => {
  const byId = new Map(hosts.value.map((h) => [h.id, h]));
  const inGroup = new Set(layout.value.groups.flatMap((g) => g.hosts));
  const rank = new Map(layout.value.order.map((id, i) => [id, i]));
  const free = hosts.value.filter((h) => !inGroup.has(h.id)).map((h, i) => ({ h, i })).sort((a, b) => (rank.get(a.h.id) ?? 1e6 + a.i) - (rank.get(b.h.id) ?? 1e6 + b.i)).map((x) => x.h);
  const out = free.filter(match).map((h) => ({ kind: 'host', id: h.id, host: h, group: null }));
  for (const g of layout.value.groups) {
    const members = g.hosts.map((id) => byId.get(id)).filter(Boolean).filter(match);
    if (query.value && !members.length) continue;
    const collapsed = !editMode.value && !query.value && folded.value.has(g.id);
    out.push({ kind: 'group', id: g.id, name: g.name, empty: !members.length, collapsed, count: members.length, members });
    if (collapsed) continue;
    members.forEach((h, i) => out.push({ kind: 'host', id: h.id, host: h, group: g.id, last: i === members.length - 1 }));
    if (!members.length && editMode.value) out.push({ kind: 'slot', id: 'slot-' + g.id, group: g.id });
  }
  return out;
});
const busyOf = (h) => (h.tabs || []).some((x) => x.busy);
function subtitle(h) {
  if (h.kind === 'local') return h.user + ' · ' + ct('CC Agent 所在的電腦，不用登入');
  const who = (h.user ? h.user + '@' : '') + (h.host || h.name) + (h.port && h.port !== 22 ? ':' + h.port : '');
  return who + (h.identityFile ? ' · ' + ct('指定金鑰') : '');
}

async function load() {
  try { const r = await api('/hosts'); if (r.available === false) { error.value = ct('Windows 不支援終端機頁'); loaded.value = true; return; } hosts.value = r.hosts || []; layout.value = r.layout || { order: [], groups: [] }; hiddenCount.value = r.hidden || 0; error.value = ''; loaded.value = true; }
  catch (e) { error.value = hostMessage(e.message); return; }
  look();
}
// Whether each machine answers: when the tab opens or comes back, at most once a minute (the
// server keeps the answer as long), never on the list's own refresh, which only reads tmux here.
let lookedAt = 0;
async function look() {
  if (Date.now() - lookedAt < 60000) return;
  lookedAt = Date.now();
  try { const r = await api('/hosts/status'); status.value = r.status || {}; } catch {}
}
async function refresh() {
  try { const r = await api('/hosts'); hosts.value = r.hosts || []; layout.value = r.layout || { order: [], groups: [] }; hiddenCount.value = r.hidden || 0; } catch {}
}
// Kept current while the tab is in front, as the Groups list is: what runs in a machine's
// terminals, and whether it can be reached, every so often.
let timer = 0;
watch(activeTab, (tab) => { if (tab === 'view-terminal') load(); });
onMounted(() => { timer = setInterval(() => { if (activeTab.value === 'view-terminal' && !document.hidden && !editMode.value) refresh(); }, 8000); });
onBeforeUnmount(() => clearInterval(timer));
// Framework7 hides the page under the current one from assistive technology; as the column it is in use.
function onPosition() { nextTick(() => { const el = document.querySelector('#view-terminal > .page[data-name="terminal-hosts"]'); if (listIsColumn(el, 'terminal-host')) el.removeAttribute('aria-hidden'); }); }

// ---- Edit: the order and the categories
function toggleEdit() { editMode.value = !editMode.value; renaming.value = ''; try { f7.swipeout.close('.hosts-list .swipeout-opened'); } catch {} }
async function saveLayout(next) {
  const before = layout.value; layout.value = next; savingLayout.value = true;
  try { layout.value = await api('/hosts-layout', { method: 'PUT', body: JSON.stringify(next) }); }
  catch (e) { layout.value = before; f7.dialog.alert(hostMessage(e.message)); }
  finally { savingLayout.value = false; }
}
// A machine dropped somewhere: the rows in their new places, read from the top: before the first
// category title it is outside any category, after one it is in that one.
function reorder({ from, to }) {
  const list = [...rows.value];
  const [moved] = list.splice(from, 1); list.splice(to, 0, moved);
  const order = [], groups = layout.value.groups.map((g) => ({ ...g, hosts: [] }));
  let current = null;
  for (const r of list) {
    if (r.kind === 'group') current = groups.find((g) => g.id === r.id);
    else if (r.kind === 'host') (current ? current.hosts : order).push(r.id);
  }
  saveLayout({ order, groups });
}
async function restoreHidden() {
  try { await api('/hosts-layout/hidden', { method: 'DELETE' }); } catch (e) { return f7.dialog.alert(hostMessage(e.message)); }
  load();
}
// Categories dropped in a new order (groupDrag.js gives their ids in order).
function moveGroups(ids) {
  const byId = new Map(layout.value.groups.map((g) => [g.id, g]));
  saveLayout({ ...layout.value, groups: ids.map((id) => byId.get(id)).filter(Boolean) });
}
function addGroup() {
  f7.dialog.prompt(ct('分類名稱'), ct('新增分類'), (name) => {
    name = String(name || '').trim(); if (!name) return;
    saveLayout({ order: layout.value.order.length ? layout.value.order : rows.value.filter((r) => r.kind === 'host' && !r.group).map((r) => r.id), groups: [...layout.value.groups, { name, hosts: [] }] });
  });
}
function finishRename(row, value) {
  renaming.value = ''; const name = String(value || '').trim();
  if (!name || name === row.name) return;
  saveLayout({ ...layout.value, groups: layout.value.groups.map((g) => (g.id === row.id ? { ...g, name } : g)) });
}
function deleteGroup(row) {
  const g = layout.value.groups.find((x) => x.id === row.id); if (!g) return;
  const go = () => saveLayout({ order: [...layout.value.order, ...g.hosts], groups: layout.value.groups.filter((x) => x.id !== row.id) });
  if (!g.hosts.length) return go();
  f7.dialog.confirm(fmt('刪除分類「{name}」？裡面的主機會移回清單，不會刪掉。', { name: g.name }), ct('刪除分類'), go);
}

// ---- the row's menu: right click on a computer; on a phone the row swipes to its round buttons,
// as an agent's does, with no long-press menu there
const menu = ref(null), menuPoint = ref({ clientX: 0, clientY: 0 });
// A mouse swipe ends in a click on the row it dragged; that click, or a tap on a row whose buttons
// are showing, does not open the machine, as on the Agents list (ChatListPage.vue).
let lastSwipe = 0;
const swiped = () => { lastSwipe = Date.now(); };
const justSwiped = (e) => Date.now() - lastSwipe < 400 || !!e?.currentTarget?.classList?.contains('swipeout-opened');
function menuFor(h, ev) { const r = ev.currentTarget?.getBoundingClientRect?.(); menuPoint.value = { clientX: ev.clientX || (r ? r.left + r.width / 2 : 0), clientY: ev.clientY || (r ? r.top + r.height / 2 : 0) }; menu.value = h; }
const menuItems = computed(() => {
  const h = menu.value; if (!h) return [];
  if (h.kind === 'local') return [{ value: 'ssh', label: ct('開啟終端機'), svg: TERMINAL_ICON, f7: 'chevron_right_square' }];
  return [
    { value: 'ssh', label: ct('SSH 連線'), f7: 'chevron_right_square' },
    { value: 'sftp', label: ct('SFTP 檔案'), f7: 'folder' },
    { value: 'edit', label: ct('編輯'), f7: 'pencil' },
    { value: 'remove', label: h.from ? ct('還原成 ~/.ssh/config 的設定') : ct('刪除'), f7: h.from ? 'arrow_uturn_left' : 'trash', danger: !h.from },
  ];
});
function choose(value) {
  const h = menu.value; menu.value = null; if (!h) return;
  if (value === 'ssh' || value === 'sftp') return openHost(h, value);
  if (value === 'edit') return openForm(h);
  if (value === 'remove') return remove(h);
}

// ---- adding and editing a machine
const formOpen = ref(false), saving = ref(false), formError = ref('');
const form = reactive({ id: '', from: '', name: '', host: '', user: '', port: '', identityFile: '' });
function openForm(h) {
  Object.assign(form, { id: h?.id || '', from: h?.kind === 'config' ? h.name : h?.from || '', name: h?.name || '', host: h?.host || '', user: h?.user || '', port: h?.port && h.port !== 22 ? String(h.port) : '', identityFile: h?.identityFile || '' });
  formError.value = ''; formOpen.value = true;
}
async function saveForm() {
  if (saving.value) return;
  saving.value = true; formError.value = '';
  const body = JSON.stringify({ name: form.name, host: form.host, user: form.user, port: form.port || 22, identityFile: form.identityFile });
  try {
    const h = form.id ? await api(`/hosts/${encodeURIComponent(form.id)}`, { method: 'PUT', body }) : await api('/hosts', { method: 'POST', body });
    formOpen.value = false;
    await load();
    if (form.id && form.id.startsWith('c-') && viewingHost.value === form.id) openHost(h, '');
  } catch (e) { formError.value = hostMessage(e.message); }
  finally { saving.value = false; }
}
function remove(h) {
  const what = h.kind === 'config' ? fmt('從清單刪掉「{name}」？~/.ssh/config 不會被改，之後可以在 Edit 找回。開著的終端機也會關掉。', { name: h.name }) : null;
  f7.dialog.confirm(what || (h.from ? fmt('「{name}」回到 ~/.ssh/config 的設定？開著的終端機也會關掉。', { name: h.name }) : fmt('刪除「{name}」？開著的終端機也會關掉。', { name: h.name })), h.from ? ct('還原') : ct('刪除主機'), async () => {
    try { await api(`/hosts/${encodeURIComponent(h.id)}`, { method: 'DELETE' }); } catch (e) { return f7.dialog.alert(hostMessage(e.message)); }
    if (viewingHost.value === h.id) closeHost();
    load();
  });
}

</script>

<style scoped>
.hosts-search-row { padding: 0 16px; margin: var(--f7-list-margin-vertical, 32px) 0; }
@media (min-width: 1024px) { .hosts-search-row { max-width: min(828px, calc(100% - 32px)); margin-left: auto; margin-right: auto; padding: 0; } }
.hosts-edit-row { display: flex; justify-content: flex-end; margin: -16px max(var(--f7-list-inset-side-margin, 16px), calc((100% - 828px) / 2)) 8px; }
.hosts-edit-row :deep(.button) { display: inline-flex; gap: 6px; width: auto; padding: 0 12px; }
/* A category's title is a row of the list, so a machine can be dragged past it, as on the Agents
   list (ChatListPage.vue): no card, the look of a block title; editing, a dashed line goes round
   the category and its machines. */
.list.hosts-list > ul > li.host-group-row { background: transparent; border-radius: 0; overflow: visible; margin: 28px 0 8px; padding: 0 16px; }
.list.hosts-list > ul > li.host-group-row:first-child { margin-top: 0; }
.host-group-title { display: flex; align-items: center; min-height: 28px; font-size: var(--f7-block-title-font-size, 16px); font-weight: 600; color: var(--f7-block-title-text-color); }
.host-group-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host-group-fold { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; width: auto; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.host-group-count { font-size: 13px; font-weight: 600; color: var(--dp-color-text-secondary); }
.host-group-chevron { flex: 0 0 auto; margin-left: auto; font-size: 14px; color: var(--dp-color-text-secondary); transition: transform .2s; }
.host-group-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.host-group-tag { display: inline-flex; align-items: center; gap: 5px; width: auto; max-width: 100%; margin: 0; padding: 3px 10px; border: 0; border-radius: 11px; background: color-mix(in srgb, currentColor 12%, transparent); color: var(--dp-color-text-secondary); font: inherit; font-size: 12px; font-weight: 500; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.tag-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: #8e8e93; }
.tag-dot.online { background: #34c759; }
.host-tabs-count { display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--dp-color-text-secondary); vertical-align: 1px; }
.host-tabs-count .icon { font-size: 13px; width: 13px; height: 13px; display: inline-flex; }
.hosts-state { text-align: center; }
.host-group-chevron.collapsed { transform: rotate(-90deg); }
.list.hosts-list > ul > li.host-group-row.host-group-block { margin: 24px 10px 10px; padding: 8px 16px; position: relative; }
.list.hosts-list.editing > ul > li:not(.host-group-row):not(.in-group):not(.host-group-slot) { margin-left: 10px; margin-right: 10px; }
.list.hosts-list > ul > li.in-group { margin-left: 10px; margin-right: 10px; overflow: visible; position: relative; }
.list.hosts-list > ul > li.host-group-block::before,
.list.hosts-list > ul > li.in-group::before { content: ''; position: absolute; z-index: -1; pointer-events: none; left: -10px; right: -10px; top: 0; bottom: -10px; border: 1px dashed color-mix(in srgb, currentColor 30%, transparent); border-top: 0; border-bottom: 0; background: color-mix(in srgb, currentColor 4%, transparent); }
.list.hosts-list > ul > li.host-group-block::before { top: -2px; border-top: 1px dashed color-mix(in srgb, currentColor 30%, transparent); border-radius: 20px 20px 0 0; }
.list.hosts-list > ul > li.group-end::before { border-bottom: 1px dashed color-mix(in srgb, currentColor 30%, transparent); border-bottom-left-radius: 20px; border-bottom-right-radius: 20px; }
.list.hosts-list > ul > li.host-group-block.group-end::before { border-radius: 20px; }
.list.hosts-list > ul > li.sorting::before { display: none; }
.list.hosts-list > ul > li.host-group-slot { display: flex; align-items: center; justify-content: center; min-height: 64px; margin-bottom: 10px; border: 1px dashed color-mix(in srgb, currentColor 18%, transparent); border-radius: 16px; box-sizing: border-box; background: none; color: var(--dp-color-text-secondary); font-size: 14px; }
.host-group-block .host-group-name { cursor: text; }
.host-group-delete { margin-left: auto; margin-right: -8px; }
.list.hosts-list > ul > li.host-group-row.host-group-block { padding-right: 54px; }
.host-group-handle { touch-action: none; cursor: grab; }
.hosts-list :deep(ul.group-sorting > li) { transition: transform .2s ease; }
.hosts-list :deep(ul.group-sorting > li.group-dragging) { transition: none; z-index: 10; position: relative; opacity: .92; cursor: grabbing; }
.host-group-name-input { flex: 1; min-width: 0; font: inherit; color: inherit; background: transparent; border: 0; border-bottom: 1px solid var(--dp-color-accent, #d97757); padding: 2px 0; outline: none; }
.hosts-list :deep(a.item-link) { -webkit-user-drag: none; user-select: none; }
.hosts-list.sortable-enabled { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.hosts-list .disallow-sorting :deep(.sortable-handler) { display: none; }
.hosts-list :deep(li.row-current > .item-link), .hosts-list :deep(li.row-current > .swipeout-content > .item-link) { background: rgba(127, 127, 127, .22); }
.host-avatar { position: relative; width: 45px; height: 45px; border-radius: 38%; display: flex; align-items: center; justify-content: center; background: var(--dp-surface-card); box-shadow: var(--dp-glass-ring) 2px 2px 2px -2px inset, var(--dp-glass-ring) -2px -2px 2px -2px inset; }
.host-avatar .icon { font-size: 24px; }
/* The same light as an agent's on the Agents list (ChatListPage.vue). */
.host-dot { position: absolute; right: -3px; bottom: -3px; width: 14px; height: 14px; border-radius: 50%; background: #8e8e93; box-shadow: 0 0 0 3px var(--dp-color-page); }
.host-dot.online { background: #34c759; }
.host-dot.unknown { display: none; }
/* Each machine its own rounded card, swiped to round buttons, as agents and groups are. */
.list.hosts-list > ul > li.swipeout { border-radius: var(--dp-radius-card); }
.hosts-list :deep(.swipeout-actions-right) { display: flex; align-items: center; gap: 10px; padding: 0 14px 0 6px; background: transparent; }
.hosts-list :deep(.swipeout-actions-right > a.swipe-round) { background: transparent; padding: 0; min-width: 0; width: auto; height: auto; }
.swipe-circle { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 22px; color: #fff; }
.swipe-circle .icon { font-size: 19px; }
.edit .swipe-circle { background: #8e8e93; }
.delete .swipe-circle { background: #ff3b30; }
/* The buttons as round ones of one size, in the middle of the row's height,
   not at the title's line with two icons of different sizes. */
.hosts-list :deep(.item-content) { align-items: center; }
/* Editing, the two buttons stop short of the drag handle at the right edge. */
.hosts-list.editing .host-actions { margin-right: calc(var(--f7-sortable-handler-width, 42px) - 6px); padding-right: 0; gap: 2px; }
.host-edit-button { width: 34px; height: 34px; padding: 0; min-width: 0; }
.host-edit-button :deep(.icon) { font-size: 26px; }
.host-actions { flex: 0 0 auto; align-self: center; display: flex; gap: 8px; align-items: center; padding: 0 14px 0 8px; }
.host-action { width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(127, 127, 127, .22); color: var(--f7-text-color, #fff); }
.host-action .icon { font-size: 19px; width: 19px; height: 19px; line-height: 19px; display: inline-flex; align-items: center; justify-content: center; }
.host-action .icon :deep(svg) { width: 19px; height: 19px; display: block; }
.hosts-list :deep(.item-after) { align-self: center; margin-left: 8px; }
.hosts-list :deep(.item-text) { -webkit-line-clamp: 1; }
.hosts-error { color: var(--f7-color-red, #ff453a); }
.hosts-empty, .host-form-note { color: var(--f7-list-item-subtitle-text-color, #8e8e93); font-size: 13px; }
</style>
