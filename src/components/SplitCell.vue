<template>
 <!-- One conversation in a split-view cell, drawn by the page itself rather than a
      whole copy of the app in a frame (several frames each booting the app and
      asking the server on their own made the view slow). It does what the
      conversation page does: the same bubbles and composer, "/" and "@", files, permission
      requests, reconnecting, the shield while the agent starts or compacts, and
      beside the conversation its checklists, search, Agent Profile and Transcript.
      What acts on the agent is js/cellAgent.js. -->
 <div ref="root" class="split-conversation" @keydown.esc="onEscape" :class="{'with-terminal':terminal&&wide,'terminal-only':terminal&&!wide,'side-cover':!!sidePanel&&narrow}" :style="terminal&&wide?{'--terminal-share':(share*100).toFixed(2)+'%'}:null">
  <div class="split-chat" :style="{'--conversation-composer-height':composerHeight+'px'}" @dragover.prevent @drop.prevent="!locked&&dropFiles($event)" @paste="!locked&&pasteFiles($event)">
  <div ref="scroller" class="split-scroll" :inert="locked" @scroll.passive="onScroll"><div ref="content">
   <p v-if="failed" class="split-failed" role="alert">{{failed}}</p>
   <template v-if="detail">
    <f7-block v-if="cellError||operationError" class="split-alert" role="alert">{{operationError||cellError}}</f7-block>
    <f7-block v-if="detail.lastError" class="split-last-error">{{detail.lastError}}<f7-button @click="reconnect">{{ct('重新連線')}}</f7-button></f7-block>
    <f7-block v-for="permission in detail.permissions||[]" :key="permission.request_id" class="split-permission"><p>{{permission.description}}</p><pre>{{permission.input_preview}}</pre><f7-button @click="action('permission',{request_id:permission.request_id,generation:permission.generation,behavior:'allow'})">{{ct('允許這一次')}}</f7-button><f7-button @click="action('permission',{request_id:permission.request_id,generation:permission.generation,behavior:'deny'})">{{ct('拒絕')}}</f7-button></f7-block>
    <MessageList :peer-targets="detail.peerLink?.targets||[]" :messages="detail.messages" :conversation-id="conversationId" :has-older="detail.hasOlder" :older-busy="olderBusy"
     :avatar="detail.avatar||defaultAvatar(detail)" :background-text="backgroundText" :typing="typing" :typing-text="typingText" :typing-note="typingNote"
     :interruptible="canInterrupt" :interrupting="interrupting" :inspectable="sidePanel==='inspector'" :inspect-id="inspectId" :found-id="foundId"
     :empty-text="ct('說明你的目標、背景，或想釐清的問題。')" @load-older="loadOlder" @preview="preview=$event" @interrupt="interrupt" @inspect="inspect"
     @open-peer="$emit('open-peer',$event)" @open-group="$emit('open-group',$event)"/>
    <!-- A menu waiting in the agent's terminal is answered here too, as on the
         conversation page; otherwise the chat would show only the agent at work. -->
    <TerminalPromptCard v-if="detail.terminalPrompt" :key="detail.terminalPrompt.key" :prompt="detail.terminalPrompt" :send="chooseTerminal" :can-open="false"/>
   </template>
   <div v-else-if="!failed" class="split-loading"><f7-preloader/></div>
  </div></div>
  <input ref="fileInput" type="file" multiple hidden @change="pickFiles"/>
  <div ref="composer" class="split-composer" :inert="locked">
   <ChatComposer v-if="detail" :highlights="mention.current.value.map(m=>'@'+m.title)" :editor-id="null" v-model:value="draft" :placeholder="ct('輸入訊息…')" @keydown="composerKeydown">
    <template #inner-start><f7-link icon-only icon-f7="plus" class="split-attach" :aria-label="ct('加入附件')" :class="{disabled:sending}" @click="chooseFiles"/></template>
    <template #before-inner><div v-if="files.length" class="split-drafts" :aria-label="ct('附件')">
     <f7-preloader v-if="sending" :size="18"/>
     <div v-for="file in files" :key="file.key" class="split-draft">
      <a href="#" :title="file.name" @click.prevent="preview={name:file.name,size:file.size,local:file.file}"><span>{{file.name}}</span><small>{{file.size<1024?file.size+' B':(file.size/1024).toFixed(1)+' KB'}}</small></a>
      <button type="button" :disabled="sending" :aria-label="ct('移除附件')+' '+file.name" @click="removeFile(file.key)"><i class="icon f7-icons">xmark_circle_fill</i></button>
     </div>
    </div></template>
    <template #inner-end><f7-link icon-only icon-f7="arrow_up" class="split-send" :class="{disabled:!canSend}" :aria-disabled="!canSend" :aria-label="ct('送出訊息')" @click="send"/></template>
   </ChatComposer>
  </div>
  <SlashMenu v-if="detail&&!locked&&slash.items.value.length" :items="slash.items.value" :active="slash.active.value" @hover="slash.active.value=$event" @pick="slash.complete"/>
  <MentionMenu v-else-if="detail&&!locked&&mention.items.value.length" :items="mention.items.value" :active="mention.active.value" @hover="mention.active.value=$event" @pick="pickMention"/>
  <f7-link v-if="detail&&!atBottom&&!locked" class="split-to-latest" icon-only icon-f7="chevron_down" :aria-label="ct('回到最新')" @click="toLatest"/>
  <!-- The shield covers the conversation only, as on the conversation page: the
       terminal and the side column stay usable while the agent starts or compacts. -->
  <div v-if="detail&&locked" class="split-operation" role="status" aria-live="polite" aria-busy="true">
   <div class="split-operation-card">
    <b>{{operationTitle}}</b>
    <p v-for="step in operationSteps" :key="step">{{step}}</p>
    <div v-if="operationPercent!==null" class="split-operation-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="operationPercent"><div class="track"><div class="fill" :style="{width:operationPercent+'%'}"/></div><span>{{operationPercent}}%</span></div>
    <f7-preloader v-else :size="22"/>
   </div>
  </div>
  </div>
  <!-- The cell's terminal: beside the conversation, half each to start with and a
       divider to share them, in a cell wide enough; instead of it in a narrow one. -->
  <div v-if="terminal&&wide" class="split-cell-divider" role="separator" aria-orientation="vertical" :aria-label="ct('拖曳調整聊天室與終端機寬度')" @pointerdown.stop="startResize"/>
  <div v-if="terminal" class="split-terminal"><TerminalPane :key="detail?.sessionId||conversationId" :conversation-id="conversationId"/></div>
  <!-- One side column at a time, as on the conversation page; over the whole cell in
       a narrow one. -->
  <aside v-if="sidePanel==='checklist'" class="split-side" :aria-label="ct('清單')">
   <header class="pp-head"><f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉清單')" @click="$emit('close-panel')"/><div class="pp-title">{{ct('清單')}}</div><f7-link icon-only icon-f7="plus" class="checklist-new" :aria-label="ct('新增清單')" @click="askNewChecklist(agent.cell)"/></header>
   <div class="pp-body"><ChecklistPanel :key="conversationId"/></div>
  </aside>
  <aside v-else-if="sidePanel==='search'" class="split-side" :aria-label="ct('搜尋這個對話')">
   <header class="pp-head"><f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉搜尋')" @click="$emit('close-panel')"/><div class="pp-title">{{ct('搜尋這個對話')}}</div><span class="pp-spacer"/></header>
   <div class="pp-body">
    <f7-list inset><f7-list-input v-model:value="searchText" type="search" :placeholder="ct('搜尋聊天記錄')" :aria-label="ct('搜尋聊天記錄')" class="message-search-input"/></f7-list>
    <MessageSearchResults :query="searchText" :conversation-id="conversationId" @pick="hit=>jumpTo(hit.messageId)"/>
   </div>
  </aside>
  <aside v-else-if="sidePanel==='profile'" class="split-side" aria-label="Agent Profile">
   <header class="pp-head"><f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉 Agent Profile')" @click="$emit('close-panel')"/><div class="pp-title">Agent Profile</div><f7-link v-if="isAdmin" icon-only icon-f7="floppy_disk" class="profile-save" :class="{disabled:agent.cell.profileSaving.value||!agent.cell.profileDraft.value?.title?.trim()}" :aria-label="ct('保存 Agent Profile')" @click="!agent.cell.profileSaving.value&&agent.cell.profileDraft.value?.title?.trim()&&agent.cell.saveProfile()"/><span v-else class="pp-spacer"/></header>
   <div class="pp-body"><AgentProfilePanel v-if="agent.cell.profileDraft.value" :key="conversationId" @trace-start="$emit('close-panel')"/></div>
  </aside>
  <div v-else-if="sidePanel==='inspector'" class="split-side split-side-inspector">
   <TranscriptInspector :data="inspectData" :busy="inspectBusy" :error="inspectError" :agent="detail" @close="$emit('close-panel')" @back="clearInspection"/>
  </div>
  <AttachmentPreview :file="preview" :conversation-id="conversationId" @close="preview=null" @change="preview=$event"/>
 </div>
</template>
<script setup>
import {ref,computed,watch,nextTick,onMounted,onUnmounted,inject,provide} from 'vue';
import MessageList from './MessageList.vue';
import TerminalPromptCard from './TerminalPromptCard.vue';
import TerminalPane from '../TerminalPane.vue';
import AttachmentPreview from './AttachmentPreview.vue';
import ChatComposer from './ChatComposer.vue';
import SlashMenu from './SlashMenu.vue';
import MentionMenu from './MentionMenu.vue';
import ChecklistPanel,{askNewChecklist} from './ChecklistPanel.vue';
import AgentProfilePanel from './AgentProfilePanel.vue';
import MessageSearchResults from './MessageSearchResults.vue';
import TranscriptInspector from './TranscriptInspector.vue';
import {api} from '../js/api.js';
import {defaultAvatar} from '../js/avatarShape.js';
import {ct} from '../js/agent-i18n.js';
import {shouldSendOnEnter} from '../js/chatKeyboard.js';
import * as status from '../js/conversationStatus.js';
import {useAttachmentDrafts} from '../js/attachmentDrafts.js';
import {useSlashMenu} from '../js/slashMenu.js';
import {useMentionMenu,caretToEnd} from '../js/mentionMenu.js';
import {inSections} from '../js/agentSections.js';
import {listGroups} from '../js/agentPreferences.js';
import {groups as chatGroups} from '../js/groups.js';
import {useCellAgent} from '../js/cellAgent.js';
import {currentUser} from '../js/auth.js';
import {f7} from 'framework7-vue';

const props=defineProps({conversationId:{type:String,required:true},terminal:Boolean,panel:{type:String,default:null}});
const emit=defineEmits(['close-panel','open-terminal','open-peer','open-group','presence']);
const workspace=inject('workspace');
const isAdmin=computed(()=>currentUser.value?.role==='admin');
// Wide enough for the terminal beside the conversation, and each side's share; too
// narrow for a side column beside it.
const root=ref(null),wide=ref(false),narrow=ref(false),SIDE_BY_SIDE=720,SIDE_COLUMN=640,SHARE_KEY='cc-terminal-share-cell';
const share=ref((()=>{try{const n=Number(localStorage.getItem(SHARE_KEY));return Number.isFinite(n)&&n>=.2&&n<=.8?n:.5;}catch{return .5;}})());
let sizeWatch=null,composerWatch=null,scrollerWatch=null;
function startResize(event){
 const handle=event.currentTarget,rect=root.value?.getBoundingClientRect();if(!rect)return;
 event.preventDefault();try{handle.setPointerCapture(event.pointerId);}catch{}
 document.body.classList.add('col-resizing');
 const move=e=>{share.value=Math.min(.8,Math.max(.2,(rect.right-e.clientX)/rect.width));};
 const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);document.body.classList.remove('col-resizing');try{localStorage.setItem(SHARE_KEY,share.value.toFixed(4));}catch{}};
 handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
}
const PAGE=10,WINDOW_MAX=200;
const detail=ref(null),sending=ref(false),interrupting=ref(false),olderBusy=ref(false),failed=ref(''),preview=ref(null);
const scroller=ref(null),content=ref(null),composer=ref(null),composerHeight=ref(64),atBottom=ref(true),foundId=ref(null);
// A draft not yet sent stays with its agent for the tab's life: the cell can be
// given another agent, or the split view left for a while, and come back to it.
const DRAFT_KEY='cc-split-draft:';
const draft=ref((()=>{try{return sessionStorage.getItem(DRAFT_KEY+props.conversationId)||'';}catch{return '';}})());
watch(draft,text=>{try{if(text)sessionStorage.setItem(DRAFT_KEY+props.conversationId,text);else sessionStorage.removeItem(DRAFT_KEY+props.conversationId);}catch{}});
// The conversation page's own drafts: kept per conversation, uploaded when sent.
const attachmentDrafts=useAttachmentDrafts(computed(()=>props.conversationId),ref(null),sending,ct);
const {files,fileInput,pickFiles,dropFiles,pasteFiles,removeFile,chooseFiles}=attachmentDrafts;

// The side column, and the Agent Profile in it, the cell's own.
const inspectorAllowed=computed(()=>isAdmin.value&&detail.value?.mode==='claude');
const sidePanel=computed(()=>props.panel==='inspector'&&!inspectorAllowed.value?null:props.panel);
const profileOpen=computed({get:()=>sidePanel.value==='profile',set:open=>{if(!open&&sidePanel.value==='profile')emit('close-panel');}});
const agent=useCellAgent({workspace,conversationId:computed(()=>props.conversationId),detail,refresh,profileOpen});
provide('workspace',agent.cell);
const {locked,action,operationTitle,operationSteps,operationPercent}=agent;
const cellError=agent.error,operationError=agent.operationError;
// The light by the agent's name above the cell, as in the conversation's navbar.
const presence=computed(()=>{const d=detail.value;if(!d)return 'offline';return agent.activity.value?'working':d.connected?'online':'offline';});
watch(presence,p=>emit('presence',p),{immediate:true});

// A cell has no bar under a navbar, so a turn it did not start (from the terminal,
// say) shows in the typing bubble too, with the button that stops it.
const typing=computed(()=>!locked.value&&(status.awaitingReply(detail.value)||!detail.value?.compacting&&!!status.progressText(detail.value)));
const typingText=computed(()=>typing.value?status.progressText(detail.value):'');
const typingNote=computed(()=>typing.value?status.progressNote(detail.value):'');
const backgroundText=computed(()=>status.backgroundText(detail.value,{locked:locked.value}));
const canSend=computed(()=>!!(draft.value.trim()||files.value.length)&&!sending.value&&!locked.value&&(detail.value?.phase==='ready'||detail.value?.phase==='busy'&&!detail.value?.compacting));
const canInterrupt=computed(()=>detail.value?.mode==='claude'&&detail.value?.phase==='busy'&&!detail.value?.compacting&&!status.settlingAfterReply(detail.value));

function toBottom(){nextTick(()=>{const el=scroller.value;if(el)el.scrollTop=el.scrollHeight;});}
function toLatest(){atBottom.value=true;const el=scroller.value;if(el)el.scrollTo({top:el.scrollHeight,behavior:'smooth'});}
// The newest page, with the older ones already loaded kept in front of it, as the
// conversation page does.
function merge(local,fresh){
 if(!local?.length)return fresh;
 const seam=fresh[0]?local.findIndex(m=>m.id===fresh[0].id):-1;
 return seam<0?fresh:[...local.slice(0,seam),...fresh];
}
let fetching=false,again=false,timer=null,disposed=false,lastFetch=0;
async function refresh(){
 if(disposed)return;
 if(fetching){again=true;return;}
 fetching=true;lastFetch=Date.now();
 try{
  const shown=detail.value?.messages?.length||0;
  const d=await api(`/conversations/${props.conversationId}?limit=${Math.min(WINDOW_MAX,Math.max(PAGE,shown))}${document.hidden?'':'&viewing=1'}`);
  if(disposed)return;
  const merged=merge(detail.value?.messages,d.messages||[]);
  const changed=merged.at(-1)?.id!==detail.value?.messages?.at(-1)?.id||merged.length!==detail.value?.messages?.length;
  const first=!detail.value;
  const next={...d,messages:merged,hasOlder:merged.length>(d.messages||[]).length?(detail.value?.hasOlder??d.hasOlder):d.hasOlder};
  // Same as the main chat: an unchanged answer is not assigned, so the messages are not rendered again.
  if(JSON.stringify(next)!==JSON.stringify(detail.value))detail.value=next;
  failed.value='';
  if(first||changed&&atBottom.value)toBottom();
 }catch(e){failed.value=e.message||ct('無法載入這個 Agent');}
 finally{fetching=false;if(again&&!disposed){again=false;refresh();}}
}
// The Agents list the page keeps up to date anyway (js/agent-chat.js, on the
// server's word that something changed) brings a cell up to date when its agent's
// row there changes; between those, a cell asks only while its agent is at work,
// whose progress line the row does not carry, and once in a while to be safe:
// every cell asking every 1.5 s cost more the more cells were open.
// A quiet cell still tells the server it is on screen, as the conversation page's
// socket does: one in sight counts as read and sends no notification, and the server
// forgets a look after 5 s (agentStore VIEWING_MS). Only the newest message comes back.
const ACTIVE_MS=1500,QUIET_MS=20000,SEEN_MS=4000;let lastSeen=0;
const active=()=>{const d=detail.value;return !d||sending.value||!!agent.activity.value||d.phase!=='ready'&&d.phase!=='stopped'&&d.phase!=='error'||status.awaitingReply(d);};
function tick(){
 if(document.hidden)return;
 const now=Date.now();
 if(now-lastFetch>=(active()?ACTIVE_MS:QUIET_MS))refresh();
 else if(now-Math.max(lastFetch,lastSeen)>=SEEN_MS){lastSeen=now;api(`/conversations/${props.conversationId}?limit=1&viewing=1`).catch(()=>{});}
}
const row=computed(()=>{const c=(workspace.conversations.value||[]).find(x=>x.id===props.conversationId);return c?JSON.stringify(c):'';});
watch(row,(next,prev)=>{if(prev&&next!==prev&&!document.hidden)refresh();});
function onScroll(){
 const el=scroller.value;if(!el)return;
 atBottom.value=el.scrollHeight-el.scrollTop-el.clientHeight<80;
 if(el.scrollTop<300)loadOlder();
}
// Older turns go in above the reader, who stays on the same bubble.
async function loadOlder(){
 const d=detail.value,el=scroller.value;
 if(olderBusy.value||!d?.hasOlder||!d.messages.length||!el)return;
 olderBusy.value=true;
 try{
  const older=await api(`/conversations/${props.conversationId}?limit=${PAGE}&before=${encodeURIComponent(d.messages[0].id)}`);
  if(disposed||detail.value!==d)return;
  const height=el.scrollHeight,top=el.scrollTop;
  const known=new Set(d.messages.map(m=>m.id));
  detail.value={...d,messages:[...(older.messages||[]).filter(m=>!known.has(m.id)),...d.messages],hasOlder:older.hasOlder};
  await nextTick();el.scrollTop=top+(el.scrollHeight-height);
 }catch{}finally{olderBusy.value=false;}
}
// A search result: older pages come in until its message is there, then it is
// brought into view and marked for a moment, as on the conversation page.
async function jumpTo(messageId){
 for(let n=0;n<100&&olderBusy.value;n++)await new Promise(resolve=>setTimeout(resolve,50));
 olderBusy.value=true;atBottom.value=false;
 try{
  for(let n=0;n<50&&detail.value?.hasOlder&&!detail.value.messages.some(m=>m.id===messageId);n++){
   const d=detail.value,first=d.messages[0]?.id;if(!first)break;
   const page=await api(`/conversations/${props.conversationId}?before=${encodeURIComponent(first)}&limit=${WINDOW_MAX}`);
   if(disposed||detail.value!==d)return;
   const known=new Set(d.messages.map(m=>m.id));
   detail.value={...d,messages:[...(page.messages||[]).filter(m=>!known.has(m.id)),...d.messages],hasOlder:page.hasOlder};
  }
  await nextTick();
  const box=scroller.value,el=box?.querySelector(`.message[data-message-id="${CSS.escape(messageId)}"]`);
  if(!box||!el)return;
  box.scrollTop+=el.getBoundingClientRect().top-box.getBoundingClientRect().top-box.clientHeight/3;
  atBottom.value=false;
 }catch(e){f7.dialog.alert(e.message);return;}
 finally{olderBusy.value=false;}
 foundId.value=messageId;
 setTimeout(()=>{if(foundId.value===messageId)foundId.value=null;},2600);
}
const searchText=ref('');
watch(sidePanel,p=>{if(p==='search')nextTick(()=>root.value?.querySelector('.split-side .message-search-input input')?.focus());if(p!=='inspector')clearInspection();});

// "/" offers Claude Code's commands and the agent's skills; "@" the other agents and
// the group chats, for an admin, as on the conversation page.
const caret=()=>caretToEnd(composer.value);
const slash=useSlashMenu({draft,conversationId:computed(()=>props.conversationId),caret});
const mention=useMentionMenu({draft,agents:computed(()=>!isAdmin.value?[]:[...chatGroups.value.map(g=>({id:g.id,title:g.name,group:true,section:ct('群聊')})),...inSections((workspace.conversations.value||[]).filter(c=>c.id!==props.conversationId),listGroups.value).map(c=>({id:c.id,title:c.title,avatar:c.avatar,source:c.source,provider:c.provider,section:c.section})),...(detail.value?.peerLink?.targets||[]).map(t=>({id:'peer:'+t.pairId+':'+t.agentId,title:t.to,avatar:t.icon||undefined,section:ct('另一台電腦')}))])});
function pickMention(item){mention.complete(item,caret);}
function composerKeydown(event){
 if(slash.onKeydown(event,send))return;
 if(mention.onKeydown(event,caret))return;
 if(event.key==='Enter'&&shouldSendOnEnter(event,f7.device)){event.preventDefault();send();}
}
async function send(){
 if(!canSend.value)return;
 const id=props.conversationId,text=draft.value,items=[...files.value];
 // A draft naming one of Claude Code's own commands runs in the agent's terminal,
 // which opens to show what it printed.
 if(!items.length&&isAdmin.value&&detail.value?.mode==='claude'&&await slash.resolveTerminal(text)){
  sending.value=true;
  try{
   await api(`/conversations/${id}/command`,{method:'POST',body:JSON.stringify({command:text.trim()})});
   if(draft.value===text)draft.value='';
   emit('open-terminal');
   await refresh();
  }catch(e){f7.dialog.alert(e.message);}
  finally{sending.value=false;}
  return;
 }
 const requestId=attachmentDrafts.requestId(id,text,items);sending.value=true;
 try{
  const attachmentIds=await attachmentDrafts.upload(id,items);
  await api(`/conversations/${id}/messages`,{method:'POST',body:JSON.stringify({text,requestId,attachmentIds,mentions:mention.current.value.map(m=>m.id)})});
  attachmentDrafts.sent(id,items);
  if(draft.value===text)draft.value='';
  atBottom.value=true;await refresh();toBottom();
 }catch(e){f7.dialog.alert(e.message);}
 finally{sending.value=false;}
}
async function interrupt(){
 if(interrupting.value)return;interrupting.value=true;
 try{await api(`/conversations/${props.conversationId}/interrupt`,{method:'POST',body:'{}'});await refresh();}
 catch(e){f7.dialog.alert(e.message);}
 finally{interrupting.value=false;}
}
async function reconnect(){if(await action('stop'))await action('start');}
// Esc in a cell stops that cell's turn, as on the conversation page; not when a menu
// took it, not in its terminal, which passes Esc to Claude, nor while composing in
// an input method.
function onEscape(event){
 if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.target?.closest?.('.split-terminal, .split-side')||!canInterrupt.value)return;
 event.preventDefault();interrupt();
}
// The Transcript of one bubble, in the side column (admin, as on the conversation page).
const inspectId=ref(''),inspectData=ref(null),inspectBusy=ref(false),inspectError=ref('');let inspectRun=0;
async function inspect(message){
 if(sidePanel.value!=='inspector'||!message||message.role==='system')return;
 if(inspectId.value===message.id)return clearInspection();
 inspectId.value=message.id;inspectError.value='';inspectData.value=null;inspectBusy.value=true;
 const run=++inspectRun;
 try{const d=await api(`/conversations/${props.conversationId}/messages/${encodeURIComponent(message.id)}/transcript`);if(run===inspectRun)inspectData.value=d;}
 catch(e){if(run===inspectRun)inspectError.value=e.message;}
 finally{if(run===inspectRun)inspectBusy.value=false;}
}
function clearInspection(){inspectRun++;inspectId.value='';inspectData.value=null;inspectError.value='';inspectBusy.value=false;}
// A typing bubble coming, changing its line or going keeps a reader at the bottom there.
watch([typing,typingText,typingNote,backgroundText,()=>detail.value?.terminalPrompt?.key,()=>detail.value?.permissions?.length],()=>{if(atBottom.value)toBottom();},{flush:'post'});
async function chooseTerminal(body){try{await api(`/conversations/${props.conversationId}/terminal-choice`,{method:'POST',body:JSON.stringify(body)});}finally{await refresh();}}
onMounted(()=>{
 refresh();timer=setInterval(tick,500);
 sizeWatch=new ResizeObserver(([entry])=>{wide.value=entry.contentRect.width>=SIDE_BY_SIDE;narrow.value=entry.contentRect.width<SIDE_COLUMN;});sizeWatch.observe(root.value);
 composerWatch=new ResizeObserver(([entry])=>{composerHeight.value=Math.round(entry.target.getBoundingClientRect().height);});composerWatch.observe(composer.value);
 // A side column or the terminal opening narrows the conversation and its bubbles
 // wrap taller, or more comes in: a reader at the bottom stays there.
 scrollerWatch=new ResizeObserver(()=>{const el=scroller.value;if(atBottom.value&&el)el.scrollTop=el.scrollHeight;});scrollerWatch.observe(scroller.value);scrollerWatch.observe(content.value);
});
onUnmounted(()=>{disposed=true;agent.dispose();clearInterval(timer);sizeWatch?.disconnect();composerWatch?.disconnect();scrollerWatch?.disconnect();});
</script>

<style scoped>
.split-conversation {position:relative;flex:1;min-height:0;display:flex;}
.split-chat {position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;}
.split-terminal {min-width:0;min-height:0;display:flex;flex-direction:column;background:#121212;}
.split-terminal :deep(.terminal-pane) {flex:1;min-height:0;}
.with-terminal .split-terminal {flex:0 0 var(--terminal-share,50%);border-left:1px solid color-mix(in srgb,currentColor 14%,transparent);}
.terminal-only .split-chat {display:none;}
.terminal-only .split-terminal {flex:1;}
.split-cell-divider {position:absolute;top:0;bottom:0;right:calc(var(--terminal-share,50%) - 6px);width:12px;z-index:30;cursor:col-resize;touch-action:none;}
.split-scroll {flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;overflow-anchor:none;padding:6px 0 10px;}
.split-scroll :deep(.messages) {min-height:0;}
.split-loading {display:flex;justify-content:center;padding:32px 0;}
.split-failed {margin:16px;color:var(--cc-color-text-secondary);}
.split-alert {color:var(--cc-color-text-secondary);}
.split-permission pre {white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;}
/* The conversation page's composer, in the cell's flow rather than over a page. */
.split-composer {flex:0 0 auto;}
.split-composer :deep(.toolbar.messagebar) {position:relative;left:auto;right:auto;bottom:auto;top:auto;height:auto;width:auto;z-index:auto;background:none;--f7-messagebar-textarea-bg-color:var(--f7-message-received-bg-color);}
.split-composer :deep(.toolbar.messagebar)::before,.split-composer :deep(.toolbar.messagebar)::after {display:none;}
.split-composer :deep(.toolbar.messagebar > .toolbar-inner.composer-pill) {position:relative;margin:0 10px 10px;}
.split-composer :deep(.chat-editor) {max-height:140px;}
/* On one row the text starts right after the ＋, as on the conversation page, whose
   rule (ChatComposer.vue) is for a .chat-page and so missed the cell. */
.split-composer :deep(.toolbar.messagebar > .toolbar-inner.composer-pill:not(.composer-tall)) {column-gap:4px;}
.split-composer :deep(.toolbar-inner.composer-pill:not(.composer-tall) > .composer-start:not(.composer-empty) + .messagebar-area .chat-editor) {padding-left:2px;}
.split-drafts {display:flex;align-items:center;gap:8px;overflow-x:auto;padding:8px 10px;}
.split-draft {display:flex;align-items:center;gap:6px;flex:0 0 auto;max-width:220px;border-radius:var(--cc-radius-card,16px);padding:6px 6px 6px 10px;background:var(--cc-glass-fill-subtle);color:var(--cc-color-text);font-size:13px;}
.split-draft a {flex:1 1 auto;min-width:0;display:flex;flex-direction:column;color:inherit;text-decoration:none;}
.split-draft span {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.split-draft small {color:var(--cc-color-text-secondary);}
.split-draft button {flex:0 0 auto;display:flex;width:auto;border:0;padding:0;background:none;color:var(--cc-color-text-secondary);cursor:pointer;}
.split-draft button .icon {font-size:18px;}
.split-chat :deep(.slash-menu) {--slash-bottom:calc(var(--conversation-composer-height,64px) + 4px);left:10px;right:10px;max-height:min(52vh,420px,calc(100% - var(--slash-bottom) - 8px));}
.split-to-latest {position:absolute;right:14px;bottom:calc(var(--conversation-composer-height,64px) + 10px);z-index:20;width:36px;height:36px;border-radius:18px;background:var(--f7-list-bg-color,rgba(40,40,40,.92));box-shadow:0 2px 10px rgba(0,0,0,.28);justify-content:center;}
.split-operation {position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:var(--f7-dialog-backdrop-bg-color,rgba(0,0,0,.4));}
.split-operation-card {display:flex;flex-direction:column;align-items:center;gap:6px;max-width:100%;padding:16px 20px;border-radius:14px;background:var(--f7-dialog-bg-color,#1c1c1e);color:var(--cc-color-text);text-align:center;}
.split-operation-card p {margin:0;align-self:stretch;text-align:left;font-size:14px;}
.split-operation-progress {display:flex;align-items:center;gap:10px;align-self:stretch;min-width:180px;font-size:13px;font-variant-numeric:tabular-nums;}
.split-operation-progress .track {flex:1;height:6px;border-radius:3px;background:color-mix(in srgb,currentColor 18%,transparent);overflow:hidden;}
.split-operation-progress .fill {height:100%;border-radius:3px;background:#34c759;transition:width .6s ease;}
/* The side column: beside the conversation, or over the whole cell in a narrow one. */
.split-side {flex:0 0 min(440px,50%);min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--f7-page-bg-color);border-left:1px solid color-mix(in srgb,currentColor 14%,transparent);}
.side-cover .split-side {position:absolute;inset:0;z-index:50;border-left:0;}
.split-side .pp-head {flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent);}
.split-side .pp-title {flex:1;min-width:0;text-align:center;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.split-side .pp-head .link {flex:0 0 auto;width:32px;height:32px;justify-content:center;}
.split-side .pp-head .profile-save.disabled {opacity:.4;pointer-events:none;}
.split-side .pp-spacer {flex:0 0 32px;}
.split-side .pp-body {flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-bottom:24px;}
.split-side-inspector :deep(.transcript-inspector) {position:relative;top:auto;right:auto;bottom:auto;width:auto;flex:1;min-height:0;border-left:0;}
</style>
