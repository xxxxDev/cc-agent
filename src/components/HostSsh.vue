<template>
  <!-- A machine's terminals: the agents' own terminal tabs
       (TerminalTabs.vue) given the machine, so tabs, ＋, ✕ and the side-by-side or stacked split
       are the same; in a card, the text kept off its edge. A file dragged onto
       it from the computer goes to the folder the terminal is in and its path is typed in, not
       sent, as on an agent's terminal (terminalDrop.js). -->
  <div class="host-ssh" @dragenter="dragIn" @dragover.prevent="dragIn" @dragleave="dragOut" @drop.prevent="drop">
    <TerminalTabs ref="tabsRef" :key="host.id" :host="host" class="host-ssh-tabs" />
    <FileDropOverlay :show="dragging" :count="count" :title="ct('放到終端機')" :sub="ct('上傳到終端機所在的資料夾，把路徑打進終端機，不會按 Enter')" />
    <div v-if="sending" class="host-ssh-sending">{{ sending }}</div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { f7 } from 'framework7-vue';
import TerminalTabs from './TerminalTabs.vue';
import FileDropOverlay from './FileDropOverlay.vue';
import { api } from '../js/api.js';
import { ct } from '../js/agent-i18n.js';
import { uploadInParts } from '../js/uploadParts.js';
import { typedPaths } from '../js/terminalDrop.js';
import { hostMessage } from '../js/hostText.js';

const props = defineProps({ host: { type: Object, required: true } });
const tabsRef = ref(null), dragging = ref(false), count = ref(0), sending = ref('');
const files = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
function dragIn(ev) { if (!files(ev)) return; dragging.value = true; count.value = ev.dataTransfer.items?.length || 0; }
function dragOut(ev) { if (!ev.currentTarget.contains(ev.relatedTarget)) dragging.value = false; }
const home = () => '~';
// Where the terminal is: its tab's folder; this computer's home, or the machine's, when not known.
async function folder() {
  const cwd = tabsRef.value?.currentCwd?.() || '';
  const r = await api(`/hosts/${encodeURIComponent(props.host.id)}/files?path=${encodeURIComponent(cwd || home())}`).catch(() => api(`/hosts/${encodeURIComponent(props.host.id)}/files?path=`));
  return r.path;
}
const waitDone = async (id) => {
  for (let i = 0; i < 1800; i += 1) {
    const r = await api('/host-transfers'); const t = (r.transfers || []).find((x) => x.id === id);
    if (!t || t.state !== 'running') return t;
    sending.value = ct('上傳中') + ' ' + t.percent + '%';
    await new Promise((ok) => setTimeout(ok, 800));
  }
  return null;
};
async function drop(ev) {
  dragging.value = false;
  const list = [...(ev.dataTransfer?.files || [])]; if (!list.length) return;
  const paths = [];
  try {
    const dir = await folder();
    for (const file of list) {
      sending.value = ct('上傳中') + ' ' + file.name + ' → ' + dir;
      const a = await uploadInParts(null, file, file.name, { base: '/host-uploads', onProgress: (f) => { sending.value = ct('上傳中') + ' ' + Math.round(f * 100) + '% → ' + dir; } });
      const give = async (overwrite) => {
        try { return await api(`/hosts/${encodeURIComponent(props.host.id)}/receive`, { method: 'POST', body: JSON.stringify({ attachmentId: a.id, toDir: dir, overwrite }) }); }
        catch (e) {
          if (e.status !== 409 || overwrite) throw e;
          const yes = await new Promise((done) => f7.dialog.confirm(ct('{message}。要蓋過去嗎？').replace('{message}', () => hostMessage(e.message)), ct('覆蓋檔案'), () => done(true), () => done(false)));
          return yes ? give(true) : null;
        }
      };
      const r = await give(false); if (!r) continue;
      if (!r.local) { const t = await waitDone(r.id); if (t?.state !== 'done') throw new Error(hostMessage(t?.error) || ct('失敗')); }
      paths.push((dir.endsWith('/') ? dir : dir + '/') + (r.name || file.name));
    }
    const text = typedPaths(paths); if (text) tabsRef.value?.paste?.(text);
  } catch (e) { f7.dialog.alert(hostMessage(e.message)); }
  finally { sending.value = ''; }
}
</script>

<style scoped>
.host-ssh { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
.host-ssh-tabs { flex: 1; min-height: 0; background: transparent; }
/* The card frames the terminal alone, its title line and its text: the tabs above it and a
   phone's key row below stay outside, as on an agent's terminal.
   In a split each half already has its own frame (TerminalTabs.vue). */
.host-ssh-tabs:not(.split) :deep(.terminal-bar) { border: 1px solid rgba(255, 255, 255, .1); border-bottom-color: rgba(255, 255, 255, .06); border-radius: 12px 12px 0 0; }
.host-ssh-tabs:not(.split) :deep(.terminal-host) { border: 1px solid rgba(255, 255, 255, .1); border-top: 0; border-radius: 0 0 12px 12px; overflow: hidden; }
.host-ssh-tabs :deep(.terminal-host) { padding: 6px 12px 12px 14px; background: var(--terminal-bg, #121212); box-sizing: border-box; }
.host-ssh-tabs :deep(.terminal-keys) { background: transparent; }
/* A phone: no frame at all, the terminal across the page as on an agent's terminal page. */
@media (max-width: 767px) {
  .host-ssh-tabs:not(.split) :deep(.terminal-bar), .host-ssh-tabs:not(.split) :deep(.terminal-host) { border: 0; border-radius: 0; }
  .host-ssh-tabs :deep(.terminal-host) { padding: 0; }
  .host-ssh-tabs :deep(.terminal-keys) { background: var(--terminal-bg, #121212); }
}
.host-ssh-sending { position: absolute; right: 14px; bottom: 14px; z-index: 6; padding: 6px 12px; border-radius: 999px; background: rgba(0, 0, 0, .6); color: #fff; font-size: 12px; }
</style>
