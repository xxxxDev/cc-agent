<template>
  <!-- SFTP: this computer on the left, the machine on the
       right, side by side; a file goes across by dragging it, or from its menu (right click,
       or a long press on a touch screen). On a phone one side at a time, switched above. -->
  <div class="sftp" :class="{ narrow }">
    <div v-if="narrow && !solo" class="sftp-switch segmented segmented-strong">
      <a class="button" :class="{ 'button-active': side === 'local' }" href="#" @click.prevent="side = 'local'">{{ ct('本機') }}</a>
      <a class="button" :class="{ 'button-active': side === 'remote' }" href="#" @click.prevent="side = 'remote'">{{ host.name }}</a>
      <span class="segmented-highlight"></span>
    </div>
    <div class="sftp-panes">
      <section v-for="p in shownPanes" :key="p.key" class="sftp-pane" :class="{ 'drop-target': dropOn === p.key }"
        @dragover.prevent="dragOver(p.key, $event)" @dragleave="dragLeave(p.key, $event)" @drop.prevent="dropped(p.key, null, $event)">
        <header class="sftp-head">
          <span class="sftp-title"><i class="icon f7-icons">{{ p.key === 'local' ? 'device_laptop' : 'desktopcomputer' }}</i>{{ p.key === 'local' ? fmt('本機（{name}）', { name: localName }) : host.name }}</span>
          <span class="sftp-tools">
            <!-- From the device in the admin's hand: its own files, sent in parts as a chat's are. -->
            <a href="#" class="link" :aria-label="ct('從這台裝置上傳')" :title="ct('從這台裝置上傳')" @click.prevent="pick(p.key)"><i class="icon f7-icons">arrow_up_doc</i></a>
            <a href="#" class="link" :aria-label="ct('新增資料夾')" :title="ct('新增資料夾')" @click.prevent="mkdir(p.key)"><i class="icon f7-icons">folder_badge_plus</i></a>
            <a href="#" class="link" :aria-label="ct('重新整理')" :title="ct('重新整理')" @click.prevent="load(p.key)"><i class="icon f7-icons">arrow_clockwise</i></a>
          </span>
        </header>
        <div class="sftp-crumbs">
          <!-- Back and forward through the folders this pane has shown, and up to the folder above,
               as a file browser has them -->
          <a href="#" class="link sftp-step" :class="{ disabled: !trail[p.key].back.length }" :aria-label="ct('上一頁')" :title="ct('上一頁')" @click.prevent="step(p.key, -1)"><i class="icon f7-icons">chevron_left</i></a>
          <a href="#" class="link sftp-step" :class="{ disabled: !trail[p.key].forward.length }" :aria-label="ct('下一頁')" :title="ct('下一頁')" @click.prevent="step(p.key, 1)"><i class="icon f7-icons">chevron_right</i></a>
          <a href="#" class="link sftp-step" :class="{ disabled: !state[p.key].parent }" :aria-label="ct('上一層')" :title="ct('上一層')" @click.prevent="up(p.key)"><i class="icon f7-icons">arrow_up</i></a>
          <span class="sftp-path" :title="state[p.key].path">{{ state[p.key].display || '…' }}</span>
        </div>
        <div v-if="!narrow" class="sftp-row sftp-colhead"><span>{{ ct('名稱') }}</span><span>{{ ct('修改時間') }}</span><span>{{ ct('大小') }}</span></div>
        <div class="sftp-list" @contextmenu.prevent="menuFor(p.key, null, $event)">
          <div v-if="state[p.key].loading && !state[p.key].entries.length" class="sftp-note"><f7-preloader :size="20" /></div>
          <div v-else-if="state[p.key].error" class="sftp-note sftp-error">{{ state[p.key].error }}</div>
          <div v-else-if="!state[p.key].entries.length" class="sftp-note">{{ ct('這個資料夾是空的') }}</div>
          <!-- On a touch screen a row is drawn left to the long press's actions as round buttons, as
               a machine is on the list. -->
          <ul class="sftp-items">
          <li v-for="e in state[p.key].entries" :key="e.name" class="sftp-item"
            :class="{ swipeout: touch, selected: selected[p.key].has(e.name), 'drop-folder': dropFolder === p.key + '/' + e.name }"
            :draggable="!touch" @dragstart="dragStart(p.key, e, $event)" @dragend="dragEnd"
            @dragover.prevent.stop="e.dir && dragOverFolder(p.key, e, $event)" @drop.prevent.stop="dropped(p.key, e.dir ? e : null, $event)"
            @click="clicked(p.key, e, $event)" @dblclick="open(p.key, e)" @contextmenu.prevent.stop="menuFor(p.key, e, $event)"
            @touchstart.passive="pressStart(p.key, e, $event)" @touchend="pressEnd($event)" @touchmove.passive="pressEnd($event)">
            <div class="sftp-row" :class="{ 'swipeout-content': touch, ticks: touch || narrow }">
            <!-- On a touch screen a tick picks several, as Edit on the Agents list does. -->
            <f7-button v-if="touch || narrow" class="sftp-select" :icon-f7="selected[p.key].has(e.name) ? 'checkmark_circle_fill' : 'circle'" role="checkbox" :aria-checked="String(selected[p.key].has(e.name))" :aria-label="ct('選取') + ' ' + e.name" @click.stop="toggle(p.key, e)" />
            <span class="sftp-name"><i class="icon f7-icons" :class="e.dir ? 'is-dir' : 'is-file'">{{ e.dir ? 'folder_fill' : e.link ? 'link' : 'doc' }}</i><span class="sftp-text">{{ e.name }}</span></span>
            <span v-if="!narrow" class="sftp-meta">{{ when(e.modified) }}</span>
            <span v-if="!narrow" class="sftp-meta">{{ e.dir ? '—' : size(e.size) }}</span>
            <span v-else class="sftp-meta">{{ e.dir ? '' : size(e.size) + ' · ' }}{{ when(e.modified) }}</span>
            </div>
            <div v-if="touch" class="swipeout-actions-right sftp-swipe">
              <a v-for="x in rowActions(p.key, e)" :key="x.value" href="#" class="swipe-round" :class="x.danger ? 'delete' : 'edit'" :aria-label="x.label + ' ' + e.name" @click.prevent.stop="swiped(p.key, e, x.value, $event)"><span class="swipe-circle"><i class="icon f7-icons">{{ x.f7 }}</i></span></a>
            </div>
          </li>
          </ul>
        </div>
        <div v-if="dropOn === p.key" class="sftp-drop-tip">{{ dropTip(p.key) }}</div>
      </section>
    </div>
    <input ref="picker" type="file" multiple hidden @change="filesPicked($event)" />
    <div v-if="shownTransfers.length" class="sftp-transfers">
      <div v-for="t in shownTransfers" :key="t.id" class="sftp-transfer" :class="t.state">
        <i class="icon f7-icons">{{ t.direction === 'upload' ? 'arrow_up_circle' : 'arrow_down_circle' }}</i>
        <span class="sftp-transfer-name">{{ (t.fromDevice ? ct('從這台裝置上傳') : t.toDevice ? ct('下載到這台裝置') : t.direction === 'upload' ? ct('上傳') : ct('下載')) + ' ' + (t.name || fmt('{n} 個項目', { n: t.count })) }}</span>
        <span v-if="t.state === 'running'" class="sftp-bar"><span :style="{ width: t.percent + '%' }"></span></span>
        <span class="sftp-transfer-state">{{ t.state === 'running' ? t.percent + '%' : t.state === 'done' ? ct('完成') : t.state === 'cancelled' ? ct('已取消') : (hostMessage(t.error) || ct('失敗')) }}</span>
        <a v-if="t.state === 'running' && !t.device" href="#" class="link" :aria-label="ct('取消')" @click.prevent="cancel(t)"><i class="icon f7-icons">xmark_circle</i></a>
      </div>
    </div>
    <GlassDropdown :open="!!menu" :point="menuPoint" :items="menuItems" @close="menu = null" @select="choose" />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { f7 } from 'framework7-vue';
import { api } from '../js/api.js';
import { ct } from '../js/agent-i18n.js';
import GlassDropdown from './GlassDropdown.vue';
import { hostMessage } from '../js/hostText.js';
import { uploadInParts } from '../js/uploadParts.js';
import { sharesFiles } from '../js/saveFile.js';
import { saveWithProgress } from '../js/saveWithProgress.js';
import { escapeHtml } from '../js/safeDialog.js';

// A translated text with its {names} filled in.
const fmt = (text, vars) => ct(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

const props = defineProps({ host: { type: Object, required: true }, narrow: Boolean, localName: { type: String, default: '' } });
const touch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
const side = ref('remote');
const blank = () => ({ path: '', display: '', parent: null, entries: [], loading: false, error: '' });
const state = reactive({ local: blank(), remote: blank() });
const selected = reactive({ local: new Set(), remote: new Set() });
const panes = [{ key: 'local' }, { key: 'remote' }];
// This computer itself: its own files alone, one pane, nothing to send across.
const solo = computed(() => props.host.kind === 'local');
const shownPanes = computed(() => (solo.value ? panes.slice(0, 1) : props.narrow ? panes.filter((p) => p.key === side.value) : panes));
const idOf = (key) => (key === 'local' ? 'local' : props.host.id);
const otherOf = (key) => (key === 'local' ? 'remote' : 'local');

// The folders each pane has been in: back pops the last, forward undoes a back; a new folder
// opened clears what lay ahead, as a browser does. A refresh is no move.
const freshTrail = () => ({ back: [], forward: [] });
const trail = reactive({ local: freshTrail(), remote: freshTrail() });
const turns = { local: 0, remote: 0 };
async function load(key, at, move = 'go') {
  const s = state[key];
  s.loading = true; s.error = '';
  const from = s.path, turn = ++turns[key];
  try {
    const r = await api(`/hosts/${encodeURIComponent(idOf(key))}/files?path=${encodeURIComponent(at ?? s.path ?? '')}`);
    // Two taps in quick succession: only the last answer is shown and counted.
    if (turn !== turns[key]) return;
    if (from && r.path !== from) {
      const t = trail[key];
      if (move === 'back') { t.back.pop(); t.forward.push(from); }
      else if (move === 'forward') { t.forward.pop(); t.back.push(from); }
      else { if (t.back[t.back.length - 1] !== from) t.back.push(from); t.forward = []; }
    }
    Object.assign(s, { path: r.path, display: r.display, parent: r.parent, entries: sortEntries(r.entries || []) });
    selected[key] = new Set();
  } catch (e) { if (turn === turns[key]) s.error = hostMessage(e.message) || ct('讀取失敗'); }
  finally { if (turn === turns[key]) s.loading = false; }
}
const sortEntries = (list) => list.slice().sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
const join = (key, dir, name) => (key === 'local' || dir.endsWith('/') ? (dir.endsWith('/') ? dir + name : dir + '/' + name) : dir + '/' + name);
function up(key) { if (state[key].parent) load(key, state[key].parent); }
function step(key, by) { const t = trail[key], list = by < 0 ? t.back : t.forward; if (list.length && !state[key].loading) load(key, list[list.length - 1], by < 0 ? 'back' : 'forward'); }
function open(key, e) { if (e.dir) load(key, join(key, state[key].path, e.name)); }
const anchor = { local: '', remote: '' };
function toggle(key, e) { const set = new Set(selected[key]); set.has(e.name) ? set.delete(e.name) : set.add(e.name); selected[key] = set; anchor[key] = e.name; }
function clicked(key, e, ev) {
  // A row drawn open: a tap on it closes it, as on the machine list.
  const li = ev.currentTarget?.closest?.('.swipeout');
  if (li?.classList.contains('swipeout-opened')) { try { f7.swipeout.close(li); } catch {} return; }
  if (touch || props.narrow) { if (selected[key].size > 1) return toggle(key, e); if (e.dir) return open(key, e); selected[key] = new Set([e.name]); return; }
  // Shift picks the run from the last one clicked, as a file manager does.
  if (ev.shiftKey && anchor[key]) {
    const names = state[key].entries.map((x) => x.name), a = names.indexOf(anchor[key]), b = names.indexOf(e.name);
    if (a >= 0 && b >= 0) { selected[key] = new Set(names.slice(Math.min(a, b), Math.max(a, b) + 1)); return; }
  }
  const set = new Set(ev.metaKey || ev.ctrlKey ? selected[key] : []);
  if (set.has(e.name) && (ev.metaKey || ev.ctrlKey)) set.delete(e.name); else set.add(e.name);
  selected[key] = set; anchor[key] = e.name;
}
const picked = (key, e) => (e && selected[key].has(e.name) ? [...selected[key]] : e ? [e.name] : []);

// ---- dragging a file across
const drag = ref(null), dropOn = ref(''), dropFolder = ref('');
function dragStart(key, e, ev) {
  if (!selected[key].has(e.name)) selected[key] = new Set([e.name]);
  drag.value = { from: key, names: [...selected[key]] };
  ev.dataTransfer.effectAllowed = 'copy';
  try { ev.dataTransfer.setData('text/plain', drag.value.names.join('\n')); } catch {}
}
function dragEnd() { drag.value = null; dropOn.value = ''; dropFolder.value = ''; }
// Files dragged in from the computer's own desktop or Finder go up from the device too.
const outside = (ev) => !drag.value && [...(ev.dataTransfer?.types || [])].includes('Files');
function dragOver(key, ev) { if ((drag.value && drag.value.from !== key) || outside(ev)) { dropOn.value = key; ev.dataTransfer.dropEffect = 'copy'; } }
function dragLeave(key, ev) { if (!ev.currentTarget.contains(ev.relatedTarget)) { if (dropOn.value === key) dropOn.value = ''; dropFolder.value = ''; } }
function dragOverFolder(key, e, ev) { if ((drag.value && drag.value.from !== key) || outside(ev)) { dropOn.value = key; dropFolder.value = key + '/' + e.name; ev.dataTransfer.dropEffect = 'copy'; } }
function dropTip(key) {
  const folder = dropFolder.value ? dropFolder.value.slice(key.length + 1) : '';
  const where = folder ? join(key, state[key].display, folder) : state[key].display;
  return (key === 'remote' ? fmt('放開就上傳到 {name}：', { name: props.host.name }) : ct('放開就下載到本機：')) + where;
}
function dropped(key, folder, ev) {
  const files = !drag.value ? [...(ev?.dataTransfer?.files || [])] : [];
  if (files.length) { dragEnd(); return fromDevice(key, files, folder ? join(key, state[key].path, folder.name) : state[key].path); }
  const d = drag.value; dragEnd();
  if (!d || d.from === key) return;
  send(d.from, d.names, folder ? join(key, state[key].path, folder.name) : state[key].path);
}

// ---- transfers
const transfers = ref([]);
let poll = 0;
async function send(from, names, toDir) {
  if (!names.length) return;
  const direction = from === 'local' ? 'upload' : 'download';
  const items = names.map((n) => join(from, state[from].path, n));
  const go = async (overwrite) => {
    try { await api(`/hosts/${encodeURIComponent(props.host.id)}/transfers`, { method: 'POST', body: JSON.stringify({ direction, items, toDir: toDir || state[otherOf(from)].path, overwrite }) }); }
    catch (e) {
      // The same name over there: replaced only when asked.
      if (e.status === 409 && !overwrite) return f7.dialog.confirm(fmt('{message}。要蓋過去嗎？', { message: hostMessage(e.message) }), ct('覆蓋檔案'), () => go(true));
      return f7.dialog.alert(hostMessage(e.message));
    }
    refreshTransfers();
  };
  go(false);
}
let watching = new Set();
async function refreshTransfers() {
  clearTimeout(poll);
  try {
    const r = await api('/host-transfers');
    const mine = (r.transfers || []).filter((t) => t.hostId === props.host.id);
    for (const t of mine) if (watching.has(t.id) && t.state === 'done') { watching.delete(t.id); load(t.direction === 'upload' ? 'remote' : 'local'); }
    for (const t of mine) if (t.state === 'running') watching.add(t.id);
    transfers.value = mine;
    for (const t of mine) if (t.toDevice && t.ready && taking.has(t.id)) { taking.delete(t.id); toDevice('/api/host-transfers/' + encodeURIComponent(t.id) + '/file', t.name); }
    if (mine.some((t) => t.state === 'running')) poll = setTimeout(refreshTransfers, 800);
  } catch {}
}
// ---- the device in the admin's hand
// Each file goes up in parts (uploadParts.js, as a chat's attachment does), then to the folder.
const deviceJobs = ref([]);
const shownTransfers = computed(() => [...deviceJobs.value, ...transfers.value].slice(0, 4));
const picker = ref(null); let pickFor = 'remote';
function pick(key) { pickFor = key; if (picker.value) { picker.value.value = ''; picker.value.click(); } }
function filesPicked(ev) { const files = [...(ev.target.files || [])]; if (files.length) fromDevice(pickFor, files, state[pickFor].path); }
async function fromDevice(key, files, toDir) {
  for (const file of files) {
    const job = reactive({ id: 'device-' + Math.random().toString(36).slice(2), device: true, fromDevice: true, direction: 'upload', name: file.name, percent: 0, state: 'running', error: '' });
    deviceJobs.value = [job, ...deviceJobs.value].slice(0, 6);
    try {
      const a = await uploadInParts(null, file, file.name, { base: '/host-uploads', onProgress: (f) => { job.percent = Math.min(99, Math.round(f * 100)); } });
      const give = async (overwrite) => {
        try { return await api(`/hosts/${encodeURIComponent(idOf(key))}/receive`, { method: 'POST', body: JSON.stringify({ attachmentId: a.id, toDir, overwrite }) }); }
        catch (e) {
          if (e.status !== 409 || overwrite) throw e;
          const yes = await new Promise((done) => f7.dialog.confirm(fmt('{message}。要蓋過去嗎？', { message: hostMessage(e.message) }), ct('覆蓋檔案'), () => done(true), () => done(false)));
          if (!yes) throw Object.assign(new Error(ct('已取消')), { quiet: true });
          return give(true);
        }
      };
      const r = await give(false);
      job.percent = 100; job.state = 'done';
      if (r?.local) load('local'); else refreshTransfers();
      setTimeout(() => { deviceJobs.value = deviceJobs.value.filter((x) => x !== job); }, r?.local ? 4000 : 1500);
    } catch (e) { job.state = e.quiet ? 'cancelled' : 'failed'; job.error = e.quiet ? '' : e.message; }
  }
}
// A file to the device: this computer's straight away; a machine's fetched here first (its
// progress in the list), then saved as a chat's file is (saveWithProgress on an iPhone).
const toDevice = (url, name, size) => {
  // The title is markup to the dialog (saveWithProgress.js): the name from a listing is escaped.
  if (sharesFiles()) return saveWithProgress(url, name, { title: escapeHtml(name), size, ct });
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
};
const taking = new Set();
async function download(key, e) {
  if (key === 'local') return toDevice('/api/hosts/local/file?path=' + encodeURIComponent(join(key, state[key].path, e.name)), e.name, e.size);
  try { const t = await api(`/hosts/${encodeURIComponent(props.host.id)}/fetch`, { method: 'POST', body: JSON.stringify({ path: join(key, state[key].path, e.name) }) }); taking.add(t.id); refreshTransfers(); }
  catch (err) { f7.dialog.alert(hostMessage(err.message)); }
}
async function cancel(t) { try { await api(`/host-transfers/${encodeURIComponent(t.id)}`, { method: 'DELETE' }); } catch {} refreshTransfers(); }

// ---- the menu
const menu = ref(null), menuPoint = ref({ clientX: 0, clientY: 0 });
function menuFor(key, e, ev) {
  if (e && !selected[key].has(e.name)) selected[key] = new Set([e.name]);
  const pt = ev.touches?.[0] || ev;
  menuPoint.value = { clientX: pt.clientX ?? 0, clientY: pt.clientY ?? 0 };
  menu.value = { key, entry: e };
}
const menuItems = computed(() => {
  const m = menu.value; if (!m) return [];
  const across = m.key === 'local' ? fmt('傳到 {name}', { name: props.host.name }) : ct('傳到本機');
  return m.entry
    ? [...(solo.value ? [] : [{ value: 'send', label: across, f7: m.key === 'local' ? 'arrow_right' : 'arrow_left' }]), ...(m.entry.dir ? [{ value: 'open', label: ct('打開'), f7: 'folder' }] : [{ value: 'device', label: ct('下載到這台裝置'), f7: 'arrow_down_doc' }]), { value: 'rename', label: ct('重新命名'), f7: 'pencil' }, { value: 'delete', label: ct('刪除'), f7: 'trash', danger: true }, { value: 'refresh', label: ct('重新整理'), f7: 'arrow_clockwise' }, { value: 'mkdir', label: ct('新增資料夾'), f7: 'folder_badge_plus' }, ...(m.entry.link ? [] : [{ value: 'chmod', label: ct('修改權限'), f7: 'lock' }])]
    : [{ value: 'upload', label: ct('從這台裝置上傳'), f7: 'arrow_up_doc' }, { value: 'refresh', label: ct('重新整理'), f7: 'arrow_clockwise' }, { value: 'mkdir', label: ct('新增資料夾'), f7: 'folder_badge_plus' }];
});
async function op(key, body) {
  try { await api(`/hosts/${encodeURIComponent(idOf(key))}/files`, { method: 'POST', body: JSON.stringify(body) }); }
  catch (e) { f7.dialog.alert(hostMessage(e.message)); }
  load(key);
}
// A row's own actions, the long press's for it (menuItems) less those about the whole folder.
const ROW_ONLY = new Set(['refresh', 'mkdir', 'upload']);
function rowActions(key, e) {
  const across = key === 'local' ? fmt('傳到 {name}', { name: props.host.name }) : ct('傳到本機');
  return [{ value: 'send', label: across, f7: key === 'local' ? 'arrow_right' : 'arrow_left' }, e.dir ? { value: 'open', label: ct('打開'), f7: 'folder' } : { value: 'device', label: ct('下載到這台裝置'), f7: 'arrow_down_doc' }, { value: 'rename', label: ct('重新命名'), f7: 'pencil' }, ...(e.link ? [] : [{ value: 'chmod', label: ct('修改權限'), f7: 'lock' }]), { value: 'delete', label: ct('刪除'), f7: 'trash', danger: true }].filter((x) => !ROW_ONLY.has(x.value) && !(solo.value && x.value === 'send'));
}
function swiped(key, e, value, ev) {
  try { f7.swipeout.close(ev.currentTarget.closest('.swipeout')); } catch {}
  selected[key] = new Set([e.name]);
  menu.value = { key, entry: e };
  choose(value);
}
function choose(value) {
  const m = menu.value; menu.value = null; if (!m) return;
  const { key, entry: e } = m;
  const names = picked(key, e);
  const full = (n) => join(key, state[key].path, n);
  if (value === 'send') return send(key, names);
  if (value === 'device') return download(key, e);
  if (value === 'upload') return pick(key);
  if (value === 'open') return open(key, e);
  if (value === 'refresh') return load(key);
  if (value === 'mkdir') return mkdir(key);
  if (value === 'rename') return f7.dialog.prompt(ct('新的名稱'), ct('重新命名'), (name) => { name = String(name || '').trim(); if (name && name !== e.name) op(key, { op: 'rename', path: full(e.name), name }); }, () => {}, e.name);
  if (value === 'chmod') return f7.dialog.prompt(ct('權限（例如 644、755）'), ct('修改權限'), (mode) => { mode = String(mode || '').trim(); if (mode) op(key, { op: 'chmod', path: full(e.name), mode }); }, () => {}, e.mode && /^[0-7]+$/.test(e.mode) ? e.mode.slice(-3) : '');
  if (value === 'delete') {
    const what = names.length === 1 ? names[0] : fmt('{n} 個項目', { n: names.length });
    return f7.dialog.confirm(fmt('刪除 {what}？刪掉就救不回來。', { what }), ct('刪除'), async () => { for (const n of names) await op(key, { op: 'delete', path: full(n) }); });
  }
}
function mkdir(key) {
  f7.dialog.prompt(ct('資料夾名稱'), ct('新增資料夾'), (name) => { name = String(name || '').trim(); if (name) op(key, { op: 'mkdir', path: state[key].path, name }); });
}

// ---- a long press on a touch screen opens the same menu
let pressTimer = 0, pressFired = false;
function pressStart(key, e, ev) { clearTimeout(pressTimer); const t = ev.touches[0]; const point = { clientX: t.clientX, clientY: t.clientY }; pressTimer = setTimeout(() => { pressFired = true; menuFor(key, e, point); }, 550); }
// A long press that opened the menu: the finger lifting is not also a tap on the row or the
// menu's backdrop.
function pressEnd(ev) { clearTimeout(pressTimer); if (ev?.type === 'touchmove') return; if (pressFired && ev?.type === 'touchend') ev.preventDefault(); pressFired = false; }

const size = (n) => { if (!Number.isFinite(n)) return ''; if (n < 1024) return n + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { n /= 1024; i += 1; } while (n >= 1024 && i < u.length - 1); return (n >= 10 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i]; };
const when = (m) => { if (!m) return ''; if (!/^\d{4}-/.test(m)) return m; const d = new Date(m); const pad = (x) => String(x).padStart(2, '0'); return `${d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function start() { state.local = blank(); state.remote = blank(); trail.local = freshTrail(); trail.remote = freshTrail(); load('local', '~'); if (!solo.value) load('remote', ''); refreshTransfers(); }
watch(() => props.host.id, start);
onMounted(start);
onUnmounted(() => { clearTimeout(poll); clearTimeout(pressTimer); });
</script>

<style scoped>
.sftp { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 10px; }
/* Across the page, so both names have room, and the lit side shown as on the SSH／SFTP switch. */
.sftp-switch { margin: 0 4px; flex: 0 0 auto; align-self: stretch; width: auto; }
.sftp-switch .button { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.sftp-panes { flex: 1; min-height: 0; display: flex; gap: 10px; }
.sftp-pane { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--f7-list-bg-color, #1c1c1e); border-radius: 18px; overflow: hidden; outline: 2px dashed transparent; outline-offset: -2px; transition: outline-color .15s, background-color .15s; }
.sftp-pane.drop-target { outline-color: var(--f7-theme-color); background: color-mix(in srgb, var(--f7-theme-color) 10%, var(--f7-list-bg-color, #1c1c1e)); }
.sftp-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 4px; font-size: 16px; font-weight: 600; }
.sftp-title { display: flex; gap: 8px; align-items: center; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sftp-title .icon { font-size: 19px; }
.sftp-tools { display: flex; gap: 14px; }
.sftp-tools .icon { font-size: 19px; }
.sftp-crumbs { display: flex; align-items: center; gap: 6px; padding: 2px 14px 8px; font-size: 13px; color: var(--f7-list-item-subtitle-text-color, #ebebf599); min-width: 0; }
.sftp-step.disabled { opacity: .3; pointer-events: none; }
/* Room enough for a finger, close together as a browser's. */
.sftp-step { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; margin: -4px -2px; }
.sftp-step .icon { font-size: 16px; }
.sftp-step + .sftp-path { margin-left: 6px; }
.sftp-path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sftp-row { display: grid; grid-template-columns: minmax(0, 1fr) 104px 72px; gap: 8px; padding: 8px 14px; font-size: 14px; align-items: center; border-top: 1px solid rgba(255, 255, 255, .06); }
.narrow .sftp-row { grid-template-columns: minmax(0, 1fr) auto; }
.sftp-row.ticks { grid-template-columns: auto minmax(0, 1fr) 104px 72px; }
.narrow .sftp-row.ticks { grid-template-columns: auto minmax(0, 1fr) auto; }
.sftp-colhead { color: var(--f7-list-item-subtitle-text-color, #8e8e93); font-size: 12px; font-weight: 600; border-top: none; padding-top: 4px; padding-bottom: 6px; }
.sftp-list { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; }
.sftp-items { list-style: none; margin: 0; padding: 0; }
/* A swiped row's face is solid, the pane's own see-through card colour laid on the page's, so the
   buttons stay under it until it slides. */
.sftp-item.swipeout { --sftp-card: linear-gradient(var(--f7-list-bg-color, #1c1c1e), var(--f7-list-bg-color, #1c1c1e)); }
.sftp-item.swipeout .swipeout-content { background: var(--sftp-card), var(--dp-color-page, #121212); }
.sftp-item.swipeout.selected { background: transparent; }
.sftp-item.swipeout.selected .swipeout-content { background: linear-gradient(color-mix(in srgb, var(--f7-theme-color) 22%, transparent), color-mix(in srgb, var(--f7-theme-color) 22%, transparent)), var(--sftp-card), var(--dp-color-page, #121212); }
.sftp-swipe { display: flex; align-items: center; gap: 8px; padding: 0 10px 0 4px; background: transparent; }
.sftp-swipe > a.swipe-round { background: transparent; padding: 0; min-width: 0; width: auto; height: auto; }
.sftp-swipe .swipe-circle { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 17px; color: #fff; }
.sftp-swipe .swipe-circle .icon { font-size: 16px; }
.sftp-swipe .edit .swipe-circle { background: #8e8e93; }
.sftp-swipe .delete .swipe-circle { background: #ff3b30; }
.sftp-item { cursor: default; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.sftp-item.selected { background: color-mix(in srgb, var(--f7-theme-color) 22%, transparent); }
.sftp-item.drop-folder { background: color-mix(in srgb, var(--f7-theme-color) 35%, transparent); }
.sftp-name { display: flex; gap: 8px; align-items: center; min-width: 0; }
.sftp-name .icon { font-size: 17px; flex: 0 0 auto; }
.sftp-name .is-dir { color: #5ac8fa; }
.sftp-name .is-file { color: var(--f7-list-item-subtitle-text-color, #8e8e93); }
.sftp-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sftp-meta { color: var(--f7-list-item-subtitle-text-color, #8e8e93); font-size: 12px; white-space: nowrap; }
.sftp-note { padding: 24px 14px; text-align: center; color: var(--f7-list-item-subtitle-text-color, #8e8e93); font-size: 14px; }
.sftp-error { color: var(--f7-color-red, #ff453a); }
.sftp-drop-tip { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); background: var(--f7-theme-color); color: #fff; padding: 8px 16px; border-radius: 14px; font-size: 14px; font-weight: 600; white-space: nowrap; max-width: 90%; overflow: hidden; text-overflow: ellipsis; pointer-events: none; box-shadow: 0 8px 24px rgba(0, 0, 0, .4); }
.sftp-transfers { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; }
.sftp-transfer { display: flex; align-items: center; gap: 10px; background: var(--f7-list-bg-color, #1c1c1e); border-radius: 14px; padding: 9px 14px; font-size: 13px; }
.sftp-transfer .icon { font-size: 18px; }
.sftp-transfer-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
.sftp-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .12); overflow: hidden; }
.sftp-bar > span { display: block; height: 100%; background: var(--f7-theme-color); transition: width .3s; }
.sftp-transfer-state { margin-left: auto; white-space: nowrap; color: var(--f7-list-item-subtitle-text-color, #8e8e93); overflow: hidden; text-overflow: ellipsis; }
.sftp-transfer.failed .sftp-transfer-state { color: var(--f7-color-red, #ff453a); }
.sftp-select { flex: 0 0 auto; width: 28px; min-width: 28px; height: 28px; padding: 0; margin-right: 2px; color: var(--dp-color-text-secondary); }
.sftp-select[aria-checked="true"] { color: #34c759; }
</style>
