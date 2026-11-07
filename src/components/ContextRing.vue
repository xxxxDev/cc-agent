<template>
  <!-- How full the main context is, in the conversation's navbar beside the checklist
       button (issue #12 point 1): the sidebar's
       usage ring at a navbar icon's size, its percentage in the middle. -->
  <f7-link icon-only class="context-ring-open" :class="{'inspector-on': on}" :aria-pressed="String(on)" :aria-label="label" :title="label" @click="$emit('toggle')">
    <UsageRing class="context-ring" :percent="percent" :class="{stale: usage?.main?.stale}"><span class="context-ring-text" aria-hidden="true">{{ percent === null ? '' : percent }}</span></UsageRing>
  </f7-link>
</template>

<script setup>
import { computed } from 'vue';
import UsageRing from './UsageRing.vue';
import { ct } from '../js/agent-i18n.js';

const props = defineProps({ usage: { type: Object, default: null }, on: Boolean });
defineEmits(['toggle']);
const percent = computed(() => props.usage?.main?.percent ?? null);
const label = computed(() => ct('用量') + (percent.value === null ? '' : ' · ' + ct('context 已用') + ' ' + percent.value + '%'));
</script>

<style scoped>
.context-ring {width:32px;height:32px;}
.context-ring.stale {opacity:.55;}
.context-ring-text {position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;letter-spacing:-.2px;color:var(--f7-navbar-link-color, var(--f7-theme-color));}
</style>
