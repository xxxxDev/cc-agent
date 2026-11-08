<template>
 <f7-list inset accordion-list class="cc-settings-list">
  <f7-list-item accordion-item :title="ct('工程診斷資訊')">
   <f7-accordion-content><f7-block>
    <!-- 錄製診斷: anyone's, since it records where things
         are and the tag and class names of what was touched, never text; not only the
         keyboard, so its words say nothing about it. -->
    <!-- While it records, anywhere in the app, it stops it
         and says for how long it has run, as the badge does. -->
    <f7-button class="diagnostics-record" :class="{recording:recording.active}" @click="toggleTrace">{{recording.active?ct('停止錄製')+' '+recordingClock(recording.elapsed):ct('錄製診斷')}}</f7-button>
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
import {recording,recordingClock,startKeyboardTrace,stopKeyboardTrace} from '../js/keyboardDiagnostics.js';
import {diagnosticsText,sendDiagnosticsReport} from '../js/diagnosticsText.js';
import {ct} from '../js/agent-i18n.js';
const props=defineProps({detail:{type:Object,required:true},status:String});
const emit=defineEmits(['trace-start']);
function toggleTrace(){if(recording.active){stopKeyboardTrace();return;}startKeyboardTrace(props.detail.id);emit('trace-start');}
const copied=ref(false),copyError=ref(false);
const text=computed(()=>diagnosticsText(props.detail,props.status));
// The same text to the admins, asked first: it is what the copy button gives, nothing more.
const reported=ref(false),reporting=ref(false);
function report(){
 if(reporting.value)return;
 f7.dialog.confirm(ct('把下方的診斷資訊送給管理員？'),ct('回報診斷'),async()=>{
  reporting.value=true;
  try{await sendDiagnosticsReport(props.detail.id,text.value);reported.value=true;f7.toast.create({text:ct('已回報給管理員'),closeTimeout:1800}).open();}
  catch(e){f7.dialog.alert(e.message);}
  finally{reporting.value=false;}
 });
}
async function copy(){copied.value=false;copyError.value=false;try{await navigator.clipboard.writeText(text.value);copied.value=true;}catch{copyError.value=true;}}
</script>
<style scoped>
.diagnostic-text {white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;font-size:13px;}
</style>
