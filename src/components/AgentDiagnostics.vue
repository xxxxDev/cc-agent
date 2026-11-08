<template>
 <f7-list inset accordion-list class="cc-settings-list">
  <f7-list-item accordion-item :title="ct('工程診斷資訊')">
   <f7-accordion-content><f7-block>
    <!-- 錄製診斷: anyone's, since it records where things
         are and the tag and class names of what was touched, never text; not only the
         keyboard, so its words say nothing about it. -->
    <f7-button class="diagnostics-record" @click="startTrace">{{ct('錄製診斷')}}</f7-button>
    <f7-button @click="copy">{{ct(copied?'已複製':'複製診斷資訊')}}</f7-button>
    <!-- 回報診斷: the same text to the admins, who read it on
         the admin tab's 診斷回報 page and may hand it to an agent. Anyone's. -->
    <f7-button class="diagnostics-report" :class="{disabled:reporting}" @click="report">{{ct(reported?'已回報':'回報診斷')}}</f7-button>
    <p v-if="copyError" role="alert">{{ct('無法自動複製，請選取下方文字複製。')}}</p>
    <pre class="diagnostic-text">{{text}}</pre>
   </f7-block></f7-accordion-content>
  </f7-list-item>
 </f7-list>
</template>
<script setup>
import {computed,ref} from 'vue';
import {f7} from 'framework7-vue';
import {api} from '../js/api.js';
import {keyboardTrace,startKeyboardTrace} from '../js/keyboardDiagnostics.js';
import {ct} from '../js/agent-i18n.js';
const props=defineProps({detail:{type:Object,required:true},status:String});
const emit=defineEmits(['trace-start']);
function startTrace(){startKeyboardTrace();emit('trace-start');}
const copied=ref(false),copyError=ref(false);
// Explicit support fields only: never serialize the account, memory, chat or credentials.
const text=computed(()=>[
 'CC Agent',
 `Version: ${typeof __APP_VERSION__==='undefined'?'dev':__APP_VERSION__}`,
 `Build: ${typeof __BUILD_ID__==='undefined'?'dev':__BUILD_ID__}`,
 `Agent ID: ${props.detail.id}`,
 `Session ID: ${props.detail.sessionId}`,
 `Generation: ${props.detail.generation}`,
 `Status: ${props.status} (${props.detail.phase})`,
 `Compact: ${props.detail.compactCount} / ${props.detail.threshold||'off (no automatic handoff)'}`,
 `Configured model: ${props.detail.model}`,
 `Configured effort: ${props.detail.effort}`,
 `Session model: ${props.detail.sessionModel||'legacy / unspecified'}`,
 `Session effort: ${props.detail.sessionEffort||'legacy / unspecified'}`,
 ...(keyboardTrace.value?['Recorded diagnostics:',keyboardTrace.value]:[]),
 'Session history:',
 ...(props.detail.runs||[]).map(run=>`  Generation ${run.number}: ${run.sessionId}${run.sessionId===props.detail.sessionId?' (current)':''}`),
].join('\n'));
// The same text to the admins, asked first: it is what the copy button gives, nothing more.
const reported=ref(false),reporting=ref(false);
function report(){
 if(reporting.value)return;
 f7.dialog.confirm(ct('把下方的診斷資訊送給管理員？'),ct('回報診斷'),async()=>{
  reporting.value=true;
  try{await api('/diagnostic-reports',{method:'POST',body:JSON.stringify({conversationId:props.detail.id,text:text.value,build:typeof __BUILD_ID__==='undefined'?'dev':__BUILD_ID__})});reported.value=true;f7.toast.create({text:ct('已回報給管理員'),closeTimeout:1800}).open();}
  catch(e){f7.dialog.alert(e.message);}
  finally{reporting.value=false;}
 });
}
async function copy(){copied.value=false;copyError.value=false;try{await navigator.clipboard.writeText(text.value);copied.value=true;}catch{copyError.value=true;}}
</script>
<style scoped>
.diagnostic-text {white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;font-size:13px;}
</style>
