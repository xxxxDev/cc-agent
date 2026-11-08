<template>
 <!-- While 錄製診斷 runs, on every page: a red pill under the navbar, in the middle on a
      phone and at the right of the page on a computer, that stops it and reports without going
      back to Agent Profile. Only the pill takes taps, and it never takes focus,
      so the composer and the keyboard stay as they are. -->
 <div v-if="recording.active" class="recording-badge-layer">
  <button type="button" class="recording-badge" tabindex="-1" :aria-label="label" @pointerdown.prevent @mousedown.prevent @click="ask"><span class="recording-dot" aria-hidden="true">●</span> {{label}}</button>
 </div>
</template>
<script setup>
import {computed,inject} from 'vue';
import {f7} from 'framework7-vue';
import {api} from '../js/api.js';
import {recording,recordingClock,stopKeyboardTrace} from '../js/keyboardDiagnostics.js';
import {diagnosticsText,sendDiagnosticsReport} from '../js/diagnosticsText.js';
import {statusLabel} from '../js/agentOperation.js';
import {ct} from '../js/agent-i18n.js';
const w=inject('workspace',null);
const label=computed(()=>ct('錄製中')+' '+recordingClock(recording.elapsed));
let asking=null;
function ask(){
 if(asking)return;
 asking=f7.dialog.create({
  title:ct('診斷錄製中'),
  text:ct('要停止錄製並把診斷資訊送給管理員嗎？'),
  verticalButtons:true,
  buttons:[
   {text:ct('停止並回報'),bold:true,cssClass:'recording-stop-report',onClick:stopAndReport},
   {text:ct('只停止'),cssClass:'recording-stop',onClick:()=>stopKeyboardTrace()},
   {text:ct('繼續錄製'),cssClass:'recording-continue'},
  ],
  on:{closed(){asking?.destroy();asking=null;}},
 }).open();
}
// The agent's detail as Agent Profile has it: the open one's, or read again.
async function detailOf(id){
 if(!id)return null;
 const open=w?.detail?.value;
 if(open?.id===id)return open;
 try{return await api('/conversations/'+id);}catch{return null;}
}
async function stopAndReport(){
 const id=recording.conversationId;
 stopKeyboardTrace();
 const detail=await detailOf(id);
 if(!detail){offerCopy(id);return;}
 try{await sendDiagnosticsReport(id,diagnosticsText(detail,statusLabel(detail)));f7.toast.create({text:ct('已回報給管理員'),closeTimeout:1800}).open();}
 catch(e){f7.dialog.alert(e.message);}
}
// The agent is gone, or no longer this account's: nothing is sent; the text can be copied.
function offerCopy(id){
 const text=diagnosticsText({id,unavailable:true});
 const dialog=f7.dialog.create({
  title:ct('回報診斷'),
  text:ct('這個 agent 已經無法取得，診斷資訊沒有送出。可以改為複製下來。'),
  buttons:[{text:ct('取消')},{text:ct('複製診斷資訊'),bold:true,cssClass:'recording-copy',onClick:async()=>{
   try{await navigator.clipboard.writeText(text);f7.toast.create({text:ct('已複製'),closeTimeout:1800}).open();}
   catch{showText(text);}
  }}],
  on:{closed(){dialog.destroy();}},
 });
 dialog.open();
}
// No clipboard: the text in a box to select and copy by hand.
const escapeHtml=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function showText(text){
 const dialog=f7.dialog.create({title:ct('無法自動複製，請選取下方文字複製。'),content:`<textarea class="recording-text" readonly style="width:100%;height:40vh;font:12px ui-monospace,Menlo,monospace;">${escapeHtml(text)}</textarea>`,buttons:[{text:ct('關閉')}],on:{closed(){dialog.destroy();}}});
 dialog.open();
}
</script>
<style scoped>
/* Above pages and sheets, under dialogs (13000) and toasts. */
.recording-badge-layer{position:fixed;z-index:12600;left:0;right:0;top:calc(var(--f7-safe-area-top, env(safe-area-inset-top, 0px)) + var(--f7-navbar-height, 44px) + 6px);display:flex;justify-content:center;pointer-events:none;}
.recording-badge{pointer-events:auto;flex:0 0 auto;width:auto;max-width:calc(100vw - 32px);margin:0;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border:0;border-radius:14px;background:#e5342b;color:#fff;font:600 13px/1 -apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;font-variant-numeric:tabular-nums;box-shadow:0 2px 10px rgba(0,0,0,.28);cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}
.recording-badge:active{opacity:.8;}
.recording-dot{font-size:10px;animation:recording-blink 1.4s ease-in-out infinite;}
@keyframes recording-blink{50%{opacity:.35;}}
@media (prefers-reduced-motion:reduce){.recording-dot{animation:none;}}
/* A computer: the top right of the page, clear of the navbar's buttons. */
@media (min-width:1024px){.recording-badge-layer{justify-content:flex-end;padding-right:calc(16px + var(--f7-safe-area-right, 0px));}}
</style>
