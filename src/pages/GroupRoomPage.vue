<template>
 <!-- One group chat: the owner's messages, each
      member's answers under its name, and what members send one another. Laid out as
      an agent's conversation, with checklists and search; no profile or transcript. -->
 <f7-page name="group" class="chat-page group-page" :data-chat="['switchless',sidePanel?'side-open':''].filter(Boolean).join(' ')" :page-content="false" @page:afterin="toBottom">
  <f7-navbar>
   <f7-nav-left><f7-link class="back" icon-only :aria-label="ct('返回群組清單')" @click="toGroups"><i class="icon icon-back"/></f7-link></f7-nav-left>
   <f7-nav-title sliding><span class="nav-agent-name group-title">{{room?.name||ct('群組')}}<small v-if="room" class="group-sub">{{room.members.length}} {{ct('位成員')}} · {{ct('主負責')}} {{leadName}}</small></span></f7-nav-title>
   <f7-nav-right>
    <f7-link icon-only icon-f7="checkmark_square" class="checklist-open" :class="{'inspector-on':sidePanel==='checklist'}" :aria-label="ct('待辦事項')" @click="toggle('checklist')"/>
    <f7-link icon-only icon-f7="search" class="conversation-search-open" :class="{'inspector-on':sidePanel==='search'}" :aria-label="ct('搜尋這個群組')" @click="toggle('search')"/>
    <f7-link icon-only icon-f7="person_2" class="group-settings" :aria-label="ct('群聊設定')" @click="settingsOpen=true"/>
    <f7-link v-if="isAdmin" icon-only icon-f7="chevron_left_slash_chevron_right" class="group-terminal" :aria-label="ct('開啟成員的終端機')" @click="openTerminalMenu"/>
   </f7-nav-right>
  </f7-navbar>
  <ChatComposer :highlights="[...mention.current.value.map(m=>'@'+m.title),'@All']" v-if="room" v-model:value="draft" :placeholder="ct('輸入訊息，@ 點名成員…')" @keydown="keydown">
   
   <template #inner-end><f7-link icon-only icon-f7="arrow_up" :class="{disabled:!canSend}" :aria-disabled="!canSend" :aria-label="ct('送出訊息')" @click="send"/></template>
  </ChatComposer>
  <div ref="scroll" class="page-content messages-content" @scroll.passive="onScroll">
   <f7-block v-if="error" role="alert">{{error}}</f7-block>
   <MessageList v-if="room" :messages="bubbles" :conversation-id="room.members[0]?.id" :has-older="false" :found-id="foundId" :typing="!!working" :typing-text="working"
    :empty-text="ct('@ 點名成員，或直接說話交給主負責。')" @preview="previewFile=$event" @open-peer="openAgent"/>
   <f7-block v-else-if="!error" class="group-loading"><f7-preloader/></f7-block>
  </div>
  <SlashMenu v-if="room&&slash.items.value.length" :items="slash.items.value" :active="slash.active.value" @hover="slash.active.value=$event" @pick="slash.complete"/>
  <MentionMenu v-else-if="room&&mention.items.value.length" :items="mention.items.value" :active="mention.active.value" @hover="mention.active.value=$event" @pick="pick"/>
  <aside v-if="sidePanel==='checklist'" class="profile-panel checklist-panel" :aria-label="ct('待辦事項')">
   <header class="pp-head"><f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉待辦事項')" @click="panel=null"/><div class="pp-title">{{ct('待辦事項')}}</div><f7-link icon-only icon-f7="plus" class="checklist-new" :aria-label="ct('新增清單')" @click="newChecklist"/></header>
   <div class="pp-body"><ChecklistPanel :key="room.id" :source="checklistSource"/></div>
  </aside>
  <aside v-if="sidePanel==='search'" class="profile-panel search-panel" :aria-label="ct('搜尋這個群組')">
   <header class="pp-head"><f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉搜尋')" @click="panel=null"/><div class="pp-title">{{ct('搜尋這個群組')}}</div><span class="pp-spacer"/></header>
   <div class="pp-body">
    <f7-list inset><f7-list-input v-model:value="searchText" type="search" :placeholder="ct('搜尋群組對話')" :aria-label="ct('搜尋群組對話')" class="message-search-input"/></f7-list>
    <MessageSearchResults :query="searchText" :searcher="searcher" @pick="found"/>
   </div>
  </aside>
  <Teleport to=".framework7-root">
   <!-- On a phone, the same two as popups: pushed cards that close on a pull down, as the
        conversation's are. -->
   <f7-popup :opened="popup==='checklist'" :swipe-to-close="sheetSwipe" :push="sheetSwipe" class="checklist-popup group-checklist-popup" :class="{'sheet-swipe':sheetSwipe}" @popup:closed="popup==='checklist'&&(panel=null)"><div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"/><f7-view><f7-page>
    <f7-navbar><f7-nav-left><f7-link popup-close icon-only icon-f7="xmark" :aria-label="ct('關閉待辦事項')"/></f7-nav-left><f7-nav-title>{{ct('待辦事項')}}</f7-nav-title><f7-nav-right><f7-link icon-only icon-f7="plus" class="checklist-new" :aria-label="ct('新增清單')" @click="newChecklist"/></f7-nav-right></f7-navbar>
    <ChecklistPanel v-if="popup==='checklist'&&room" :source="checklistSource"/>
   </f7-page></f7-view></f7-popup>
   <f7-popup :opened="popup==='search'" :swipe-to-close="sheetSwipe" :push="sheetSwipe" class="message-search-popup group-search-popup" :class="{'sheet-swipe':sheetSwipe}" @popup:closed="popup==='search'&&(panel=null)"><div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"/><f7-view><f7-page>
    <f7-navbar><f7-nav-left><f7-link popup-close icon-only icon-f7="xmark" :aria-label="ct('關閉搜尋')"/></f7-nav-left><f7-nav-title>{{ct('搜尋這個群組')}}</f7-nav-title></f7-navbar>
    <f7-list inset><f7-list-input v-model:value="searchText" type="search" :placeholder="ct('搜尋群組對話')" :aria-label="ct('搜尋群組對話')" class="message-search-input"/></f7-list>
    <MessageSearchResults v-if="popup==='search'" :query="searchText" :searcher="searcher" @pick="found"/>
   </f7-page></f7-view></f7-popup>
   <!-- A member's terminal, chosen from the navbar (admin only, as everywhere). -->
   <f7-popup :opened="!!terminalFor" class="group-terminal-popup" @popup:closed="terminalFor=null"><f7-view><f7-page :page-content="false">
    <f7-navbar><f7-nav-left><f7-link popup-close icon-only icon-f7="xmark" :aria-label="ct('關閉終端機')"/></f7-nav-left><f7-nav-title>{{terminalFor?.title}}</f7-nav-title></f7-navbar>
    <div class="group-terminal-body"><TerminalPane v-if="terminalFor" :key="terminalFor.id" :conversation-id="terminalFor.id"/></div>
   </f7-page></f7-view></f7-popup>
   <!-- Its name, members and lead, changed from inside the room. -->
   <GroupForm :open="settingsOpen" :group="room" @close="settingsOpen=false" @saved="settingsOpen=false"/>
   <AttachmentPreview :file="previewFile" :conversation-id="previewFile?.conversationId" @close="previewFile=null" @change="previewFile=$event"/>
  </Teleport>
  <GlassDropdown :open="terminalMenu" :point="menuPoint" :items="terminalItems" @close="terminalMenu=false" @select="chooseTerminal"/>
 </f7-page>
</template>
<script setup>
import {ref,computed,watch,nextTick,onMounted,onBeforeUnmount,inject,Teleport} from 'vue';
import {f7} from 'framework7-vue';
import {ct,listJoin} from '../js/agent-i18n.js';
import {defaultAvatar} from '../js/avatarShape.js';
import {activeTab} from '../js/tab-session.js';
import {shouldSendOnEnter} from '../js/chatKeyboard.js';
import {useMentionMenu,caretToEnd} from '../js/mentionMenu.js';
import {room,viewingGroup,loadRoom,sendToGroup,changeGroupChecklist,searchGroup,commandInGroup} from '../js/groups.js';
import {useSlashMenu} from '../js/slashMenu.js';
import {sheetSwipe} from '../js/sheetSwipe.js';
import SlashMenu from '../components/SlashMenu.vue';
import GroupForm from '../components/GroupForm.vue';
import {bindConversationViewport} from '../js/conversationViewport.js';
import {bindConversationComposer} from '../js/conversationComposer.js';
import ChatComposer from '../components/ChatComposer.vue';
import MessageList from '../components/MessageList.vue';
import MentionMenu from '../components/MentionMenu.vue';
import ChecklistPanel from '../components/ChecklistPanel.vue';
import MessageSearchResults from '../components/MessageSearchResults.vue';
import AttachmentPreview from '../components/AttachmentPreview.vue';
import GlassDropdown from '../components/GlassDropdown.vue';
import TerminalPane from '../TerminalPane.vue';

const props=defineProps({f7route:Object});
const id=props.f7route?.query?.id;
const w=inject('workspace');
const toGroups=()=>w.toGroups();
const isAdmin=computed(()=>w.user.value?.role==='admin');
const scroll=ref(null),draft=ref(''),error=ref(''),sending=ref(false),previewFile=ref(null),foundId=ref(null),searchText=ref('');
const panel=ref(null),settingsOpen=ref(false);
const sidePanel=computed(()=>w.wideScreen.value&&room.value?.id===id?panel.value:null);
const popup=computed(()=>!w.wideScreen.value?panel.value:null);
const toggle=name=>{panel.value=panel.value===name?null:name;};
const leadName=computed(()=>room.value?.members.find(m=>m.id===room.value.lead)?.title||'');
const member=agentId=>room.value?.members.find(m=>m.id===agentId);
// A member, or an agent the owner brought in with @ from its own chat.
const titleOf=(agentId,fallback)=>member(agentId)?.title||fallback||(w.conversations.value||[]).find(c=>c.id===agentId)?.title||ct('已離開的成員');
// The server's messages as bubbles: each member's under its name and picture, the
// ones members send one another marked as such, and to whom the owner's went.
const bubbles=computed(()=>(room.value?.id===id?room.value.messages:[]).map(m=>{
 if(m.role==='user'){const to=listJoin((m.targets||[]).map(t=>titleOf(t)+(Object.values(m.deliveries||{}).length&&m.deliveries[t]?.status==='failed'?ct('（未送達）'):'')));return {...m,footnote:to?ct('給 ')+to:''};}
 if(m.role==='system')return m;
 const a=member(m.agentId),avatar=a?.avatar||defaultAvatar(a||{});
 if(m.role==='relay')return {...m,role:'assistant',speaker:{label:titleOf(m.agentId,m.agentTitle)+' → '+titleOf(m.to,m.toTitle),to:true,avatar}};
 return {...m,speaker:{label:titleOf(m.agentId,m.agentTitle)+(m.agentId===room.value.lead?' · '+ct('主負責'):''),avatar}};
}));
const working=computed(()=>{const busy=(room.value?.members||[]).filter(m=>m.busy).map(m=>m.title);return busy.length?listJoin(busy)+' '+ct('正在處理'):'';});
const canSend=computed(()=>!!draft.value.trim()&&!sending.value);
// "@" offers the members, the lead first; the other agents are shown greyed out.
const mention=useMentionMenu({draft,agents:computed(()=>{
 const members=room.value?.members||[];
 const inRoom=[...members].sort((a,b)=>(b.id===room.value.lead)-(a.id===room.value.lead)).map(m=>({...m,note:m.id===room.value.lead?ct('主負責'):ct('成員')}));
 const others=(w.conversations.value||[]).filter(c=>!members.some(m=>m.id===c.id)).map(c=>({id:c.id,title:c.title,avatar:c.avatar,source:c.source,provider:c.provider,note:ct('不在群組'),disabled:true}));
 // @All first: every member at once.
 const everyone=members.length>1?[{id:'all',title:'All',everyone:true,note:ct('所有成員')}]:[];
 return [...everyone,...inRoom,...others];
})});
const page=()=>scroll.value?.closest('.page');
const pick=item=>mention.complete(item,()=>caretToEnd(page()));
// "@member /…" offers that member's own slash commands and skills: the part after the name is what the menu reads and writes.
const slashTarget=computed(()=>{
 const text=draft.value||'';if(!text.startsWith('@'))return null;
 for(const m of [...(room.value?.members||[])].sort((a,b)=>b.title.length-a.title.length)){const prefix='@'+m.title+' ';if(text.startsWith(prefix)&&text.slice(prefix.length).startsWith('/'))return {member:m,prefix};}
 return null;
});
const slashDraft=computed({get:()=>slashTarget.value?draft.value.slice(slashTarget.value.prefix.length):'',set:v=>{if(slashTarget.value)draft.value=slashTarget.value.prefix+v;}});
const slash=useSlashMenu({draft:slashDraft,conversationId:computed(()=>slashTarget.value?.member.id||null),caret:()=>caretToEnd(page())});
function keydown(e){if(slash.onKeydown(e,send))return;if(mention.onKeydown(e,()=>caretToEnd(page())))return;if(shouldSendOnEnter(e,f7.device)){e.preventDefault();send();}}
let atBottom=true;
function onScroll(){const el=scroll.value;if(el)atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<48;}
function toBottom(){nextTick(()=>{const el=scroll.value;if(el)el.scrollTop=el.scrollHeight;atBottom=true;});}
async function refresh(opening=false){
 if(!id)return;
 try{await loadRoom(id,{viewing:activeTab.value==='view-groups'&&!document.hidden,opening});error.value='';}
 catch(e){error.value=e.message;}
}
watch(()=>room.value?.messages?.length,()=>{if(atBottom)toBottom();});
async function send(){
 if(!canSend.value)return;
 const text=draft.value.trim();sending.value=true;
 try{
  // A terminal command for one member runs in its terminal, which then opens; a skill
  // or anything else goes to it as a message, as in its own chat.
  const target=slashTarget.value;
  if(target&&isAdmin.value&&await slash.resolveTerminal(slashDraft.value)){await commandInGroup(id,target.member.id,slashDraft.value.trim());draft.value='';terminalFor.value=target.member;return;}
  await sendToGroup(id,text,mention.current.value.map(m=>m.id));draft.value='';toBottom();
 }
 catch(e){f7.dialog.alert(ct(e.message),ct('傳送失敗'));}
 finally{sending.value=false;}
}
const checklistSource=computed(()=>({lists:room.value?.checklists||[],change:body=>changeGroupChecklist(id,body)}));
function newChecklist(){f7.dialog.prompt('',ct('新清單名稱'),title=>{title=String(title??'').trim();if(title)changeGroupChecklist(id,{title});},()=>{},'');}
const searcher=q=>searchGroup(id,q);
// A tag in a bubble opens that agent's own chat.
const openAgent=agentId=>w.select(agentId);
function found(hit){
 panel.value=w.wideScreen.value?panel.value:null;
 foundId.value=hit.messageId;
 nextTick(()=>page()?.querySelector(`[data-message-id="${CSS.escape(hit.messageId)}"]`)?.scrollIntoView({block:'center'}));
 setTimeout(()=>{if(foundId.value===hit.messageId)foundId.value=null;},2600);
}
// The terminal: the member is chosen first.
const terminalMenu=ref(false),menuPoint=ref({clientX:0,clientY:0}),terminalFor=ref(null);
const terminalItems=computed(()=>(room.value?.members||[]).map(m=>({value:m.id,label:m.title+(m.id===room.value.lead?' · '+ct('主負責'):'')})));
function openTerminalMenu(e){const r=e?.currentTarget?.getBoundingClientRect?.();menuPoint.value={clientX:r?r.left+r.width/2:e?.clientX??0,clientY:r?r.bottom:e?.clientY??0};terminalMenu.value=true;}
function chooseTerminal(memberId){terminalMenu.value=false;terminalFor.value=member(memberId)||null;}

let cleanup,cleanupComposer,timer;
const onChanged=()=>{if(activeTab.value==='view-groups')refresh();};
onMounted(()=>{
 viewingGroup.value=id;
 if(room.value?.id!==id)room.value=null;
 refresh(true).then(toBottom);
 const el=page();cleanupComposer=bindConversationComposer(el);cleanup=bindConversationViewport(el);
 window.addEventListener('cc-agent-changed',onChanged);
 // A slow safety net for when the live socket is down.
 timer=setInterval(()=>{if(activeTab.value==='view-groups'&&!document.hidden)refresh();},15000);
});
onBeforeUnmount(()=>{if(viewingGroup.value===id)viewingGroup.value=null;clearInterval(timer);window.removeEventListener('cc-agent-changed',onChanged);cleanup?.();cleanupComposer?.();});
</script>
<style scoped src="../agent-pages/chatPage.css"></style>
<style scoped>
.group-title {display:flex;flex-direction:column;align-items:center;line-height:1.15;}
.group-sub {font-size:12px;font-weight:400;opacity:.6;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.group-loading {text-align:center;}
/* A phone's navbar has no room for it beside the buttons. */
@media (max-width:480px){.group-sub {display:none;}.group-title {display:block;}.group-page :deep(.navbar .title) {left:0 !important;flex:1 1 auto;justify-content:flex-start;margin:0 8px;}}
.group-terminal-body {position:absolute;inset:calc(var(--f7-navbar-height) + var(--f7-safe-area-top,0px)) 0 0 0;display:flex;flex-direction:column;}
</style>
