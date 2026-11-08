<template>
 <f7-popup :opened="newOpen" :swipe-to-close="sheetSwipe" :push="sheetSwipe" @popup:closed="newOpen&&closeNew()" class="agent-create" :class="{'sheet-swipe':sheetSwipe}"><div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"/><f7-view><f7-page>
  <!-- Laid out like Agent Profile: close at the left,
       create at the right, cards of one width, and what explains a row is its hover hint. -->
  <f7-navbar><f7-nav-left><f7-link icon-only icon-f7="xmark" :class="{disabled:busy}" :aria-label="ct('關閉')" @click="closeNew"/></f7-nav-left><f7-nav-title>{{ct('新增 agent')}}</f7-nav-title><f7-nav-right><f7-link icon-only icon-f7="checkmark_alt" class="agent-create-go" :class="{disabled:busy||!newProfile.title.trim()}" :aria-label="ct('建立 Agent')" :title="ct('建立 Agent')" @click="!busy&&newProfile.title.trim()&&create()"/></f7-nav-right></f7-navbar>
  <!-- Measured, so that on a computer the sheet is as tall as what it holds. -->
  <div ref="newBody" class="agent-create-body">
  <AgentProfileFields v-if="newOpen" v-model="newProfile" :collapsed="false" :admin="user?.role==='admin'" :show-access="user?.role==='admin'" :allow-full="personal"/>
  <!-- An admin only: carry on an existing local Claude session (the server refuses anyone else). -->
  <f7-list v-if="personal" inset strong-ios class="resume-session" :title="ct('只有管理員能用。填入本機 Claude session 的 ID，這個 Agent 會接著那段對話繼續；那個 session 不要同時在別的地方執行。')"><f7-list-input :label="ct('接續既有 session')" :value="newProfile.resumeSessionId||''" @update:value="newProfile={...newProfile,resumeSessionId:String($event).trim()}" :placeholder="ct('Claude session ID（選填）')" autocapitalize="off" autocorrect="off" spellcheck="false"/></f7-list>
  <f7-list inset strong-ios class="start-later" :title="ct('接續既有 session 時，那個 session 還開著就先不要啟動；之後在 Agent Profile 按啟動。')"><f7-list-item :title="ct('建立後先不啟動')"><template #after><label class="toggle"><input type="checkbox" :aria-label="ct('建立後先不啟動')" :checked="newProfile.start===false" @change="newProfile={...newProfile,start:$event.target.checked?false:undefined}"/><span class="toggle-icon"></span></label></template></f7-list-item></f7-list>
  <!-- A session's own JSON fills the sheet;
       folded and last, since it is optional. -->
  <template v-if="user?.role==='admin'">
   <f7-list inset accordion-list class="cc-settings-list import-json"><f7-list-item ref="importRow" accordion-item :title="ct('匯入 JSON')" :after="importDone?ct('已帶入'):''"><f7-accordion-content>
    <f7-list><f7-list-input type="textarea" :value="importText" @update:value="importText=$event" :placeholder="ct('貼上 session 產出的 JSON，或選擇 .json 檔')" :resizable="true" rows="3"/></f7-list>
    <div class="import-actions"><f7-button round outline small :class="{disabled:!importText.trim()}" @click="importText.trim()&&applyImport(importText)">{{ct('帶入欄位')}}</f7-button><f7-button round outline small @click="$refs.importInput.click()">{{ct('選擇 .json 檔')}}</f7-button><input ref="importInput" class="import-file" type="file" accept=".json,application/json,text/plain" hidden @change="onImportFile"/></div>
    <f7-block-footer v-if="importNote" role="status" class="import-note">{{importNote}}</f7-block-footer>
   </f7-accordion-content></f7-list-item></f7-list>
  </template>
  <f7-block v-if="wakeError" role="alert">{{wakeError}}</f7-block>
  </div>
 </f7-page></f7-view></f7-popup>

  <f7-popup ref="infoPopup" :opened="infoOpen" :close-by-backdrop-click="false" :swipe-to-close="sheetSwipe" :push="sheetSwipe" @popup:closed="infoOpen=false" class="conversation-info" :class="{'sheet-swipe':sheetSwipe}"><div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"/><f7-view><f7-page><f7-navbar><f7-nav-left><f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉對話資訊')" @click="closeProfile()"/></f7-nav-left><f7-nav-title>{{'Agent Profile'}}</f7-nav-title><f7-nav-right><!-- Save without scrolling to the button at the end. --><f7-link v-if="user?.role==='admin'" icon-only icon-f7="floppy_disk" class="profile-save" :class="{disabled:profileSaving||!profileDirty||!profileDraft?.title?.trim()}" :aria-label="ct('保存 Agent Profile')" @click="!profileSaving&&profileDirty&&profileDraft?.title?.trim()&&saveProfile()"/></f7-nav-right></f7-navbar>
   <AgentProfilePanel v-if="infoOpen" @trace-start="infoOpen=false"/>
  </f7-page></f7-view></f7-popup>
<!-- Searching this conversation, from the search
       button beside the terminal switch; a tap on a result opens the message. -->
  <f7-popup :opened="searchPopupOpen" :swipe-to-close="sheetSwipe" :push="sheetSwipe" @popup:opened="focusSearch" @popup:closed="searchPopupOpen&&(searchOpen=false)" class="message-search-popup" :class="{'sheet-swipe':sheetSwipe}"><div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"/><f7-view><f7-page>
   <f7-navbar><f7-nav-left><f7-link popup-close icon-only icon-f7="xmark" :aria-label="ct('關閉搜尋')"/></f7-nav-left><f7-nav-title>{{ct('搜尋這個對話')}}</f7-nav-title></f7-navbar>
   <f7-list inset><f7-list-input v-model:value="searchText" type="search" :placeholder="ct('搜尋聊天記錄')" :aria-label="ct('搜尋聊天記錄')" class="message-search-input"/></f7-list>
   <MessageSearchResults v-if="searchPopupOpen&&selected" :query="searchText" :conversation-id="selected" @pick="pickFound"/>
  </f7-page></f7-view></f7-popup>
<!-- The agent's checklists on a phone. -->
  <f7-popup :opened="checklistPopupOpen" :swipe-to-close="sheetSwipe" :push="sheetSwipe" @popup:closed="checklistPopupOpen&&(checklistOpen=false)" class="checklist-popup" :class="{'sheet-swipe':sheetSwipe}"><div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"/><f7-view><f7-page>
   <f7-navbar><f7-nav-left><f7-link popup-close icon-only icon-f7="xmark" :aria-label="ct('關閉待辦事項')"/></f7-nav-left><f7-nav-title>{{ct('待辦事項')}}</f7-nav-title><f7-nav-right><f7-link icon-only icon-f7="plus" class="checklist-new" :aria-label="ct('新增清單')" @click="newChecklist"/></f7-nav-right></f7-navbar>
   <ChecklistPanel v-if="checklistPopupOpen" :key="selected"/>
  </f7-page></f7-view></f7-popup>
<!-- How full the context is, from the phone's 「⋯」 menu or beside the terminal; the right
       column on a desktop. -->
  <f7-popup :opened="usagePopupOpen" :swipe-to-close="sheetSwipe" :push="sheetSwipe" @popup:closed="usagePopupOpen&&(usageOpen=false)" class="usage-popup" :class="{'sheet-swipe':sheetSwipe}"><div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"/><f7-view><f7-page>
   <f7-navbar><f7-nav-left><f7-link popup-close icon-only icon-f7="xmark" :aria-label="ct('關閉用量')"/></f7-nav-left><f7-nav-title>{{ct('用量')}}</f7-nav-title><f7-nav-right><f7-link icon-only icon-f7="arrow_clockwise" class="usage-refresh" :class="{spinning:usageRefreshing}" :aria-label="ct('重新整理用量')" @click="refreshUsage"/></f7-nav-right></f7-navbar>
   <ContextUsagePanel v-if="usagePopupOpen" :usage="detail?.contextUsage" :agent="detail"/>
  </f7-page></f7-view></f7-popup>
<GlassDropdown :open="!!menuConversation" :point="menuPoint" :items="user?.role==='admin'?[{value:'rename',label:ct('重新命名'),icon:'pencil'},{value:'remove',label:ct('刪除'),icon:'trash',danger:true}]:[]" @close="menuConversation=null" @select="menuAction"/></template>
<script>
import AgentProfileFields from "./AgentProfileFields.vue";
import {scopedAgents} from "../js/agentPreferences.js";
import AgentProfilePanel from "./AgentProfilePanel.vue";
import MessageSearchResults from "./MessageSearchResults.vue";
import ChecklistPanel,{askNewChecklist} from "./ChecklistPanel.vue";
import ContextUsagePanel from "./ContextUsagePanel.vue";
import {inject,computed,ref,watch,onBeforeUnmount} from "vue";import {f7} from "framework7-vue";import GlassDropdown from "./GlassDropdown.vue";import {parseAgentJson} from "../js/agentImport.js";import {ct} from "../js/agent-i18n.js";import {sheetSwipe,guardSheet} from "../js/sheetSwipe.js";
export default {components:{GlassDropdown,AgentProfileFields,AgentProfilePanel,MessageSearchResults,ChecklistPanel,ContextUsagePanel},setup(){const w=inject("workspace");
 const personal=computed(()=>w.user.value?.role==="admin");
 // A server that cannot fence an agent (Windows: Claude Code has no sandbox there, see
 // channel/platform.cjs) would refuse a scoped one at its first start. An admin's new agent
 // starts with full access instead, and the form says why.
 watch([()=>w.newOpen.value,scopedAgents],([open,scoped])=>{if(open&&personal.value&&scoped===false&&!w.newProfile.value.access?.full)w.newProfile.value={...w.newProfile.value,access:{...w.newProfile.value.access,full:true}};});
 const importText=ref(""),importNote=ref(""),importDone=ref(false),importRow=ref(null);
 // Each opening of the sheet starts the import empty.
 watch(()=>w.newOpen.value,open=>{if(open){importText.value="";importNote.value="";importDone.value=false;}});
 // The sheet's height follows its content on a computer, up to the window's; a phone's
 // popup is the whole screen and ignores the variable.
 const newBody=ref(null);let bodyWatch=null;
 function fitSheet(){const body=newBody.value,content=body?.closest('.page-content'),popup=body?.closest('.popup');if(!content||!popup||!body.offsetHeight)return;
  const cs=getComputedStyle(content);
  popup.style.setProperty('--f7-popup-tablet-height',`min(${Math.ceil(body.offsetHeight+(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0))}px, calc(100vh - 48px))`);}
 // Measured only while the sheet is open: the observer is detached when it closes and
 // when this unmounts.
 function stopSheetWatch(){bodyWatch?.disconnect();bodyWatch=null;newBody.value?.closest('.popup')?.style.removeProperty('--f7-popup-tablet-height');}
 watch([newBody,()=>w.newOpen.value],([el,open])=>{stopSheetWatch();if(el&&open){fitSheet();if(typeof ResizeObserver!=='undefined'){bodyWatch=new ResizeObserver(fitSheet);bodyWatch.observe(el);}}},{flush:'post'});
 onBeforeUnmount(stopSheetWatch);
 // Agent Profile closes only through closeProfile, which asks first about unsaved changes:
 // a backdrop tap and a pull down with changes go through it too (sheetSwipe.js, shared by
 // every sheet).
 const infoPopup=ref(null);
 guardSheet(infoPopup,{dirty:()=>w.profileDirty.value,request:()=>w.closeProfile()});
 // Only what the JSON names is replaced. Folders are left out while full access is on:
 // the lists are hidden then, so a folder the server refuses could not be fixed.
 function applyImport(text){
  importDone.value=false;
  try{const d=parseAgentJson(text),p={...w.newProfile.value};
   for(const k of ["title","description","memory"])if(d[k]!==undefined)p[k]=d[k];
   if(personal.value&&d.resumeSessionId)p.resumeSessionId=d.resumeSessionId;
   const skipped=!!(d.allow?.length&&p.access?.full);
   if(d.allow&&!p.access?.full)p.access={exclude:[],domains:[],...(p.access||{}),allow:d.allow};
   w.newProfile.value=p;importText.value="";importNote.value=skipped?ct("完整權限已開，資料夾清單沒有帶入。"):"";
   // Brought in: the import folds away, its 已帶入 left on the row.
   importDone.value=true;f7.accordion.close(importRow.value?.$el);
  }catch(e){importNote.value=ct(e.message);}
 }
 async function onImportFile(e){const f=e.target.files?.[0];e.target.value="";if(!f)return;if(f.size>200000){importDone.value=false;importNote.value=ct("檔案太大");return;}applyImport(await f.text());}
 function focusSearch(){document.querySelector('.message-search-popup .message-search-input input')?.focus();}
 async function pickFound(hit){w.searchOpen.value=false;await w.showMessage(hit.conversationId,hit.messageId);}
 return {...w,newChecklist:()=>askNewChecklist(w),sheetSwipe,infoPopup,personal,importText,importNote,importDone,importRow,newBody,applyImport,onImportFile,focusSearch,pickFound,
 menuAction(value){const c=w.menuConversation.value;if(!c)return;if(value==="rename")w.renameConversation(c);if(value==="remove")w.deleteConversation(c);w.menuConversation.value=null;}}}};
</script>
<style scoped>
.import-actions{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px;margin:4px 0 12px;}
.agent-create-body{display:flow-root;padding-bottom:12px;}
/* The new-agent sheet's cards are one width and follow one another as Agent Profile's do. */
.agent-create :deep(.list){--f7-list-margin-vertical:10px;}
.agent-create :deep(.list.inset:not(.cc-settings-list)>ul>li){margin-left:var(--cc-space-5);margin-right:var(--cc-space-5);}
.agent-create :deep(.list+.block-footer){margin-top:8px;}
</style>