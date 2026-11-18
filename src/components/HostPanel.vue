<template>
  <!-- One machine on the right of the Terminal tab, or the whole page on a phone: its SSH
       terminals or its files, switched at the top (this computer has its terminal only). -->
  <div class="host-panel" :class="{ narrow }">
    <header v-if="!bare" class="host-panel-head">
      <span class="host-panel-title">{{ host.name }}</span>
      <div v-if="host.kind !== 'local'" class="host-panel-switch segmented segmented-strong">
        <a class="button" :class="{ 'button-active': mode === 'ssh' }" href="#" @click.prevent="$emit('mode', 'ssh')"><i class="icon" v-html="TERMINAL_ICON"></i> SSH</a>
        <a class="button" :class="{ 'button-active': mode === 'sftp' }" href="#" @click.prevent="$emit('mode', 'sftp')"><i class="icon f7-icons">folder</i> SFTP</a>
      </div>
    </header>
    <div class="host-panel-body">
      <!-- Shown before anything connects: what the machine is, and the two ways in. -->
      <div v-if="!mode" class="host-overview">
        <div class="host-overview-icon"><i class="icon f7-icons">{{ host.kind === 'local' ? 'device_laptop' : 'desktopcomputer' }}</i><span v-if="status" class="host-overview-dot" :class="status"></span></div>
        <div class="host-overview-name">{{ host.name }}</div>
        <div class="host-overview-sub">{{ address }}</div>
        <div v-if="host.tabs && host.tabs.length" class="host-overview-sub">{{ fmt(ct('{n} 個終端機開著'), { n: host.tabs.length }) }}</div>
        <div class="host-overview-buttons">
          <f7-button fill round large @click="$emit('mode', 'ssh')"><i class="icon" v-html="TERMINAL_ICON"></i>{{ host.kind === 'local' ? ct('開啟終端機') : ct('SSH 連線') }}</f7-button>
          <f7-button v-if="host.kind !== 'local'" tonal round large @click="$emit('mode', 'sftp')"><i class="icon f7-icons">folder</i>{{ ct('SFTP 檔案') }}</f7-button>
        </div>
      </div>
      <HostSftp v-else-if="mode === 'sftp' && host.kind !== 'local'" :host="host" :narrow="narrow" :local-name="localName" />
      <HostSsh v-else :host="host" />
    </div>
  </div>
</template>

<script setup>
import HostSsh from './HostSsh.vue';
import HostSftp from './HostSftp.vue';
import { computed } from 'vue';
import { TERMINAL_ICON } from '../js/terminalIcon.js';
import { ct } from '../js/agent-i18n.js';

const props = defineProps({ host: { type: Object, required: true }, mode: { type: String, default: '' }, narrow: Boolean, bare: Boolean, localName: { type: String, default: '' }, status: { type: String, default: '' } });
const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);
const address = computed(() => props.host.kind === 'local' ? ct('CC Agent 所在的電腦，不用登入') : (props.host.user ? props.host.user + '@' : '') + (props.host.host || props.host.name) + (props.host.port && props.host.port !== 22 ? ':' + props.host.port : ''));
defineEmits(['mode']);
</script>

<style scoped>
.host-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.host-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px 10px; }
.host-panel-title { font-size: 17px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.host-panel-switch { flex: 0 0 auto; width: auto; }
.host-panel-switch .button { display: inline-flex; gap: 6px; align-items: center; padding: 0 16px; }
.host-panel-switch .icon { font-size: 16px; }
.host-panel-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.host-overview { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 24px 16px; text-align: center; }
.host-overview-icon { position: relative; width: 72px; height: 72px; border-radius: 22px; background: rgba(127, 127, 127, .18); display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
.host-overview-icon .icon { font-size: 36px; }
.host-overview-dot { position: absolute; right: -3px; bottom: -3px; width: 16px; height: 16px; border-radius: 50%; border: 3px solid var(--f7-page-bg-color, #000); background: #8e8e93; }
.host-overview-dot.online { background: #30d158; }
.host-overview-name { font-size: 20px; font-weight: 700; }
.host-overview-sub { color: var(--f7-list-item-subtitle-text-color, #8e8e93); font-size: 14px; }
.host-overview-buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 18px; }
.host-overview-buttons .button { gap: 8px; padding: 0 22px; }
.host-overview-buttons .icon { font-size: 20px; width: 20px; height: 20px; display: inline-flex; }
</style>
