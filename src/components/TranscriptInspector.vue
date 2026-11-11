<template>
 <aside class="transcript-inspector" :aria-label="ct('Transcript 檢視')">
  <!-- The same header as Agent Profile's column:
       close at the left, the title in the middle, and on the right going back from
       one turn to the overview; it stays put and only the body scrolls. -->
  <header class="ti-head">
   <f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉 Transcript 檢視')" @click="$emit('close')"/>
   <div class="ti-title">{{data||busy||error?ct('這一輪'):ct('Transcript 檢視')}}</div>
   <f7-link v-if="data||busy||error" icon-only icon-f7="arrow_uturn_left" :aria-label="ct('回到總覽')" @click="$emit('back')"/>
   <span v-else class="ti-spacer"/>
  </header>
  <div class="ti-body">

  <div v-if="busy" class="ti-state"><f7-preloader/></div>
  <div v-else-if="error" class="ti-state ti-error" role="alert">{{error}}</div>

  <!-- Nothing chosen: the subagents it started. Its name, purpose, model, memory and
       usage are in Agent Profile, so this column leaves them out. -->
  <template v-else-if="!data">
   <!-- The subagents this agent started: what each
        was, what it was asked, what it cost and what it reported back. -->
   <template v-if="subagents.length">
    <!-- One card each, like the cards of the other pages:
         the kind as a tag, what it cost at the right, the task, then when and how long. -->
    <div class="ti-section ti-sub-title"><span>{{ct('子代理')}}（{{subagents.length}}）</span><span v-if="subTotal" class="ti-sub-total">{{ct('合計')}} {{subTotal}}</span></div>
    <div v-for="a in subagents" :key="a.generation+':'+a.id" class="ti-sub" :class="{open:openSub===a.id}">
     <button type="button" class="ti-sub-head" :aria-expanded="String(openSub===a.id)" @click="openSub=openSub===a.id?null:a.id">
      <span class="ti-sub-top"><span class="ti-sub-type">{{a.type||ct('子代理')}}</span><span class="ti-sub-cost">{{subCost(a)}}</span><i class="icon f7-icons ti-sub-arrow">{{openSub===a.id?'chevron_up':'chevron_down'}}</i></span>
      <span v-if="a.task" class="ti-sub-name">{{a.task}}</span>
      <span class="ti-sub-meta">{{subLine(a)}}</span>
     </button>
     <template v-if="openSub===a.id">
      <div class="ti-block-name">{{ct('交辦內容')}}</div>
      <pre>{{a.prompt||''}}</pre>
      <div class="ti-block-name">{{ct('回報')}}</div>
      <pre>{{a.result||ct('還沒有回報')}}</pre>
     </template>
    </div>
   </template>
   <p v-if="!subagents.length" class="ti-note ti-empty">{{ct('這個 agent 還沒有啟動過子代理。')}}</p>
   <p class="ti-note ti-hint">{{ct('點任何一則對話泡泡，這裡會顯示那一輪送給模型的內容與模型的輸出。')}}</p>
  </template>

  <template v-else>
   <dl class="ti-summary">
    <div><dt>{{ct('輸入 / 輸出')}}</dt><dd>{{n(data.tokens.input)}} / {{n(data.tokens.output)}}</dd></div>
    <div><dt>{{ct('快取 讀 / 寫')}}</dt><dd>{{n(data.tokens.cacheRead)}} / {{n(data.tokens.cacheWrite)}}</dd></div>
    <div><dt>{{ct('這一輪 token')}}</dt><dd>{{total(data.tokens)}}</dd></div>
    <div><dt>{{ct('估算費用')}}</dt><dd>{{estimatedCost(data,ct,4)}}</dd></div>
    <div><dt>{{ct('工具呼叫')}}</dt><dd>{{data.tools}}</dd></div>
    <div v-if="elapsed"><dt>{{ct('耗時')}}</dt><dd>{{elapsed}}</dd></div>
    <div><dt>{{ct('第幾代')}}</dt><dd>{{data.generation}}</dd></div>
   </dl>
   <p v-if="data.partialFile" class="ti-note">{{ct('這份 transcript 過大，只讀取了尾端。')}}</p>

   <section v-for="(record,index) in data.records" :key="index" class="ti-record" :class="{'ti-sidechain':record.sidechain}">
    <div class="ti-record-head">
     <span class="ti-role">{{label(record,index)}}</span>
     <span v-if="record.model" class="ti-model">{{record.model}}</span>
     <span v-if="record.usage" class="ti-usage">{{usageLine(record.usage)}}</span>
    </div>
    <div v-for="(block,b) in record.blocks" :key="b" class="ti-block">
     <div v-if="block.name" class="ti-block-name">{{block.name}}</div>
     <div v-else-if="block.type!=='text'" class="ti-block-name">{{blockLabel(block)}}</div>
     <pre :class="{'ti-block-error':block.isError}">{{block.text}}</pre>
     <p v-if="block.clipped" class="ti-note">{{ct('內容過長，已截斷；原長')}} {{block.clipped.toLocaleString('en-US')}}</p>
    </div>
   </section>
   <p v-if="data.truncated" class="ti-note">{{ct('這一輪的紀錄過多，只顯示前面的部分。')}}</p>
  </template>
  </div>
 </aside>
</template>

<script>
import {computed, ref, watch} from 'vue';
import {api} from '../js/auth.js';
import {ct, duration} from '../js/agent-i18n.js';
import {modelLabel as labelFor} from '../js/agent-models.js';
import {estimatedCost} from '../js/usageCost.js';
export default {
 props: {data: Object, busy: Boolean, error: String, agent: Object},
 emits: ['close', 'back'],
 setup(props) {
  const n = value => Number(value || 0).toLocaleString('en-US');
  const total = t => n(t.input + t.output + t.cacheRead + t.cacheWrite);
  // Bare "4 / 303" said nothing about which was which, so each number is named.
  const usageLine = u => [`${ct('輸入')} ${n(u.input)}`, `${ct('輸出')} ${n(u.output)}`]
   .concat(u.cacheRead ? [`${ct('快取讀')} ${n(u.cacheRead)}`] : [])
   .concat(u.cacheWrite ? [`${ct('快取寫')} ${n(u.cacheWrite)}`] : [])
   .join(' · ');
  const elapsed = computed(() => {
   const from = Date.parse(props.data?.from || ''), to = Date.parse(props.data?.to || '');
   return Number.isFinite(from) && Number.isFinite(to) && to > from ? duration(Math.round((to - from) / 1000)) : '';
  });
  // The first record is the prompt as the model received it (the whole point of
  // this panel), so it gets said plainly rather than being labelled "user".
  const label = (record, index) => index === 0 ? ct('送給模型的內容')
   : record.role === 'assistant' ? ct('模型輸出') : ct('工具回傳');
  const blockLabel = block => ({thinking: ct('思考'), tool_result: ct('結果')}[block.type] || block.type);
  // Asked when the overview shows, and again when the agent's turn count moves (a
  // subagent that just finished appears without closing the column).
  const subagents = ref([]), openSub = ref(null);
  let asked = 0;
  watch(() => [props.agent?.id, !props.data && !props.busy, props.agent?.updatedAt], async ([id, overview]) => {
   if (!id || !overview) return;
   const run = ++asked;
   try { const r = await api('/conversations/' + id + '/subagents'); if (run === asked) subagents.value = Array.isArray(r?.subagents) ? r.subagents : []; }
   catch { if (run === asked) subagents.value = []; }
  }, {immediate: true});
  const clock = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false})}`; };
  const subCost = a => a.unpriced && !a.costUSD ? '' : '$' + Number(a.costUSD || 0).toFixed(2);
  const subTotal = computed(() => { const sum = subagents.value.reduce((t, a) => t + Number(a.costUSD || 0), 0); return sum ? '$' + sum.toFixed(2) : ''; });
  const subLine = a => {
   const from = Date.parse(a.startedAt || ''), to = Date.parse(a.endedAt || '');
   const took = Number.isFinite(from) && Number.isFinite(to) && to > from ? duration(Math.round((to - from) / 1000)) : '';
   return [clock(a.startedAt), took, `${ct('工具呼叫')} ${n(a.tools)}`, (a.models || []).map(labelFor).join('、')].filter(Boolean).join(' · ');
  };
  return {ct, n, total, usageLine, elapsed, label, blockLabel, estimatedCost, subagents, openSub, subLine, subCost, subTotal};
 },
};
</script>

<style scoped>
.transcript-inspector {position:absolute;top:calc(var(--f7-navbar-height) + var(--f7-safe-area-top,0px) + var(--f7-subnavbar-height,0px));right:0;bottom:0;width:var(--transcript-inspector-width);z-index:120;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;background:var(--f7-page-bg-color);border-left:1px solid var(--f7-list-item-border-color);}
.ti-head {flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--f7-page-bg-color);border-bottom:1px solid var(--f7-list-item-border-color);}
.ti-head .link {flex:0 0 auto;width:36px;height:36px;justify-content:center;}
.ti-spacer {flex:0 0 36px;}
.ti-title {flex:1;min-width:0;text-align:center;font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ti-body {flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 16px 24px;display:flex;flex-direction:column;}
.ti-state {padding:24px 0;color:var(--cc-color-text-secondary);font-size:15px;line-height:1.5;}
.ti-error {color:var(--f7-theme-color-red,#eb4d3d);}
.ti-summary {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;margin:0 0 16px;}
.ti-summary div {min-width:0;}
.ti-summary dt {font-size:13px;color:var(--cc-color-text-secondary);}
.ti-summary dd {margin:2px 0 0;font-size:16px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.ti-section {font-size:15px;font-weight:600;margin:14px 0 8px;}
.ti-hint {margin-top:16px;line-height:1.5;}
.ti-sub-title {display:flex;align-items:baseline;justify-content:space-between;}
.ti-sub-total {font-size:12px;font-weight:400;color:var(--cc-color-text-secondary);font-variant-numeric:tabular-nums;}
.ti-sub {margin-bottom:10px;padding:10px 14px;border-radius:16px;background:rgba(120, 120, 128, .16);}
.ti-sub-head {display:flex;flex-direction:column;gap:5px;width:100%;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;}
.ti-sub-top {display:flex;align-items:center;gap:8px;}
.ti-sub-type {padding:2px 8px;border-radius:9px;background:rgba(120, 120, 128, .32);font-size:12px;font-weight:600;line-height:1.4;}
.ti-sub-cost {margin-left:auto;font-size:13px;font-variant-numeric:tabular-nums;}
.ti-sub-arrow {font-size:13px;color:var(--cc-color-text-secondary);}
.ti-sub-name {font-size:15px;line-height:1.35;overflow-wrap:anywhere;}
.ti-sub-meta {font-size:12px;color:var(--cc-color-text-secondary);font-variant-numeric:tabular-nums;}
.ti-sub.open .ti-sub-head {margin-bottom:10px;}
.ti-sub pre {margin-bottom:8px;}
.ti-sub pre:last-child {margin-bottom:2px;}
.ti-record {margin-bottom:16px;}
.ti-sidechain {border-left:2px solid var(--f7-list-item-border-color);padding-left:10px;}
.ti-record-head {display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-bottom:6px;}
.ti-role {font-size:15px;font-weight:600;}
.ti-model,.ti-usage {font-size:12px;color:var(--cc-color-text-secondary);font-variant-numeric:tabular-nums;}
.ti-block + .ti-block {margin-top:8px;}
.ti-block-name {font-size:12px;color:var(--cc-color-text-secondary);margin-bottom:4px;word-break:break-all;}
pre {margin:0 0 16px;padding:12px 14px;border-radius:10px;background:var(--f7-message-received-bg-color);font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;}
.ti-block pre {margin-bottom:0;}
.ti-block-error {color:var(--f7-theme-color-red,#eb4d3d);}
.ti-note {margin:6px 0 0;font-size:12px;color:var(--cc-color-text-secondary);}
</style>
