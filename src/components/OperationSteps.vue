<template>
 <!-- An operation's progress: one line saying what
      is being done now, a bar, and how far along it is, instead of a list whose lines wrapped.
      A line without a step mark (how long a compaction has run) is shown as it is. -->
 <div v-if="steps.length" class="op-progress">
  <template v-if="marked">
   <div class="op-now" role="status">{{now}}</div>
   <div class="op-bar" role="progressbar" aria-valuemin="0" :aria-valuemax="rows.length" :aria-valuenow="done"><i :style="{width:width+'%'}"/></div>
   <div class="op-count">{{Math.min(done+1,rows.length)}} / {{rows.length}}</div>
  </template>
  <div v-else v-for="row in rows" :key="row.text" class="op-now">{{row.text}}</div>
 </div>
</template>
<script setup>
import {computed} from 'vue';
import {ct} from '../js/agent-i18n.js';
const props=defineProps({steps:{type:Array,default:()=>[]}});
const MARKS={'✓':'done','⋯':'active','○':'todo'};
const rows=computed(()=>props.steps.map(s=>{const state=MARKS[String(s).charAt(0)];return state?{state,text:String(s).slice(2)}:{state:null,text:String(s)};}));
const marked=computed(()=>rows.value.length>0&&rows.value.every(r=>r.state));
const done=computed(()=>rows.value.filter(r=>r.state==='done').length);
const active=computed(()=>rows.value.find(r=>r.state==='active')||rows.value.find(r=>r.state==='todo'));
// What is being done now, as a sentence; once every step is done, that it is.
const DOING=()=>({[ct('啟動 Claude')]:ct('正在啟動 Claude'),[ct('確認連線')]:ct('正在確認連線'),[ct('整理並保存交接資料')]:ct('正在整理並保存交接資料'),[ct('啟動新的 session')]:ct('正在啟動新的 session'),[ct('載入交接內容並確認連線')]:ct('正在載入交接內容並確認連線')});
const now=computed(()=>{
 if(!active.value)return rows.value.at(-1)?.text===ct('確認連線')?ct('已連線'):ct('已完成');
 return DOING()[active.value.text]||active.value.text;
});
const width=computed(()=>{const n=rows.value.length||1;return Math.round(Math.min(1,(done.value+(active.value?.state==='active'?0.5:0))/n)*100);});
</script>
<style scoped>
.op-progress {display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;}
.op-now {font-size:15px;line-height:1.4;color:var(--dp-color-text-secondary,#8e8e93);text-align:center;}
.op-bar {width:180px;max-width:100%;height:4px;border-radius:2px;background:color-mix(in srgb,currentColor 18%,transparent);overflow:hidden;color:var(--dp-color-text-secondary,#8e8e93);}
.op-bar i {display:block;height:100%;border-radius:2px;background:var(--vax-blue,var(--dp-color-accent,#0a84ff));transition:width .4s ease;}
.op-count {font-size:13px;color:var(--dp-color-text-secondary,#8e8e93);font-variant-numeric:tabular-nums;}
</style>
