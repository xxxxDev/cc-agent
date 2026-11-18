<template>
  <!-- One machine of the Terminal tab: what it is and the two
       ways in, then its SSH terminals or its files. Over the list on a phone, beside it as the
       Groups tab's room is on a wide computer window (listDetail.js); the title small in the
       navbar. -->
  <f7-page ref="pageRef" name="terminal-host" class="terminal-host-page" @page:afterin="load">
    <div v-if="listDetailActive" class="list-column-divider" role="separator" aria-orientation="vertical" :aria-label="ct('拖曳調整清單寬度')" :title="ct('拖曳調整清單寬度，按兩下恢復')" @pointerdown.stop="startListColumnResize" @dblclick="setListColumnWidth(null)" @mousedown.stop @touchstart.stop></div>
    <f7-navbar>
      <f7-nav-left><f7-link class="back" icon-only :data-animate="listDetailActive ? 'false' : null" :aria-label="t('back')" @click="closeHost"><i class="icon icon-back" /></f7-link></f7-nav-left>
      <f7-nav-title sliding><span class="nav-agent-name">{{ host ? host.name : '' }}</span></f7-nav-title>
      <f7-nav-right v-if="host && host.kind !== 'local' && mode">
        <div class="host-switch segmented segmented-strong">
          <a class="button" :class="{ 'button-active': mode === 'ssh' }" href="#" aria-label="SSH" @click.prevent="mode = 'ssh'"><i class="icon" v-html="TERMINAL_ICON"></i><span class="host-switch-label">SSH</span></a>
          <a class="button" :class="{ 'button-active': mode === 'sftp' }" href="#" aria-label="SFTP" @click.prevent="mode = 'sftp'"><i class="icon f7-icons">folder</i><span class="host-switch-label">SFTP</span></a>
          <span class="segmented-highlight"></span>
        </div>
      </f7-nav-right>
    </f7-navbar>
    <div class="terminal-host-body">
      <HostPanel v-if="host" :key="host.id" :host="host" :mode="mode" :narrow="!listDetailActive" bare :local-name="localName" :status="status" @mode="mode = $event" />
      <f7-block v-else-if="error" class="host-error">{{ error }}</f7-block>
      <f7-block v-else><f7-preloader /></f7-block>
    </div>
  </f7-page>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { f7 } from 'framework7-vue';
import { api } from '../js/api.js';
import { ct } from '../js/agent-i18n.js';
import { t } from '../js/i18n.js';
import { TERMINAL_ICON } from '../js/terminalIcon.js';
import HostPanel from '../components/HostPanel.vue';
import { hostMessage } from '../js/hostText.js';
import { listDetailActive, startListColumnResize, setListColumnWidth } from '../js/listDetail.js';
import { viewingHost, closeHost } from '../js/hostView.js';
import { bindConversationViewport } from '../js/conversationViewport.js';

const props = defineProps({ f7route: Object, f7router: Object });
const hosts = ref([]), error = ref(''), status = ref(''), pageRef = ref(null);
const pick = (q) => (q === 'sftp' || q === 'ssh' ? q : '');
const id = ref(props.f7route?.query?.id || '');
const mode = ref(pick(props.f7route?.query?.mode));
const host = computed(() => hosts.value.find((h) => h.id === id.value) || null);
const localName = computed(() => hosts.value.find((h) => h.kind === 'local')?.name || '');
async function load() {
  try { const r = await api('/hosts'); hosts.value = r.hosts || []; error.value = host.value ? '' : ct('找不到這台主機'); }
  catch (e) { error.value = hostMessage(e.message); }
  // The title came after the navbar laid itself out: centred again for its real width.
  await nextTick(); try { document.querySelectorAll('.terminal-host-page .navbar').forEach((el) => f7.navbar.size(el)); } catch {}
  if (host.value && host.value.kind !== 'local') { try { const r = await api('/hosts/status'); status.value = r.status?.[id.value] || ''; } catch {} }
}
// The switch coming or going moves the title: the navbar lays itself out again.
const resize = async () => { await nextTick(); try { document.querySelectorAll('.terminal-host-page .navbar').forEach((el) => f7.navbar.size(el)); } catch {} };
watch(mode, resize);
// Another machine chosen in the list's column takes this one's place (hostView.js).
function follow(route) {
  if (route?.path !== '/terminal-host/') return;
  const next = route.query?.id || '';
  if (next !== id.value) { id.value = next; viewingHost.value = next; status.value = ''; load(); }
  mode.value = pick(route.query?.mode);
}
// The soft keyboard handled as on an agent's terminal page: the page marked while it is up (the
// terminal's keyboard button reads that) and the content kept above it (chatPage.css).
let unbindViewport = null;
onMounted(() => { viewingHost.value = id.value; load(); props.f7router?.on('routeUrlUpdate', follow); unbindViewport = bindConversationViewport(pageRef.value?.$el || null); });
onBeforeUnmount(() => { unbindViewport?.(); props.f7router?.off('routeUrlUpdate', follow); if (viewingHost.value === id.value) viewingHost.value = null; });
</script>

<style scoped>
.terminal-host-page :deep(.page-content) { display: flex; flex-direction: column; height: var(--conversation-visible-height, 100%); }
.host-switch { width: auto; flex: 0 0 auto; }
.host-switch .button { flex: 0 0 auto; width: auto; min-width: max-content; overflow: visible; text-overflow: clip; }
.host-switch .button { display: inline-flex; gap: 6px; align-items: center; padding: 0 14px; }
.host-switch .icon { font-size: 16px; width: 16px; height: 16px; display: inline-flex; }
@media (max-width: 599px) { .host-switch-label { display: none; } .host-switch .button { padding: 0 12px; } }
.terminal-host-body { flex: 1; min-height: 0; padding: 8px 10px 10px; display: flex; flex-direction: column; }
.host-error { color: var(--f7-color-red, #ff453a); }
</style>

<style>
/* With no bottom bar under it on a phone (App.vue hides it while a machine is open, as for an
   agent's conversation), the page keeps only the safe area at its foot. */
html:not(.list-detail-on) .page.terminal-host-page > .page-content, .page.terminal-host-page.conversation-keyboard > .page-content { padding-bottom: var(--f7-safe-area-bottom, 0px) !important; }
/* With the keyboard up the safe area is under it: nothing kept at the foot, the terminal reaches the
   keyboard as an agent's does (chatPage.css .conversation-keyboard). */
.page.terminal-host-page.conversation-keyboard { --f7-safe-area-bottom: 0px; }
.page.terminal-host-page.conversation-keyboard > .page-content { padding-bottom: 0 !important; }
.page.terminal-host-page.conversation-keyboard .terminal-host-body { padding-bottom: 0; }
</style>
