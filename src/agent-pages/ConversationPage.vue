<template>
 <f7-page  name="conversation" @page:beforeout="cancelOpening" @dragover.prevent @drop.prevent="!agentLocked&&dropFiles($event)" @paste="!agentLocked&&pasteFiles($event)" @page:afterin="enterConversation" class="chat-page" :data-chat="[progressInBar?'has-progress':'','switchless',inspectorVisible?'inspector-open':'',profilePanelVisible?'profile-open':'',inspectorVisible||profilePanelVisible||checklistPanelVisible?'side-open':'',terminalSide?'terminal-side':'',terminalSide&&chatHidden?'terminal-full':''].filter(Boolean).join(' ')" :style="terminalSide?{'--terminal-width':terminalWidthCss}:null" :page-content="false" :with-subnavbar="showSubnavbar">
  <f7-navbar><f7-nav-left><f7-link v-if="!embedded" class="back" icon-only  :aria-label="ct('返回對話清單')" @click="toList"><i class="icon icon-back"/></f7-link></f7-nav-left><f7-nav-title sliding><span class="nav-agent-name">{{detail?.title||'Chat'}}</span><span v-if="detail" class="nav-presence" :class="presence" role="img" :aria-label="ct(presence==='working'?'Agent 正在處理':presence==='online'?'Agent 在線':'Agent 離線')" :title="ct(presence==='working'?'Agent 正在處理':presence==='online'?'Agent 在線':'Agent 離線')"/></f7-nav-title><f7-nav-right><!-- On a phone one button opens the rest as a menu, so a long name still shows; a computer keeps them in a row. -->
<template v-if="!wideScreen&&!embedded&&detail"><f7-link v-if="showTerminalSwitch" icon-only class="view-toggle" :icon-f7="terminalOpen?'bubble_left_bubble_right':'chevron_left_slash_chevron_right'" :aria-label="terminalOpen?ct('回到聊天室'):ct('開啟 Claude 終端機')" :aria-pressed="String(terminalOpen)" @click="terminalOpen=!terminalOpen"/><f7-link icon-only icon-f7="ellipsis" class="conversation-more" :aria-label="ct('更多')" @click="openMore"/></template><template v-else><f7-link v-if="!embedded&&detail" icon-only icon-f7="checkmark_square" class="checklist-open" :class="{'inspector-on':checklistPanelVisible}" :aria-pressed="String(checklistOpen)" :aria-label="ct('清單')" @click="toggleChecklist"/><f7-link v-if="!embedded" icon-only icon-f7="search" class="conversation-search-open" :class="{'inspector-on':searchPanelVisible}" :aria-pressed="String(searchPanelVisible)" :aria-label="ct('搜尋這個對話')" @click="toggleSearch"/><f7-link v-if="showTerminalSwitch" icon-only class="view-toggle" :icon-f7="terminalOpen?'bubble_left_bubble_right':'chevron_left_slash_chevron_right'" :aria-label="terminalOpen?ct('回到聊天室'):ct('開啟 Claude 終端機')" :aria-pressed="String(terminalOpen)" @click="terminalOpen=!terminalOpen"/><f7-link v-if="showInspectorButton&&!embedded" icon-only icon-f7="ant" class="ant-icon" :class="{'inspector-on':inspectorOpen}" :aria-label="ct('Transcript 檢視')" :aria-pressed="String(inspectorOpen)" :disabled="agentLocked" @click="!agentLocked&&toggleInspector()"/><f7-link v-if="!embedded" icon-only icon-f7="info" :aria-label="'Agent Profile'" :class="{'inspector-on':profilePanelVisible}" :aria-pressed="wideScreen&&!terminalOpen?String(profilePanelVisible):undefined" @click="openProfile()"/></template></f7-nav-right><f7-subnavbar v-if="showSubnavbar" class="view-switch" :inert="agentLocked"><div class="subnavbar-stack"><div v-if="progressInBar" class="agent-progress"><f7-preloader :size="14"/><span role="status" aria-live="polite" :title="progressInBar">{{progressInBar}}</span><button v-if="canInterrupt" type="button" class="interrupt-turn" :disabled="interrupting" :aria-label="ct('中斷這一輪')" :title="ct('中斷這一輪')" @click="interruptTurn"><i class="icon f7-icons">stop_fill</i></button></div></div></f7-subnavbar></f7-navbar><GlassDropdown :open="moreOpen" :point="morePoint" :items="moreItems" @close="moreOpen=false" @select="pickMore"/>
  <ChatComposer :highlights="mention.current.value.map(m=>'@'+m.title)" :key="detail?.id" :inert="agentLocked" v-if="detail&&(!terminalOpen||terminalSide&&!chatHidden)" v-model:value="draft" :placeholder="ct('輸入訊息…')" @keydown="composerKeydown"><template #inner-start><f7-link icon-only icon-f7="plus" :aria-label="ct('加入附件')" :class="{disabled:busy}" @click="chooseFiles"/></template><template #before-inner><div v-if="files.length" class="attachment-drafts" :aria-label="ct('附件')"><f7-preloader v-if="busy" :size="20"/><div v-for="file in files" :key="file.key" class="attachment-chip"><a class="attachment-draft-open" href="#" :title="file.name" @click.prevent="previewFile={name:file.name,size:file.size,local:file.file}"><span>{{file.name}} <small>{{file.size<1024?file.size+' B':(file.size/1024).toFixed(1)+' KB'}}</small></span></a><f7-link icon-only icon-f7="xmark_circle_fill" :aria-label="ct('移除附件')+' '+file.name" :class="{disabled:busy}" @click="removeFile(file.key)"/></div></div></template><template #inner-end><f7-link icon-only icon-f7="arrow_up" :class="{disabled:!canSend}" :aria-disabled="!canSend" :aria-label="ct('送出訊息')" @click="send"/></template></ChatComposer>
  <input ref="fileInput" type="file" multiple hidden @change="pickFiles"/>
  <div :inert="agentLocked&&!(terminalOpen&&!terminalSide)" ref="scroll" class="page-content messages-content" @scroll.passive="onMessagesScroll" @wheel.passive="onHistoryWheel" @touchstart.passive="onHistoryTouchStart" @touchmove.passive="onHistoryTouchMove" @touchend.passive="onHistoryTouchEnd" @touchcancel="onHistoryTouchCancel" :class="{'terminal-content':terminalOpen&&!terminalSide&&user?.role==='admin','paging-back':pagingBack}">
   <f7-block v-if="error||agentOperationError" role="alert">{{agentOperationError||error}}</f7-block>
   <template v-if="detail">
    <TerminalPane v-if="terminalOpen&&!terminalSide&&user.role==='admin'" :key="detail.sessionId" :conversation-id="detail.id" :session-id="detail.sessionId"/>
    <template v-else>
     <f7-block v-if="detail.lastError">{{detail.lastError}}<f7-button @click="action('stop').then(()=>action('start'))">{{ct('重新連線')}}</f7-button></f7-block>
     <f7-block v-for="permission in detail.permissions||[]" :key="permission.request_id"><p>{{permission.description}}</p><pre>{{permission.input_preview}}</pre><f7-button @click="action('permission',{request_id:permission.request_id,generation:permission.generation,behavior:'allow'})">{{ct('允許這一次')}}</f7-button><f7-button @click="action('permission',{request_id:permission.request_id,generation:permission.generation,behavior:'deny'})">{{ct('拒絕')}}</f7-button></f7-block>
     <MessageList :peer-targets="detail.peerLink?.targets||[]" :messages="detail.messages" :conversation-id="detail.id" :has-older="detail.hasOlder" :older-busy="olderBusy" :avatar="agentAvatar"
      :inspectable="inspectorVisible" :inspect-id="inspectId" :found-id="foundMessage"
      :empty-text="ct('說明你的目標、背景，或想釐清的問題。')" @load-older="loadOlder()" @inspect="inspect" @preview="previewFile=$event" @open-peer="select($event)" @open-group="openGroup($event)"/>
     <TerminalPromptCard v-if="detail.terminalPrompt&&user?.role==='admin'" :key="detail.terminalPrompt.key" :prompt="detail.terminalPrompt" :send="body=>action('terminal-choice',body)" :can-open="showTerminalSwitch" @open-terminal="terminalOpen=true"/>


    </template>
   </template>
  </div>
  <SlashMenu v-if="detail&&slash.items.value.length&&(!terminalOpen||terminalSide&&!chatHidden)" :items="slash.items.value" :active="slash.active.value" @hover="slash.active.value=$event" @pick="slash.complete"/>
  <MentionMenu v-if="detail&&!slash.items.value.length&&mention.items.value.length&&(!terminalOpen||terminalSide&&!chatHidden)" :items="mention.items.value" :active="mention.active.value" @hover="mention.active.value=$event" @pick="pickMention"/>
  <f7-link v-if="detail&&(!terminalOpen||terminalSide&&!chatHidden)&&!atBottom" class="to-latest" icon-only icon-f7="chevron_down" :aria-label="ct('回到最新')" @click="toLatest()"/>
  <!-- The shield covers the conversation only: the terminal and Agent Profile stay
       open beside it, or instead of it, while the agent is busy compacting or
       starting. -->
  <div v-if="agentLocked&&(!terminalOpen||terminalSide&&!chatHidden)" class="agent-operation-overlay" role="status" aria-live="polite" aria-busy="true">
   <div class="dialog dialog-preloader agent-operation-card"><div class="dialog-inner">
    <div class="dialog-title">{{agentOperationTitle}}</div>
    <div v-if="agentOperationSteps.length" class="dialog-text"><p v-for="step in agentOperationSteps" :key="step">{{step}}</p></div>
    <div v-if="agentOperationPercent!==null" class="operation-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="agentOperationPercent"><div class="operation-progress-track"><div class="operation-progress-fill" :style="{width:agentOperationPercent+'%'}"/></div><span>{{agentOperationPercent}}%</span></div>
    <f7-preloader v-else/>
    <div class="dialog-text">{{ct('可以返回 Agents 清單，其他 Agent 仍可使用。')}}</div>
   </div></div>
  </div>
  <TranscriptInspector v-if="inspectorVisible" :data="inspectData" :busy="inspectBusy" :error="inspectError" :agent="detail" @close="toggleInspector" @back="clearInspection"/>
  <!-- Agent Profile beside the conversation on a desktop width; the popup elsewhere. -->
  <!-- The terminal beside the conversation on a desktop, with a divider to set their
       widths; on a phone it takes the page instead. -->
  <aside v-if="terminalSide&&user?.role==='admin'&&detail" class="terminal-column" :aria-label="ct('Claude 終端機')"><div class="terminal-divider" role="separator" aria-orientation="vertical" :aria-label="ct('拖曳調整聊天室與終端機寬度')" :title="ct('拖曳調整聊天室與終端機寬度')" @pointerdown.stop="startTerminalResize" @mousedown.stop @touchstart.stop/><TerminalPane :key="detail.sessionId" :conversation-id="detail.id" :session-id="detail.sessionId"/></aside>
  <aside v-if="searchPanelVisible" class="profile-panel search-panel" :aria-label="ct('搜尋這個對話')">
   <header class="pp-head"><f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉搜尋')" @click="searchOpen=false"/><div class="pp-title">{{ct('搜尋這個對話')}}</div><span class="pp-spacer"/></header>
   <div class="pp-body">
    <f7-list inset><f7-list-input v-model:value="searchText" type="search" :placeholder="ct('搜尋聊天記錄')" :aria-label="ct('搜尋聊天記錄')" class="message-search-input"/></f7-list>
    <!-- The column stays open on a pick, so the next result is one click away. -->
    <MessageSearchResults :query="searchText" :conversation-id="selected" @pick="hit=>showMessage(hit.conversationId,hit.messageId)"/>
   </div>
  </aside>
  <aside v-if="checklistPanelVisible" class="profile-panel checklist-panel" :aria-label="ct('清單')">
   <header class="pp-head"><f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉清單')" @click="checklistOpen=false"/><div class="pp-title">{{ct('清單')}}</div><f7-link icon-only icon-f7="plus" class="checklist-new" :aria-label="ct('新增清單')" @click="newChecklist"/></header>
   <div class="pp-body"><ChecklistPanel :key="detail.id"/></div>
  </aside>
  <aside v-if="profilePanelVisible" class="profile-panel" aria-label="Agent Profile">
   <!-- Laid out as the popup's navbar: close at the left, the title, save at the right. It stays put; only the fields below scroll. -->
   <header class="pp-head"><f7-link icon-only icon-f7="xmark" :aria-label="ct('關閉 Agent Profile')" @click="profilePanelOpen=false"/><div class="pp-title">Agent Profile</div><f7-link v-if="user?.role==='admin'" icon-only icon-f7="floppy_disk" class="profile-save" :class="{disabled:profileSaving||!profileDraft?.title?.trim()}" :aria-label="ct('保存 Agent Profile')" @click="!profileSaving&&profileDraft?.title?.trim()&&saveProfile()"/><span v-else class="pp-spacer"/></header>
   <div class="pp-body"><AgentProfilePanel :key="detail.id"/></div>
  </aside>
  <!-- Teleported out of the page: this popup carries its own f7-view and f7-page,
       so rendering it here would give #view-chat a second .page-current for the
       whole life of the conversation, and everything that looks up "the current
       page" would then depend on document order. -->
  <Teleport to=".framework7-root">
   <AttachmentPreview :file="previewFile" :conversation-id="detail?.id" @close="previewFile=null" @change="previewFile=$event"/>
  </Teleport>
 </f7-page>

</template>
<script>
import {bindConversationComposer} from "../js/conversationComposer.js";
import {bindKeyboardTrace} from "../js/keyboardDiagnostics.js";
import ChatComposer from "../components/ChatComposer.vue";
import AttachmentPreview from "../components/AttachmentPreview.vue";
import MessageList from "../components/MessageList.vue";
import TranscriptInspector from "../components/TranscriptInspector.vue";
import AgentProfilePanel from "../components/AgentProfilePanel.vue";import MessageSearchResults from "../components/MessageSearchResults.vue";
import SlashMenu from "../components/SlashMenu.vue";
import GlassDropdown from "../components/GlassDropdown.vue";
import MentionMenu from "../components/MentionMenu.vue";
import ChecklistPanel,{askNewChecklist} from "../components/ChecklistPanel.vue";import TerminalPromptCard from "../components/TerminalPromptCard.vue";import {ref,computed,inject,watch,nextTick,Teleport,TransitionGroup,onMounted,onBeforeUnmount} from "vue";import {bindConversationViewport} from "../js/conversationViewport.js";import TerminalPane from "../TerminalPane.vue";export default {components:{GlassDropdown,MentionMenu,TerminalPromptCard,ChecklistPanel,ChatComposer,TerminalPane,TransitionGroup,Teleport,AttachmentPreview,MessageList,TranscriptInspector,AgentProfilePanel,SlashMenu,MessageSearchResults},setup(){const workspace=inject("workspace");let cleanup,cleanupComposer,cleanupTrace,stopOrphanWatch;onMounted(()=>{const page=workspace.scroll.value?.closest(".page");cleanupTrace=bindKeyboardTrace(page);cleanupComposer=bindConversationComposer(page);cleanup=bindConversationViewport(page);// Losing the agent (expired session, aborted open, interrupted back gesture)
// used to leave this page stranded with an empty body and no way forward.
workspace.recoverOrphanedConversation();
stopOrphanWatch=watch(workspace.selected,id=>{if(!id)nextTick(workspace.recoverOrphanedConversation);});});
// Opening or closing the right column narrows or widens the conversation, and the
// bubbles re-wrap to a different height while scrollTop stays put — so the view
// jumped, at the bottom by thousands of pixels. Keep
// what the reader had: the bottom if they were there, else the message at the top.
function readingPosition(){
 const el=workspace.scroll.value;if(!el)return ()=>{};
 // What the reader sees starts below the navbar, which the scroller runs under.
 const visibleTop=()=>el.getBoundingClientRect().top+(parseFloat(getComputedStyle(el).paddingTop)||0);
 const atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<24,top=visibleTop();
 // The first message that starts inside the view is the one being read: one cut
 // off at the top re-wraps to another height and carried everything below it along
 // (opening the terminal beside the conversation).
 const messages=[...el.querySelectorAll('.message')];
 const anchor=messages.find(m=>m.getBoundingClientRect().top>=top)||messages.find(m=>m.getBoundingClientRect().bottom>top);
 const offset=anchor?anchor.getBoundingClientRect().top-top:0;
 return ()=>{if(atBottom)el.scrollTop=el.scrollHeight;else if(anchor?.isConnected)el.scrollTop+=anchor.getBoundingClientRect().top-visibleTop()-offset;};
}
// The terminal's column narrows it the same way, when it opens and at every step of
// the divider. While the terminal has the whole
// width the conversation has no layout to read, so the place taken before that is
// kept until it shows again.
let kept=null;
const stopColumnWatch=watch(()=>[workspace.inspectorVisible.value||workspace.profilePanelVisible.value,workspace.terminalSide.value,workspace.terminalWidthCss.value,workspace.chatHidden.value],(now,before)=>{
 if(!before?.[3])kept=readingPosition();
 if(now[3])return;
 const restore=kept;kept=null;nextTick(restore);
},{flush:'pre'});
onBeforeUnmount(()=>{stopColumnWatch();stopOrphanWatch?.();cleanup?.();cleanupComposer?.();cleanupTrace?.();});// The phone's menu of what the navbar holds on a computer.
const moreOpen=ref(false),morePoint=ref({clientX:0,clientY:0});
const openMore=e=>{const r=e?.currentTarget?.getBoundingClientRect?.();morePoint.value=r?{clientX:r.left+r.width/2,clientY:r.bottom}:{clientX:e?.clientX??0,clientY:e?.clientY??0};moreOpen.value=true;};
const moreItems=computed(()=>[
 {value:'checklist',f7:'checkmark_square',label:workspace.ct('清單')},
 {value:'search',f7:'search',label:workspace.ct('搜尋這個對話')},
 {value:'profile',f7:'info',label:'Agent Profile'},
]);
function pickMore(value){
 if(value==='checklist')workspace.toggleChecklist();
 else if(value==='search')workspace.toggleSearch();
 else if(value==='profile')workspace.openProfile();
}
return {...workspace,previewFile:ref(null),newChecklist:()=>askNewChecklist(workspace),moreOpen,morePoint,openMore,moreItems,pickMore};}};
</script>

<style scoped src="./chatPage.css"></style>
