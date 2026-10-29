<template>
  <!-- The Claude limits, each bar led by its source's logo; Claude's 5-hour limit shows in the sidebar again above its
       weekly one. Data and timer are shared
       (src/js/usage.js). -->
  <!-- On the Admin page each limit is its own list row, its logo in the icon column,
       sized and placed as the rows below it. -->
  <div v-if="list" class="list inset"><ul>
    <li v-for="row in rows" :key="row.key" class="usage-item" :data-usage="row.group.key">
      <div class="item-content">
        <div class="item-media"><img class="usage-icon" :src="row.group.logo" :alt="row.group.name"/></div>
        <div class="item-inner">
          <div v-if="row.note" class="usage-main usage-note">{{ row.note }}</div>
          <div v-else class="usage-main">
            <div class="usage-label"><span>{{ t(row.meter.label) }}</span><span>{{ t('usageUsed', { percent: row.meter.percent }) }}</span></div>
            <div class="usage-bar" role="progressbar" :aria-label="row.group.name + ' ' + t(row.meter.label)" :aria-valuenow="row.meter.percent" aria-valuemin="0" aria-valuemax="100"><i :class="row.meter.level" :style="{ width: row.meter.percent + '%' }"></i><b v-if="row.meter.share" class="usage-session" :style="{ left: Math.max(0, row.meter.percent - row.meter.share) + '%', width: row.meter.share + '%' }"></b></div>
            <div v-if="row.meter.resets" class="usage-reset">{{ t('usageResets', { time: row.meter.resets }) }}<template v-if="row.meter.share"> · {{ t('usageSession', { share: row.meter.share }) }}</template></div>
            <div v-if="row.meter.stale" class="usage-reset usage-stale">{{ row.meter.stale }}</div>
          </div>
        </div>
      </div>
    </li>
  </ul></div>
  <!-- The folded sidebar: each limit a ring around its logo, the full row beside it
       while the mouse is on it. -->
  <div v-else-if="compact && usageGroups.length" class="usage-rings">
    <template v-for="row in rows" :key="row.key">
      <div class="usage-ring" :data-usage="row.group.key" @mouseenter="showCard($event, row)" @mouseleave="card = null">
        <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" class="ring-track"/><circle v-if="row.meter" cx="20" cy="20" r="17" class="ring-fill" :class="row.meter.level" :stroke-dasharray="(row.meter.percent / 100 * RING) + ' ' + RING"/></svg>
        <img :src="row.group.logo" :alt="row.group.name"/>
      </div>
    </template>
    <!-- In <body>, not in the panel: a fixed box inside the panel's transformed layer is
         placed by the panel and, in WebKit, painted with its stale pixels. -->
    <Teleport to="body"><div v-if="card" class="usage-card" :style="{ top: card.top + 'px', left: card.left + 'px' }">
      <div class="usage-row">
        <img class="usage-logo" :src="card.row.group.logo" :alt="card.row.group.name"/>
        <div v-if="card.row.note" class="usage-main usage-note">{{ card.row.note }}</div>
        <div v-else class="usage-main">
          <div class="usage-label"><span>{{ t(card.row.meter.label) }}</span><span>{{ t('usageUsed', { percent: card.row.meter.percent }) }}</span></div>
          <div class="usage-bar"><i :class="card.row.meter.level" :style="{ width: card.row.meter.percent + '%' }"></i></div>
          <div v-if="card.row.meter.resets" class="usage-reset">{{ t('usageResets', { time: card.row.meter.resets }) }}</div>
          <div v-if="card.row.meter.stale" class="usage-reset usage-stale">{{ card.row.meter.stale }}</div>
        </div>
      </div>
    </div></Teleport>
  </div>
  <div v-else-if="usageGroups.length" class="usage-meters">
    <div v-for="group in usageGroups" :key="group.key" class="usage-group" :data-usage="group.key">
      <div v-if="group.note" class="usage-row"><img class="usage-logo" :src="group.logo" :alt="group.name"/><div class="usage-main usage-note">{{ group.note }}</div></div>
      <div v-for="meter in group.meters" :key="meter.key" class="usage-row">
        <img class="usage-logo" :src="group.logo" :alt="group.name"/>
        <div class="usage-main">
          <div class="usage-label"><span>{{ t(meter.label) }}</span><span>{{ t('usageUsed', { percent: meter.percent }) }}</span></div>
          <div class="usage-bar" role="progressbar" :aria-label="group.name + ' ' + t(meter.label)" :aria-valuenow="meter.percent" aria-valuemin="0" aria-valuemax="100"><i :class="meter.level" :style="{ width: meter.percent + '%' }"></i><b v-if="meter.share" class="usage-session" :style="{ left: Math.max(0, meter.percent - meter.share) + '%', width: meter.share + '%' }"></b></div>
          <div v-if="meter.resets" class="usage-reset">{{ t('usageResets', { time: meter.resets }) }}<template v-if="meter.share"> · {{ t('usageSession', { share: meter.share }) }}</template></div>
          <div v-if="meter.stale" class="usage-reset usage-stale">{{ meter.stale }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { t } from '../js/i18n.js';
import { usageGroups, watchUsage } from '../js/usage.js';

defineProps({ list: Boolean, compact: Boolean });
const RING = 2 * Math.PI * 17;
const card = ref(null);
function showCard(event, row) {
  const box = event.currentTarget.getBoundingClientRect();
  card.value = { row, top: box.top + box.height / 2, left: box.right + 12 };
}
const rows = computed(() => usageGroups.value.flatMap(group => group.note ? [{ key: group.key + ':note', group, note: group.note }] : group.meters.map(meter => ({ key: group.key + ':' + meter.key, group, meter }))));
let stop = null;
onMounted(() => { stop = watchUsage(); });
onUnmounted(() => stop?.());
</script>

<style scoped>
.usage-meters {display:flex;flex-direction:column;gap:14px;padding:0 20px 12px;}
.usage-group {display:flex;flex-direction:column;gap:10px;}
.usage-row {display:flex;align-items:center;gap:10px;}
.usage-logo {flex:0 0 22px;width:22px;height:22px;border-radius:6px;}
.usage-main {flex:1;min-width:0;}
.usage-label {display:flex;justify-content:space-between;font-size:12px;color:var(--cc-color-text-secondary, #8e8e93);margin-bottom:4px;}
.usage-bar {position:relative;height:6px;border-radius:3px;background:var(--usage-track, rgba(255,255,255,.12));overflow:hidden;}
/* The current 5-hour window, the bright end of the week's bar. */
.usage-session {position:absolute;top:0;bottom:0;background:rgba(255,255,255,.5);border-radius:0 3px 3px 0;}
.usage-bar i {display:block;height:100%;border-radius:3px;transition:width .4s ease;}
.usage-bar i.low {background:#34c759;}
.usage-bar i.mid {background:#ff9f0a;}
.usage-bar i.high {background:#ff453a;}
.usage-reset {margin-top:3px;font-size:11px;color:var(--cc-color-text-secondary, #8e8e93);}
.usage-note {font-size:12px;color:var(--cc-color-text-secondary, #8e8e93);}
.usage-item .item-inner {padding-top:10px;padding-bottom:10px;}
.usage-icon {display:block;width:28px;height:28px;border-radius:7px;}
.usage-rings {display:flex;flex-direction:column;align-items:center;gap:12px;padding:0 0 12px;}
.usage-ring {position:relative;width:40px;height:40px;}
.usage-ring svg {position:absolute;inset:0;width:40px;height:40px;transform:rotate(-90deg);}
.usage-ring circle {fill:none;stroke-width:3.5;}
.ring-track {stroke:var(--usage-track, rgba(255,255,255,.12));}
.ring-fill {stroke-linecap:round;transition:stroke-dasharray .4s ease;}
.ring-fill.low {stroke:#34c759;}
.ring-fill.mid {stroke:#ff9f0a;}
.ring-fill.high {stroke:#ff453a;}
.usage-ring img {position:absolute;inset:10px;width:20px;height:20px;border-radius:5px;}
.usage-card {position:fixed;z-index:6100;transform:translateY(-50%);width:240px;padding:12px 14px;border-radius:12px;background:var(--cc-color-panel, #252525);border:1px solid var(--usage-track, rgba(255,255,255,.12));box-shadow:0 10px 28px rgba(0,0,0,.35);pointer-events:none;}
</style>
