<template>
  <!-- An admin's own tab: what only an admin sets,
       moved out of Settings, under the Claude usage so a phone sees it too. -->
  <!-- Pulled down, the usage is asked for again and the counts reloaded. -->
  <f7-page name="admin" class="page-large-static" ptr :ptr-mousewheel="true" @ptr:refresh="pullRefresh" @page:afterin="loadOpenReports">
    <f7-navbar large :title="t('tabAdmin')" />

    <template v-if="usageGroups.length">
      <f7-block-title>{{ t('sectionUsage') }}</f7-block-title>
      <!-- Plain list markup: f7-list cannot take a component's rows as its own. -->
      <UsageMeters list class="cc-settings-list admin-usage"/>
    </template>

    <!-- Grouped as Usage, Agent, System and Account. -->
    <!-- Agent, handoff and wrap-up each a group of their own, the handoff settings one row each. -->
    <f7-block-title>{{ t('sectionAgent') }}</f7-block-title>
    <f7-list inset class="fs-settings-list">
      <!-- The subagents' model and effort for every full-access Claude agent. -->
      <f7-list-item link no-chevron class="subagent-row" :title="ct('子代理模型與 Effort')" :after="subagentLabel(subagents)" @click.prevent="editSubagentDefault"><template #media><f7-icon f7="person_2"/></template></f7-list-item>
      <f7-list-item link no-chevron class="archive-retention" :title="ct('Agent 刪除')" :after="retentionLabel(archiveRetentionDays)" @click.prevent="openDropdown('retention',$event)"><template #media><f7-icon f7="trash"/></template></f7-list-item>
    </f7-list>

    <f7-block-title>{{ t('sectionHandoff') }}</f7-block-title>
    <f7-list inset class="fs-settings-list handoff-list">
      <!-- When each agent's Claude Code compacts (issue #12). -->
      <f7-list-item link no-chevron class="auto-compact-row" :title="ct('自動壓縮時機')" :after="autoCompactLabel(autoCompact)" :footer="ct('用到這個量就先壓縮，超過模型上限不起作用。太低會一直壓縮。只影響 CC Agent 的 agent。')" @click.prevent="openDropdown('autoCompact',$event)"><template #media><f7-icon f7="rectangle_compress_vertical"/></template></f7-list-item>
      <f7-list-item link no-chevron class="handoff-threshold-row" :title="ct('Compact 自動接續')" :after="compactPolicy(compactThreshold)" @click.prevent="openDropdown('compact',$event)"><template #media><f7-icon f7="arrow_2_circlepath"/></template></f7-list-item>
      <!-- How many recent messages a handoff carries, by hand or automatic (issue #9). -->
      <f7-list-item link no-chevron class="handoff-recent-row" :title="ct('接續時帶入訊息')" :after="handoffCount(handoff.recent)" @click.prevent="editHandoffRecent"><template #media><f7-icon f7="text_bubble"/></template></f7-list-item>
      <f7-list-item class="handoff-ask-row" :title="ct('手動接續時詢問則數')" :footer="ct('按「接續」時先問要帶幾則，預先填好上面的數字。')"><template #media><f7-icon f7="question_circle"/></template><template #after><label class="toggle"><input type="checkbox" :aria-label="ct('手動接續時詢問則數')" :checked="handoff.ask" @change="saveHandoff({ask:$event.target.checked},$event)"/><span class="toggle-icon"></span></label></template></f7-list-item>
      <!-- Start at the first message after a handoff (issue #11). -->
      <f7-list-item link no-chevron class="handoff-lazy-row" :title="ct('接續後')" :after="handoff.lazy?ct('等第一則訊息'):ct('立即啟動')" :footer="handoff.lazy?ct('新 session 在下一則訊息進來時才啟動；其他 agent 直接在本機傳來的訊息叫不醒它。'):undefined" @click.prevent="openDropdown('lazy',$event)"><template #media><f7-icon f7="play_circle"/></template></f7-list-item>
    </f7-list>

    <f7-block-title>{{ t('sectionWrapUp') }}</f7-block-title>
    <f7-list inset class="fs-settings-list">
      <f7-list-item class="wrap-up-toggle" :title="ct('自動收尾檢查')" :footer="ct('預設關閉。開啟後，Agent 完成任務並閒置一段時間，會自動請它確認工作已保存、筆記是最新的；只讀資料或回答問題不會送。')"><template #media><f7-icon f7="checkmark_seal"/></template><template #after><label class="toggle"><input type="checkbox" :aria-label="ct('自動收尾檢查')" :checked="wrapUp.enabled" @change="saveWrapUp({enabled:$event.target.checked})"/><span class="toggle-icon"></span></label></template></f7-list-item>
      <f7-list-item v-if="wrapUp.enabled" link no-chevron class="wrap-up-minutes" :title="ct('收尾檢查等待時間')" :after="wrapUp.minutes+' '+ct('分鐘')" @click.prevent="openDropdown('wrapUp',$event)"><template #media><f7-icon f7="timer"/></template></f7-list-item>
      <f7-list-item v-if="wrapUp.enabled" link no-chevron class="wrap-up-text" :title="ct('收尾檢查內容')" :after="wrapUp.custom?ct('自訂'):ct('內建')" @click.prevent="editWrapUpText"><template #media><f7-icon f7="text_alignleft"/></template></f7-list-item>
      <!-- Finished checklists removed after these days. -->
      <f7-list-item link no-chevron class="checklist-retention" :title="ct('已完成的待辦事項保留')" :after="checklistRetentionLabel(checklistRetentionDays)" :footer="ct('整份清單的項目都完成後，從最後一次更新起算，到期自動刪除；還有未完成、進行中或卡住項目的清單不會刪。')" @click.prevent="openDropdown('checklistRetention',$event)"><template #media><f7-icon f7="checkmark_square"/></template></f7-list-item>
    </f7-list>

    <!-- Sign-in protection sits with the account settings. -->
    <f7-block-title>{{ t('sectionSystem') }}</f7-block-title>
    <f7-list inset class="cc-settings-list">
      <f7-list-item :title="ct('聊天室終端機切換')"><template #media><f7-icon f7="chevron_left_slash_chevron_right"/></template><template #after><label class="toggle"><input type="checkbox" :aria-label="ct('聊天室終端機切換')" :checked="terminalSwitch" @change="saveTerminalSwitch($event.target.checked)"/><span class="toggle-icon"></span></label></template></f7-list-item>
      <f7-list-item class="transcript-switch" :title="ct('Transcript 檢視')"><template #media><f7-icon f7="ant" class="ant-icon"/></template><template #after><label class="toggle"><input type="checkbox" :aria-label="ct('顯示 Transcript 檢視按鈕')" :checked="transcriptSwitch" @change="saveTranscriptSwitch($event.target.checked)"/><span class="toggle-icon"></span></label></template></f7-list-item>
      <!-- The peer link: pairing with another machine. -->
      <f7-list-item link class="peer-link-row" :title="ct('跨機連線')" @click.prevent="goPeerLink"><template #media><f7-icon f7="link"/></template></f7-list-item>
      <f7-list-item link :title="ct('範圍報告單')" :badge="openReports||null" badge-color="orange" @click.prevent="goReports"><template #media><f7-icon f7="lock_shield"/></template></f7-list-item>
      <!-- What people sent from Agent Profile's 「回報診斷」. -->
      <f7-list-item link class="diagnostic-reports-row" :title="ct('診斷回報')" :badge="openDiagnostics||null" badge-color="orange" @click.prevent="goDiagnostics"><template #media><f7-icon f7="doc_text_search"/></template></f7-list-item>
      <!-- The conversation's buttons, a phone's and a computer's order apart. -->
      <f7-list-item link class="nav-buttons-row" :title="ct('對話頁按鈕')" :footer="ct('手機版和電腦版的按鈕順序，手機右上要顯示幾個')" @click.prevent="goNavButtons"><template #media><f7-icon f7="rectangle_3_offgrid"/></template></f7-list-item>
    </f7-list>

    <f7-block-title>{{ t('sectionAccount') }}</f7-block-title>
    <f7-list inset class="cc-settings-list">
      <f7-list-item link :title="t('manageUsers')" @click.prevent="goUsers">
        <template #media><f7-icon f7="person_2" /></template>
      </f7-list-item>
      <f7-list-item link class="security-row" :title="ct('登入防禦')" @click.prevent="goSecurity"><template #media><f7-icon f7="shield_lefthalf_fill"/></template></f7-list-item>
    </f7-list>

    <!-- anchored glass dropdown -->
    <GlassDropdown
      :open="dropdownOpen"
      :point="dropdownPoint"
      :items="dropdownItems"
      :selected="dropdownSelected"
      @close="dropdownOpen = false"
      @select="onDropdownSelect"
    />
  </f7-page>
</template>

<script setup>
import {ct,listJoin,resultsJoin,labelled,compactCount,compactPolicy,handoffCount,autoCompactLabel} from '../js/agent-i18n.js';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { f7 } from 'framework7-vue';
import { t } from '../js/i18n.js';
import { api } from '../js/api.js';
import { escapeHtml } from '../js/safeDialog.js';
import { currentUser } from '../js/auth.js';
import GlassDropdown from '../components/GlassDropdown.vue';
import {editSubagents,subagentLabel} from '../js/subagentDialog.js';
import UsageMeters from '../components/UsageMeters.vue';
async function pullRefresh(done) { try { await Promise.all([loadUsage({fresh: true}), loadOpenReports(), loadAgentPreferences().catch(() => {})]); } finally { done(); } }
import { usageGroups, watchUsage, loadUsage } from '../js/usage.js';
import {subagents,autoCompact,autoCompactPresets,handoff,wrapUp,archiveRetentionDays,checklistRetentionDays,compactThreshold,terminalSwitch,transcriptSwitch,loadAgentPreferences,saveAgentPreferences} from '../js/agentPreferences.js';

const isAdmin = computed(() => currentUser.value?.role === 'admin');
const toast = (text) => f7.toast.create({ text, closeTimeout: 1800 }).open();

// The usage block is fetched while this page exists, whether or not it is on screen
// yet, so it is there when the tab is opened (shared with the sidebar: src/js/usage.js).
let stopUsage = null;
onMounted(() => { stopUsage = watchUsage(); });
onUnmounted(() => stopUsage?.());

const openReports=ref(0);
// How many scope reports wait for review, shown on the row.
const openDiagnostics=ref(0);
async function loadOpenReports(){if(!isAdmin.value)return;try{openReports.value=((await api('/access-reports')).reports||[]).filter(r=>r.status==='open').length;}catch{}try{openDiagnostics.value=((await api('/diagnostic-reports')).reports||[]).filter(r=>r.status==='open').length;}catch{}}
async function loadCompactPolicy(){if(!isAdmin.value)return;try{await loadAgentPreferences();}catch{}}
// Off unless asked for: the switch only appears in a conversation once this is on.
async function saveTranscriptSwitch(on){
  const previous=transcriptSwitch.value;
  transcriptSwitch.value=on;
  try{await saveAgentPreferences({transcriptSwitch:on});toast(t('settingsSaved'));}
  catch(e){transcriptSwitch.value=previous;f7.dialog.alert(e.message||t('settingsFailed'));}
}
async function saveTerminalSwitch(on){
  const previous=terminalSwitch.value;
  terminalSwitch.value=on;
  try{await saveAgentPreferences({terminalSwitch:on});toast(t('settingsSaved'));}
  catch(e){terminalSwitch.value=previous;f7.dialog.alert(e.message||t('settingsFailed'));}
}
// The wrap-up check: its switch, its wait, and its words in a dialog with room for
// several lines (empty goes back to the built-in ones).
const WRAP_UP_MINUTES=[5,10,15,30,60];
async function saveWrapUp(patch){
  const previous=wrapUp.value;
  wrapUp.value={...previous,...patch};
  try{await saveAgentPreferences({wrapUp:patch});toast(t('settingsSaved'));}
  catch(e){wrapUp.value=previous;f7.dialog.alert(e.message||t('settingsFailed'));}
}
function editSubagentDefault(){
  if(!isAdmin.value)return;
  editSubagents({title:ct('子代理模型與 Effort'),text:ct('完整權限的 Claude agent 啟動的子代理用這裡的模型和 Effort；個別 agent 可以在 Agent Profile 另外設定。改了要等 agent 重新啟動才生效。'),value:subagents.value,
    save:async next=>{
      const r=await saveAgentPreferences({subagents:next});toast(t('settingsSaved'));
      // The running agents following it take it when they start again: now, or later.
      offerApply(ct('子代理模型與 Effort'),r?.subagentPending||[],'/preferences/subagents-apply');
    }});
}
// The running agents following an admin page setting that start with it only when they
// start again: listed, and restarted only on "apply now".
function offerApply(title,pending,endpoint){
  if(pending.length)setTimeout(()=>f7.dialog.create({title,
    text:pending.length+' '+ct('個 agent 要重新啟動才會套用：')+listJoin(pending.map(a=>escapeHtml(a.title)+(a.busy?ct('（工作中）'):'')))+'<br><br>'+ct('現在套用：閒著的馬上重新啟動，工作中的等這次回覆結束；稍後：各自下次啟動時套用。'),
    buttons:[{text:ct('稍後')},{text:ct('現在套用'),strong:true,onClick:async()=>{try{const n=await api(endpoint,{method:'POST',body:JSON.stringify({ids:pending.map(a=>a.id)})});toast(labelled(ct('已套用'),resultsJoin([ct('已重新啟動')+' '+(n.now||0),ct('回覆結束後')+' '+(n['after-reply']||0)])));}catch(e){f7.dialog.alert(e.message);}}}],destroyOnClose:true}).open(),350);
}
// When every agent's Claude Code compacts unless it has its own (issue #12).
async function saveAutoCompact(value){
  const next=value==='default'?null:Number(value);
  if(next===autoCompact.value)return;
  try{const r=await saveAgentPreferences({autoCompact:next});toast(t('settingsSaved'));offerApply(ct('自動壓縮時機'),r?.autoCompactPending||[],'/preferences/auto-compact-apply');}
  catch(e){f7.dialog.alert(e.message||t('settingsFailed'));}
}
// The handoff settings, one row each.
async function saveHandoff(patch,event){
  try{await saveAgentPreferences({handoff:patch});toast(t('settingsSaved'));}
  catch(e){if(event?.target)event.target.checked=handoff.value.ask;f7.dialog.alert(e.message||t('settingsFailed'));}
}
function editHandoffRecent(){
  if(!isAdmin.value)return;
  const max=handoff.value.max||50;
  f7.dialog.prompt(ct('接續時帶入最近幾則訊息？')+'（0～'+max+'）',ct('接續時帶入訊息'),value=>{
    const text=String(value??'').trim(),recent=Number(text);
    if(!/^\d+$/.test(text)||recent>max){f7.dialog.alert(ct('請輸入 0 到 ')+max,ct('接續時帶入訊息'));return;}
    saveHandoff({recent});
  },()=>{},String(handoff.value.recent));
}
function editWrapUpText(){
  if(!isAdmin.value)return;
  const dialog=f7.dialog.create({title:ct('收尾檢查內容'),text:ct('送給 Agent 的檢查內容；留空會用回內建的內容。'),cssClass:'wrap-up-dialog',
    content:'<div class="dialog-input-field input"><textarea class="dialog-input" rows="12"></textarea></div>',
    buttons:[{text:ct('取消')},{text:ct('保存'),strong:true,onClick:d=>saveWrapUp({text:String(d.$el.find('textarea').val()||'')}).then(()=>loadAgentPreferences().catch(()=>{}))}],
    destroyOnClose:true});
  dialog.open();
  dialog.$el.find('textarea').val(wrapUp.value.text);
}
onMounted(loadCompactPolicy);onMounted(loadOpenReports);
watch(()=>[currentUser.value?.id,currentUser.value?.role],loadCompactPolicy);

// anchored dropdown state (compact / retention share one instance)
const dropdownOpen = ref(false);
const dropdownPoint = ref({ clientX: 0, clientY: 0 });
const dropdownKind = ref('compact');
const dropdownItems = computed(() => {
  if(dropdownKind.value==='wrapUp')return [...new Set([...WRAP_UP_MINUTES,wrapUp.value.minutes])].sort((a,b)=>a-b).map(n=>({value:String(n),label:n+' '+ct('分鐘')}));
  if(dropdownKind.value==='lazy')return [{value:'now',label:ct('立即啟動')},{value:'lazy',label:ct('等第一則訊息')}];
  if(dropdownKind.value==='autoCompact')return [{value:'default',label:autoCompactLabel(null)},...autoCompactPresets.value.map(n=>({value:String(n),label:autoCompactLabel(n)}))];
  if(dropdownKind.value==='retention')return [{value:'never',label:retentionLabel(null)},...RETENTION_CHOICES.map(d=>({value:String(d),label:retentionLabel(d)}))];
  if(dropdownKind.value==='checklistRetention')return [{value:'never',label:checklistRetentionLabel(null)},...CHECKLIST_RETENTION_CHOICES.map(d=>({value:String(d),label:checklistRetentionLabel(d)}))];
  return [...Array.from({length:10},(_,i)=>({value:String(i+1),label:compactCount(i+1)})),{value:'0',label:compactPolicy(0)}];
});
const dropdownSelected = computed(() => {
  if(dropdownKind.value==='wrapUp')return String(wrapUp.value.minutes);
  if(dropdownKind.value==='lazy')return handoff.value.lazy?'lazy':'now';
  if(dropdownKind.value==='autoCompact')return autoCompact.value?String(autoCompact.value):'default';
  if(dropdownKind.value==='retention')return archiveRetentionDays.value===null?'never':String(archiveRetentionDays.value);
  if(dropdownKind.value==='checklistRetention')return checklistRetentionDays.value===null?'never':String(checklistRetentionDays.value);
  return String(compactThreshold.value);
});

function openDropdown(kind, event) {
  if(!isAdmin.value)return;
  dropdownKind.value = kind;
  dropdownPoint.value = { clientX: event?.clientX ?? 0, clientY: event?.clientY ?? 0 };
  dropdownOpen.value = true;
}

// Deleted agents are kept until restored unless an admin sets a number of days. Shortening it says first which deleted agents
// the next sweep, within six hours, would purge for good.
const RETENTION_CHOICES=[7,14,30,60,90,180,365];
const retentionLabel=days=>days?days+' '+ct('天後永久刪除'):ct('不刪除');
const ask=(text,title)=>new Promise(done=>f7.dialog.confirm(text,title,()=>done(true),()=>done(false)));
async function saveRetention(value){
 const days=value==='never'?null:Number(value);
 if(days===archiveRetentionDays.value)return;
 try{
  if(days!==null){
   const {agents:deleted=[]}=await api('/archived-agents');
   const due=deleted.filter(a=>!a.keep&&Date.parse(a.archivedAt)<=Date.now()-days*86400000);
   if(due.length&&!await ask(listJoin(due.map(a=>a.title))+'\n'+ct('這些已刪除的 Agent 超過天數，6 小時內會被永久刪除，在平台上建立的連 session 一起清掉。'),retentionLabel(days)))return;
  }
  await saveAgentPreferences({archiveRetentionDays:days});toast(t('settingsSaved'));
 }catch(e){f7.dialog.alert(e.message);}
}
// Finished checklists: kept (the default) or removed this many days after their last change.
const CHECKLIST_RETENTION_CHOICES=[1,3,7,30];
const checklistRetentionLabel=days=>days?days+' '+ct('天'):ct('不刪除');
async function saveChecklistRetention(value){
 const days=value==='never'?null:Number(value);
 if(days===checklistRetentionDays.value)return;
 try{await saveAgentPreferences({checklistRetentionDays:days});toast(t('settingsSaved'));}catch(e){f7.dialog.alert(e.message);}
}
async function onDropdownSelect(value) {
  if(!isAdmin.value)return;
  if(dropdownKind.value==='wrapUp'){await saveWrapUp({minutes:Number(value)});return;}
  if(dropdownKind.value==='retention'){await saveRetention(value);return;}
  if(dropdownKind.value==='checklistRetention'){await saveChecklistRetention(value);return;}
  if(dropdownKind.value==='lazy'){await saveHandoff({lazy:value==='lazy'});return;}
  if(dropdownKind.value==='autoCompact'){await saveAutoCompact(value);return;}
  try{await saveAgentPreferences({compactThreshold:Number(value)});toast(t('settingsSaved'));}catch(e){f7.dialog.alert(e.message);}
}

function goSecurity() {
  f7.views.get('#view-admin').router.navigate('/security/');
}

function goPeerLink() {
  f7.views.get('#view-admin').router.navigate('/peer-link/');
}

function goReports() {
  f7.views.get('#view-admin').router.navigate('/access-reports/');
}
function goNavButtons(){f7.views.get('#view-admin').router.navigate('/nav-buttons/');}
function goDiagnostics() {
  f7.views.get('#view-admin').router.navigate('/diagnostic-reports/');
}

function goUsers() {
  f7.views.get('#view-admin').router.navigate('/users/');
}


</script>

<style scoped>
/* Toggle rows are plain (non-link) list items, so without this their titles
   are text-selectable while link rows are not, visually inconsistent. */
.cc-settings-list {
  user-select: none;
  -webkit-user-select: none;
}
/* The empty bar is a grey that shows on a light page as well as a dark one. */
.admin-usage {
  --usage-track: rgba(120, 120, 128, .24);
}
</style>
