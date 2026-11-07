<template>
  <!-- What the context ring opens (issue #12 point 1), in our own list cards:
       small section titles over inset rounded cards. Context: the main context, unfolding to each running
       subagent's. All models: the plan's 5-hour and weekly limits as the sidebar has them.
       Auto-compact: this agent's own setting, which an admin changes in Agent Profile; nothing
       is saved from here. Numbers from Claude Code's own status line (server/contextUsage.js). -->
  <div class="context-usage">
    <f7-block-title class="cu-title">Context</f7-block-title>
    <div class="list inset cu-card"><ul>
      <li class="cu-row cu-main">
        <button type="button" class="cu-head" :aria-expanded="String(expanded)" :aria-label="ct(expanded ? '收起子代理' : '展開子代理')" @click="expanded = !expanded">
          <span class="cu-name">Context window</span>
          <span v-if="main && main.percent !== null" class="cu-pct">{{ t('usageUsed', { percent: main.percent }) }}</span>
          <i class="icon f7-icons cu-chevron" :class="{ open: expanded }" aria-hidden="true">chevron_down</i>
        </button>
        <template v-if="main">
          <div class="cu-bar" role="progressbar" aria-label="Context window" :aria-valuenow="main.percent ?? 0" aria-valuemin="0" aria-valuemax="100"><i :class="levelOf(main.percent ?? 0)" :style="{ width: (main.percent ?? 0) + '%' }"></i></div>
          <div class="cu-line cu-tokens">{{ tokenAmount(main.used ?? NaN) }} / {{ tokenAmount(main.limit ?? NaN) }} tokens</div>
          <div class="cu-line cu-model">{{ [modelText(main.model || agent?.sessionModel || agent?.model), effortLabel(main.effort || agent?.sessionEffort || '')].filter(Boolean).join(' · ') }}</div>
          <div class="cu-note cu-limit">{{ contextLimitLine(main.limit, main.limitSource) }}<template v-if="main.limitSource === 'autoCompact' && main.window"> · {{ contextLimitLine(main.window, 'model') }}</template></div>
          <div v-if="main.stale" class="cu-note cu-stale">{{ ct('Agent 不在線，這是它上次回報的數字。') }}</div>
        </template>
        <p v-else-if="usage?.ownStatusLine" class="cu-note cu-own">{{ ct('這個 agent 用了自己的狀態列，用量無法顯示') }}</p>
        <p v-else class="cu-note cu-empty">{{ ct('還沒有數字：agent 啟動並回覆後，Claude Code 會回報。') }}</p>
        <div v-if="!expanded && subs.length" class="cu-note cu-subs-hint">{{ subagentCount(subs.length) }}</div>
        <div v-if="expanded" class="cu-part cu-subs">
        <div class="cu-subs-title">{{ ct('子代理') }}</div>
        <p v-if="!subs.length" class="cu-note cu-empty">{{ ct('目前沒有執行中的子代理。') }}</p>
        <div v-for="s in subs" :key="s.id" class="cu-sub">
          <div class="cu-sub-head"><span class="cu-sub-name">{{ s.label || s.type || s.id }}</span><span v-if="s.percent !== null" class="cu-pct">{{ t('usageUsed', { percent: s.percent }) }}</span></div>
          <div class="cu-bar" role="progressbar" :aria-label="s.label || s.type || s.id" :aria-valuenow="s.percent ?? 0" aria-valuemin="0" aria-valuemax="100"><i :class="levelOf(s.percent ?? 0)" :style="{ width: (s.percent ?? 0) + '%' }"></i></div>
          <div class="cu-line">{{ tokenAmount(s.used ?? NaN) }} / {{ tokenAmount(s.window ?? NaN) }} tokens</div>
          <div class="cu-note">{{ [s.type, s.model ? modelText(s.model) : '', s.effort ? effortLabel(s.effort) : ''].filter(Boolean).join(' · ') }}</div>
        </div>
        </div>
      </li>
    </ul></div>

    <template v-if="usageGroups.length">
      <f7-block-title class="cu-title">{{ ct('所有模型') }}</f7-block-title>
      <div class="list inset cu-card cu-plan"><ul><li class="cu-row">
        <template v-for="group in usageGroups" :key="group.key">
          <div v-if="group.note" class="cu-part"><div class="cu-note">{{ (usageGroups.length > 1 ? group.name + ' · ' : '') + group.note }}</div></div>
          <div v-for="meter in group.meters" :key="group.key + meter.key" class="cu-part cu-meter" :data-usage="group.key">
            <div class="cu-sub-head"><span class="cu-name">{{ (usageGroups.length > 1 ? group.name + ' · ' : '') + t(meter.label) }}</span><span class="cu-pct">{{ t('usageUsed', { percent: meter.percent }) }}</span></div>
            <div class="cu-bar" role="progressbar" :aria-label="group.name + ' ' + t(meter.label)" :aria-valuenow="meter.percent" aria-valuemin="0" aria-valuemax="100"><i :class="meter.level" :style="{ width: meter.percent + '%' }"></i></div>
            <div v-if="meter.resets" class="cu-note">{{ t('usageResets', { time: meter.resets }) }}</div>
            <div v-if="meter.stale" class="cu-note cu-stale">{{ meter.stale }}</div>
          </div>
        </template>
      </li></ul></div>
    </template>

    <!-- What this agent has used in all its generations, as in its Agent Profile. -->
    <template v-if="totals">
      <f7-block-title class="cu-title">{{ ct('累計') }}</f7-block-title>
      <div class="list inset cu-card cu-totals"><ul><li class="cu-row">
        <div v-for="row in [['累計 token', totals.total], ['輸入 / 輸出', totals.io], ['快取 讀 / 寫', totals.cache], ['回合數', totals.turns], ['估算費用', totals.cost]]" :key="row[0]" class="cu-part cu-total"><span class="cu-name">{{ ct(row[0]) }}</span><span class="cu-pct">{{ row[1] }}</span></div>
      </li></ul></div>
      <f7-block-footer class="cu-footer">{{ ct('依各模型的 token 與 API 參考價格估算，不是實際帳單；未知價格不計入金額。') }} {{ ct('含這個 Agent 的所有世代。') }}</f7-block-footer>
    </template>
    <template v-if="agent?.autoCompactApply">
      <f7-block-title class="cu-title">{{ ct('自動壓縮') }}</f7-block-title>
      <f7-list inset class="cu-card cu-auto-compact">
        <f7-list-item :link="admin ? '#' : undefined" :no-chevron="!admin" :title="ct('自動壓縮時機')" :after="autoCompactText" :footer="ct('只套用到這個 agent')" @click="admin && openChoice($event)"/>
      </f7-list>
    </template>
  </div>
</template>

<script setup>
import { computed, inject, ref, onMounted, onUnmounted } from 'vue';
import { levelOf } from './UsageRing.vue';
import { usageGroups, watchUsage } from '../js/usage.js';
import { t, lang } from '../js/i18n.js';
import { ct, tokenAmount, contextLimitLine, autoCompactLabel, autoCompactFollow } from '../js/agent-i18n.js';
import { modelLabel, effortLabel } from '../js/agent-models.js';
import { usageRows } from '../js/agentOperation.js';

const props = defineProps({ usage: { type: Object, default: null }, agent: { type: Object, default: null } });
const workspace = inject('workspace', null);
const main = computed(() => props.usage?.main || null);
const totals = computed(() => props.agent?.usage ? usageRows(props.agent.usage) : null);
const subs = computed(() => props.usage?.subagents || []);
const admin = computed(() => workspace?.user?.value?.role === 'admin');
// Folded at first; the subagents are what unfolds.
const expanded = ref(false);
// Claude Code names the long-context variant with [1m] after the id.
const modelText = id => id ? modelLabel(String(id).replace(/\[[^\]]*\]$/, '')) + (/\[1m\]$/i.test(String(id)) ? ' (1M)' : '') : '';
const subagentCount = n => lang.value === 'zh-TW' ? `${n} 個子代理執行中` : `${n} subagent${n === 1 ? '' : 's'} running`;
// As Agent Profile's row says it: its own, or following the admin page, and whether a restart is still owed.
const autoCompactText = computed(() => {
  const a = props.agent || {};
  return (a.autoCompactOwn ? autoCompactLabel(a.autoCompact) : autoCompactFollow(a.autoCompactDefault)) + (a.autoCompactPending ? ct('（重新啟動後套用）') : '');
});
function openChoice(event) { event?.preventDefault?.(); workspace?.openAutoCompactChoice?.(); }
// The plan's limits are fetched while this is open, as the sidebar fetches them.
let stop = null;
onMounted(() => { stop = watchUsage(); });
onUnmounted(() => stop?.());
</script>

<style scoped>
.context-usage {padding:4px 0 24px;--usage-track:rgba(120,120,128,.24);}
.cu-title {margin-top:20px;}
.context-usage > .cu-title:first-child {margin-top:12px;}
.cu-card {margin-top:8px;margin-bottom:0;}
.cu-footer {margin-top:8px !important;}
.cu-total {display:flex;justify-content:space-between;gap:12px;align-items:baseline;}
.cu-total .cu-pct {font-variant-numeric:tabular-nums;text-align:right;}
.cu-total .cu-name {font-weight:400;}
.cu-row {padding:12px 16px;list-style:none;}
.cu-part + .cu-part, .cu-row > .cu-part.cu-subs {border-top:1px solid var(--usage-track);margin-top:12px;padding-top:12px;}
.cu-head {all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;cursor:pointer;margin-bottom:8px;}
.cu-head:focus-visible {outline:2px solid var(--cc-color-accent);outline-offset:4px;border-radius:6px;}
.cu-name {flex:1;min-width:0;font-size:16px;font-weight:600;color:var(--cc-color-text);}
.cu-pct {font-size:13px;color:var(--cc-color-text-secondary);white-space:nowrap;}
.cu-chevron {font-size:14px;color:var(--cc-color-text-tertiary, var(--cc-color-text-secondary));transition:transform .2s ease;}
.cu-chevron.open {transform:rotate(180deg);}
/* The sidebar meters' bar (UsageMeters.vue), with a track that shows on a light page too. */
.cu-bar {position:relative;height:6px;border-radius:3px;background:var(--usage-track);overflow:hidden;margin:6px 0;}
.cu-bar i {display:block;height:100%;border-radius:3px;transition:width .4s ease;}
.cu-bar i.low {background:#34c759;}
.cu-bar i.mid {background:#ff9f0a;}
.cu-bar i.high {background:#ff453a;}
.cu-line {font-size:14px;color:var(--cc-color-text);margin-top:4px;}
.cu-note {margin:4px 0 0;font-size:12px;color:var(--cc-color-text-secondary);}
.cu-stale {color:#ff9f0a;}
.cu-subs {display:flex;flex-direction:column;gap:14px;}
.cu-subs-title {font-size:13px;font-weight:600;color:var(--cc-color-text-secondary);}
.cu-sub-head {display:flex;align-items:center;gap:8px;}
.cu-sub-name {flex:1;min-width:0;font-size:14px;color:var(--cc-color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cu-plan .cu-name {font-size:14px;font-weight:500;}
</style>
<style>
/* The refresh button in the usage view's header (ConversationPage.vue, AgentOverlays.vue). */
.usage-refresh.spinning .icon {animation:usage-refresh-spin .8s linear infinite;}
@keyframes usage-refresh-spin {to {transform:rotate(360deg);}}
</style>
