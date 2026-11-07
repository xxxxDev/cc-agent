<template>
  <!-- The usage ring: the folded sidebar's limits (UsageMeters.vue) and the context ring in a
       conversation's navbar (ContextRing.vue) draw the same circle, track and colours. What
       sits in the middle is the slot: a logo there, the percentage here. -->
  <div class="usage-ring">
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" class="ring-track"/><circle v-if="percent !== null && percent !== undefined" cx="20" cy="20" r="17" class="ring-fill" :class="level || levelOf(percent)" :stroke-dasharray="(Math.max(0, Math.min(100, percent)) / 100 * RING) + ' ' + RING"/></svg>
    <slot/>
  </div>
</template>

<script setup>
defineProps({ percent: { type: Number, default: null }, level: { type: String, default: '' } });
const RING = 2 * Math.PI * 17;
</script>
<script>
// The sidebar meters' thresholds (src/js/usage.js).
export const levelOf = percent => percent >= 90 ? 'high' : percent >= 70 ? 'mid' : 'low';
</script>

<style scoped>
.usage-ring {position:relative;width:40px;height:40px;}
.usage-ring svg {position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);}
.usage-ring circle {fill:none;stroke-width:3.5;}
.ring-track {stroke:var(--usage-track, rgba(255,255,255,.12));}
.ring-fill {stroke-linecap:round;transition:stroke-dasharray .4s ease;}
.ring-fill.low {stroke:#34c759;}
.ring-fill.mid {stroke:#ff9f0a;}
.ring-fill.high {stroke:#ff453a;}
</style>
