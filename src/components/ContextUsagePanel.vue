<template>
  <!-- What the context ring opens (issue #12 point 1): the main context, each running subagent's, and the plan's 5-hour and
       weekly limits as the sidebar shows them. The numbers come from Claude Code's own
       status line (server/contextUsage.js); the bars are the sidebar meters' (UsageMeters.vue). -->
  <div class="context-usage">
    <div class="cu-section">
      <div class="cu-heading">{{ ct('主要 context') }}</div>
      <div v-if="main" class="cu-meter cu-main">
        <div class="cu-label"><span>{{ tokenAmount(main.used ?? NaN) }} / {{ tokenAmount(main.limit ?? NaN) }} tokens</span><span v-if="main.percent !== null">{{ t('usageUsed', { percent: main.percent }) }}</span></div>
        <div class="cu-bar" role="progressbar" :aria-label="ct('主要 context')" :aria-valuenow="main.percent ?? 0" aria-valuemin="0" aria-valuemax="100"><i :class="levelOf(main.percent ?? 0)" :style="{ width: (main.percent ?? 0) + '%' }"></i></div>
        <div class="cu-note cu-limit">{{ contextLimitLine(main.limit, main.limitSource) }}<template v-if="main.limitSource === 'autoCompact' && main.window"> · {{ contextLimitLine(main.window, 'model') }}</template></div>
        <div class="cu-note cu-model">{{ modelText(main.model || agent?.sessionModel || agent?.model) }}<template v-if="main.effort || agent?.sessionEffort"> · Effort {{ effortLabel(main.effort || agent?.sessionEffort) }}</template></div>
        <div v-if="main.stale" class="cu-note cu-stale">{{ ct('Agent 不在線，這是它上次回報的數字。') }}</div>
      </div>
      <p v-else-if="usage?.ownStatusLine" class="cu-note cu-empty cu-own">{{ ct('這個 agent 用了自己的狀態列，用量無法顯示') }}</p>
      <p v-else class="cu-note cu-empty">{{ ct('還沒有數字：agent 啟動並回覆後，Claude Code 會回報。') }}</p>
    </div>
    <div class="cu-section">
      <div class="cu-heading">{{ ct('子代理') }}<span v-if="subs.length" class="cu-count">{{ subs.length }}</span></div>
      <p v-if="!subs.length" class="cu-note cu-empty">{{ ct('目前沒有執行中的子代理。') }}</p>
      <details v-for="s in subs" :key="s.id" class="cu-sub" :open="openIds.has(s.id)" @toggle="remember(s.id, $event)">
        <summary><span class="cu-sub-name">{{ s.label || s.type || s.id }}</span><span v-if="s.percent !== null" class="cu-sub-pct">{{ s.percent }}%</span></summary>
        <div class="cu-meter">
          <div class="cu-label"><span>{{ tokenAmount(s.used ?? NaN) }} / {{ tokenAmount(s.window ?? NaN) }} tokens</span></div>
          <div class="cu-bar" role="progressbar" :aria-label="s.label || s.type || s.id" :aria-valuenow="s.percent ?? 0" aria-valuemin="0" aria-valuemax="100"><i :class="levelOf(s.percent ?? 0)" :style="{ width: (s.percent ?? 0) + '%' }"></i></div>
          <div class="cu-note">{{ [s.type, s.model ? modelText(s.model) : '', s.effort ? 'Effort ' + effortLabel(s.effort) : ''].filter(Boolean).join(' · ') }}</div>
          <div v-if="s.window" class="cu-note">{{ contextLimitLine(s.window, 'model') }}</div>
        </div>
      </details>
    </div>
    <div v-if="usageGroups.length" class="cu-section cu-plan">
      <div class="cu-heading">{{ ct('方案額度') }}</div>
      <UsageMeters/>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import UsageMeters from './UsageMeters.vue';
import { levelOf } from './UsageRing.vue';
import { usageGroups } from '../js/usage.js';
import { t } from '../js/i18n.js';
import { ct, tokenAmount, contextLimitLine } from '../js/agent-i18n.js';
import { modelLabel, effortLabel } from '../js/agent-models.js';

const props = defineProps({ usage: { type: Object, default: null }, agent: { type: Object, default: null } });
const main = computed(() => props.usage?.main || null);
const subs = computed(() => props.usage?.subagents || []);
// Claude Code names the long-context variant with [1m] after the id.
const modelText = id => id ? modelLabel(String(id).replace(/\[[^\]]*\]$/, '')) + (/\[1m\]$/i.test(String(id)) ? ' (1M)' : '') : '';
// Which subagents are unfolded, kept across the page's refreshes.
const openIds = ref(new Set());
function remember(id, event) { const next = new Set(openIds.value); if (event.target.open) next.add(id); else next.delete(id); openIds.value = next; }
</script>

<style scoped>
.context-usage {display:flex;flex-direction:column;gap:18px;padding:12px 0 20px;}
.cu-section {display:flex;flex-direction:column;gap:8px;padding:0 20px;}
.cu-plan {padding:0;}
.cu-plan .cu-heading {padding:0 20px;}
.cu-heading {font-size:13px;font-weight:600;color:var(--cc-color-text-secondary, #8e8e93);text-transform:none;display:flex;align-items:center;gap:6px;}
.cu-count {font-size:11px;font-weight:600;padding:0 6px;border-radius:8px;background:var(--usage-track, rgba(255,255,255,.12));}
/* The sidebar meters' label, bar and note (UsageMeters.vue). */
.cu-label {display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--cc-color-text-secondary, #8e8e93);margin-bottom:4px;}
.cu-bar {position:relative;height:6px;border-radius:3px;background:var(--usage-track, rgba(255,255,255,.12));overflow:hidden;}
.cu-bar i {display:block;height:100%;border-radius:3px;transition:width .4s ease;}
.cu-bar i.low {background:#34c759;}
.cu-bar i.mid {background:#ff9f0a;}
.cu-bar i.high {background:#ff453a;}
.cu-note {margin:3px 0 0;font-size:11px;color:var(--cc-color-text-secondary, #8e8e93);}
.cu-empty {font-size:12px;}
.cu-stale {color:#ff9f0a;}
.cu-sub {border-radius:10px;background:var(--usage-track, rgba(255,255,255,.06));padding:8px 10px;}
.cu-sub summary {display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;font-size:13px;list-style:none;}
.cu-sub summary::-webkit-details-marker {display:none;}
.cu-sub summary::before {content:'›';display:inline-block;width:10px;transition:transform .2s ease;color:var(--cc-color-text-secondary, #8e8e93);}
.cu-sub[open] summary::before {transform:rotate(90deg);}
.cu-sub-name {flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cu-sub-pct {font-size:12px;color:var(--cc-color-text-secondary, #8e8e93);}
.cu-sub .cu-meter {margin-top:8px;}
</style>
