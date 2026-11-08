<template>
 <f7-page @page:afterin="onChatsIn" name="chats" class="page-large-static">
  <f7-navbar large class="navbar-transparent no-hairline navbar-glass-blur"><f7-nav-left><f7-link :disabled="orderBusy" :aria-label="ct('編輯 Agent 清單')" @click="toggleEdit">{{editMode?'Done':'Edit'}}</f7-link><template v-if="editMode&&user?.role==='admin'"><f7-link icon-only icon-f7="pause_circle" class="bulk-agents" :class="{disabled:!!bulkBusy}" :aria-label="ct(chosenList.length?'暫停選取的 Agent':'全部暫停')" :title="ct(chosenList.length?'暫停選取的 Agent':'全部暫停')" @click="!bulkBusy&&pauseEveryAgent()"/><f7-link icon-only icon-f7="play_circle" class="bulk-agents" :class="{disabled:!!bulkBusy}" :aria-label="ct(chosenList.length?'啟動選取的 Agent':'全部啟動')" :title="ct(chosenList.length?'啟動選取的 Agent':'全部啟動')" @click="!bulkBusy&&startEveryAgent()"/><f7-link icon-only icon-f7="arrow_clockwise_circle" class="bulk-agents" :class="{disabled:!!bulkBusy}" :aria-label="ct(chosenList.length?'重啟選取的 Agent':'全部重啟')" :title="ct(chosenList.length?'重啟選取的 Agent':'全部重啟')" @click="!bulkBusy&&restartEveryAgent()"/><span v-if="chosenList.length" class="bulk-count" role="status">{{ct('已選')}} {{chosenList.length}}</span></template></f7-nav-left><f7-nav-title sliding>Agents</f7-nav-title><f7-nav-right><f7-link v-if="user?.role==='admin'&&wideScreen" icon-only icon-f7="square_grid_2x2" class="split-open external" href="/?split=1" :aria-label="ct('分割畫面')"/><f7-link v-if="user?.role==='admin'" icon-only icon-f7="trash" class="deleted-open" :aria-label="ct('已刪除的 Agent')" :title="ct('已刪除的 Agent')" @click="openDeleted"/><f7-link v-if="user?.role==='admin'" icon-only icon-f7="plus" :aria-label="ct('新增 agent')" @click="openNewChat"/></f7-nav-right><f7-nav-title-large>Agents</f7-nav-title-large></f7-navbar>
  <!-- The search row: the search pill, and
       beside it a round source button. Each source is one way of starting agents,
       with its own list; nothing mixes them. -->
  <div class="agent-search-row">
   <f7-searchbar class="agent-search" :inline="true" :disable-button="false" :clear-button="true" :placeholder="ct('搜尋 Agent 或聊天記錄')" :value="search" @input="search=$event.target.value" @searchbar:clear="search=''"/>
   <a class="link agent-source" href="#" role="button" :aria-label="ct('Agent 來源')+'：'+sourceLabel" :title="sourceLabel" @click.prevent="openSources($event)"><img v-if="sourceIcon" :src="sourceIcon" alt="" width="42" height="42"/><i v-else class="icon f7-icons">ellipsis_circle</i></a>
  </div>
  <GlassDropdown :open="sourcesOpen" :point="sourcesPoint" :items="listSources" :selected="listSource" @close="sourcesOpen=false" @select="chooseSource"/>
  <f7-block v-if="error" role="alert">{{error}}</f7-block>
  <!-- New group sits at the right of Select all, in reach as Edit opens; a member, who has no Select all, sees it alone. -->
  <div v-if="editMode&&(user?.role==='admin'&&filtered.length||!search&&!mixedList)" class="select-all-row">
   <template v-if="user?.role==='admin'&&filtered.length">
    <f7-button class="agent-select" :icon-f7="allChosen?'checkmark_circle_fill':'circle'" role="checkbox" :aria-checked="String(allChosen)" :aria-label="ct('全選')" @click="toggleAllChosen"/>
    <span class="select-all-label" @click="toggleAllChosen">{{allChosen?ct('取消全選'):ct('全選')}}</span>
    <button type="button" class="presence-choose" :class="{active:chosenByPresence(true)}" data-presence="online" @click="chooseByPresence(true)"><span class="tag-dot online"></span>{{ct('在線')}}</button>
    <button type="button" class="presence-choose" :class="{active:chosenByPresence(false)}" data-presence="offline" @click="chooseByPresence(false)"><span class="tag-dot"></span>{{ct('未上線')}}</button>
   </template>
   <span v-if="!search&&!mixedList" class="agent-group-add"><f7-button small round tonal icon-f7="folder_badge_plus" @click="addGroup">{{ct('新增群組')}}</f7-button></span>
  </div>
  <!-- Groups, titled like the sections of Settings.
       In All, dragging stays within each source (src/js/sourceFence.js); New group
       is left to a source's own list, which says whose group it is. Recent keeps
       its activity order and has no dragging.
       One sortable list with each group's title as a row in it, so an agent can be
       dragged past a title into that group, or into an empty one. -->
  <f7-list inset media-list sortable :class="{editing:editMode}" :sortable-enabled="editMode&&!search&&!orderBusy&&listSource!=='recent'&&(!autoSort||listGroups.length>0)" :sortable-move-elements="false" @sortable:sort="reorderChats" class="conversation-list">
   <template v-for="row in listRows" :key="row.kind+':'+row.id">
    <!-- In All, each source's part of the list opens with its logo and name. -->
    <li v-if="row.kind==='source'" class="agent-source-title" :data-source="row.id"><img v-if="row.icon" :src="row.icon" alt="" width="20" height="20"/><span>{{row.name}}</span></li>
    <li v-else-if="row.kind==='group'" class="agent-group-row" :class="{'agent-group-block':editMode,'in-source':listSource==='all'}" :data-group="row.id">
     <div class="agent-group-title">
      <span v-if="editMode&&user?.role==='admin'&&row.empty" class="agent-select-spacer" aria-hidden="true"></span>
      <f7-button v-if="editMode&&user?.role==='admin'&&!row.empty" class="agent-select" :icon-f7="groupChosen(row)?'checkmark_circle_fill':'circle'" role="checkbox" :aria-checked="String(groupChosen(row))" :aria-label="ct('選取')+' '+row.name" @click.stop="toggleGroupChosen(row)"/>
      <f7-button v-if="editMode" class="agent-delete agent-group-delete" color="red" icon-f7="minus_circle_fill" :aria-label="ct('刪除群組')+' '+row.name" @click.stop="deleteGroup(row)"/>
      <input v-if="editMode&&editingGroup===row.id" v-focus class="agent-group-name-input" :value="row.name" maxlength="40" :aria-label="ct('群組名稱')" @keydown.enter.prevent="$event.target.blur()" @keydown.esc.prevent="cancelGroupRename" @blur="finishGroupRename(row,$event.target.value)"/>
      <span v-else-if="editMode" class="agent-group-name" role="button" tabindex="0" :title="ct('點一下改名')" @click="startGroupRename(row)" @keydown.enter="startGroupRename(row)">{{row.name}}</span>
      <!-- Outside Edit, a tap on the title folds the group or opens it again; folded,
           it says how many agents it holds, and spins while one of them works. -->
      <button v-else type="button" class="agent-group-fold" :aria-expanded="String(!row.collapsed)" :aria-label="ct(row.collapsed?'展開群組':'收合群組')+' '+row.name" @click="toggleGroupCollapse(row.id)">
       <span class="agent-group-name">{{row.name}}</span>
       <span v-if="row.collapsed" class="agent-group-count">{{row.members.length}}</span>
       <i class="icon f7-icons agent-group-chevron" :class="{collapsed:row.collapsed}" aria-hidden="true">chevron_down</i>
      </button>
     </div>
     <!-- Folded, its agents' names as small tags:
          one working spins, and a tap opens that agent. -->
     <div v-if="row.collapsed&&!editMode" class="agent-group-tags">
      <button v-for="a in row.members" :key="a.id" type="button" class="agent-group-tag" :class="{thinking:thinking(a)}" :data-id="a.id" @click="select(a.id)"><f7-preloader v-if="thinking(a)" class="agent-group-busy" :size="10"/><span v-else class="tag-dot" :class="{online:a.connected&&!activity(a),working:!!activity(a)}" role="img" :aria-label="ct(presenceLabel(a))" :title="ct(presenceLabel(a))"></span>{{a.title}}</button>
     </div>
     <div v-if="editMode&&listSource!=='recent'" class="sortable-handler agent-group-handle" :aria-label="ct('拖曳整個群組')" @touchstart.stop @mousedown.stop @pointerdown.stop="startGroupDrag($event,moveGroups)"/>
    </li>
    <li v-else-if="row.kind==='slot'" class="agent-group-slot in-group group-end" :data-group="row.group"><p class="agent-group-empty">{{ct('把 Agent 拖到這裡')}}</p></li>
   <f7-list-item v-else :swipeout="!editMode" :class="{'row-opening':openingId===row.agent.id,'in-source':listSource==='all','disallow-sorting':autoSort,'in-group':editMode&&!!row.group,'group-end':editMode&&!!row.group&&row.last,'waiting-choice':!!waitingChoice(row.agent)}" :data-id="row.agent.id" :link="editMode?false:'#'" :title="editMode&&user?.role==='admin'?undefined:row.agent.title" :text="waitingChoice(row.agent)||row.agent.preview||ct('尚無對話')" :badge="editMode?null:unreadLabel(unreadOf(row.agent))" badge-color="red" @click.prevent="!editMode&&!justSwiped($event)&&select(row.agent.id)" @swipeout="swiped" @contextmenu.prevent="user?.role==='admin'&&conversationMenu(row.agent,$event)" @keydown.shift.f10.prevent="user?.role==='admin'&&conversationMenu(row.agent,$event)">
    <!-- Agents are an admin's to create, rename and delete; a member only reorders. -->
    <template v-if="editMode&&user?.role==='admin'" #content-start><f7-button class="agent-select" :icon-f7="isChosen(row.agent.id)?'checkmark_circle_fill':'circle'" role="checkbox" :aria-checked="String(isChosen(row.agent.id))" :aria-label="ct('選取')+' '+row.agent.title" @click.stop="toggleChosen(row.agent.id)"/><f7-button class="agent-delete" color="red" icon-f7="minus_circle_fill" :aria-label="ct('刪除')+' '+row.agent.title" @click.stop="deleteConversation(row.agent)"/></template>
    <template #media><div class="agent-avatar"><img v-if="row.agent.avatar" :src="row.agent.avatar" :class="'agent-avatar-'+avatarShape(row.agent.avatar)" alt="" width="45" height="45"/><img v-else :src="defaultAvatar(row.agent)" class="agent-avatar-icon" alt=""/><span class="presence-dot" :class="{online:row.agent.connected&&!activity(row.agent),working:!!activity(row.agent),thinking:thinking(row.agent)}" role="img" :aria-label="ct(presenceLabel(row.agent))" :title="ct(presenceLabel(row.agent))"><f7-preloader v-if="thinking(row.agent)" :size="14"/></span></div></template>
    <!-- Swiped left outside Edit mode, a row offers round buttons: pause or start,
         whichever its state calls for, and, for an admin, delete. -->
    <f7-swipeout-actions v-if="!editMode" right class="agent-swipe">
     <f7-swipeout-button v-if="isStopped(row.agent)" close class="swipe-round start" :aria-label="ct('啟動')+' '+row.agent.title" @click="swipeStart($event,row.agent)"><span class="swipe-circle"><i class="icon f7-icons">play_fill</i></span></f7-swipeout-button>
     <f7-swipeout-button v-else close class="swipe-round pause" :aria-label="ct('暫停')+' '+row.agent.title" @click="swipePause($event,row.agent)"><span class="swipe-circle"><i class="icon f7-icons">pause_fill</i></span></f7-swipeout-button>
     <f7-swipeout-button v-if="user?.role==='admin'" close class="swipe-round delete" :aria-label="ct('刪除')+' '+row.agent.title" @click="swipeDelete($event,row.agent)"><span class="swipe-circle"><i class="icon f7-icons">trash_fill</i></span></f7-swipeout-button>
    </f7-swipeout-actions>
    <template v-if="editMode&&user?.role==='admin'" #title><f7-link class="agent-rename" :aria-label="ct('重新命名')+' '+row.agent.title" @click.stop="renameConversation(row.agent)">{{row.agent.title}}</f7-link></template>
   </f7-list-item>
   </template>
  </f7-list>
  <f7-block v-if="!filtered.length">{{search?ct('沒有符合的 Agent'):user?.role==='admin'?ct('從一個新的想法開始。'):ct('還沒有 Agent。Agent 由管理員建立，請聯絡 CC Agent 管理員。')}}</f7-block>
  <!-- The same words in every agent's chat, below the agents they name; a tap opens that conversation at the message. -->
  <MessageSearchResults v-if="!editMode" :query="search" show-title heading @pick="h=>showMessage(h.conversationId,h.messageId)"/>
 </f7-page>

</template>
<script>
import {inject,ref,computed} from "vue";import GlassDropdown from "../components/GlassDropdown.vue";import {f7} from "framework7-vue";import TerminalPane from "../TerminalPane.vue";import MessageSearchResults from "../components/MessageSearchResults.vue";import {startGroupDrag} from "../js/groupDrag.js";import {fenceSourceDrag} from "../js/sourceFence.js";import {avatarShape,defaultAvatar} from "../js/avatarShape.js";export default {components:{TerminalPane,MessageSearchResults,GlassDropdown},mounted(){for(const name of ['pointerdown','touchstart','mousedown'])this.$el.addEventListener(name,fenceSourceDrag,{capture:true,passive:true});},beforeUnmount(){for(const name of ['pointerdown','touchstart','mousedown'])this.$el.removeEventListener(name,fenceSourceDrag,{capture:true});},directives:{focus:{mounted:el=>{el.focus();el.select?.();}}},setup(){const w=inject("workspace");
 // While an agent is answering, its light turns into a small spinner, on this list
 // only: the conversation has its typing bubble.
 // Work left running in the background (a subagent, a command) spins too, after
 // the turn that started it has ended.
 const thinking=c=>!!c.connected&&(c.phase==='busy'||c.background>0)&&!w.activity(c);
 const presenceLabel=c=>w.activity(c)?'Agent 正在處理':thinking(c)?(c.phase==='busy'?'Agent 思考中':'Agent 背景工作中'):c.connected?'Agent 在線':'Agent 離線';
 // Deleted agents, restored or kept from their own page.
 const openDeleted=()=>f7.views.get('#view-chat')?.router.navigate('/deleted-agents/');
 // A swipe's buttons act on that row's agent and keep the tap from opening it.
 const isStopped=c=>['stopped','error'].includes(c.phase);
 // A mouse swipe ends in a click on the row it dragged; that click, or a tap on a
 // row whose buttons are showing, does not open the agent (a finger swipe makes
 // no click, but the rule holds for both).
 let lastSwipe=0;
 const swiped=()=>{lastSwipe=Date.now();};
 const justSwiped=e=>Date.now()-lastSwipe<400||!!e?.currentTarget?.classList?.contains('swipeout-opened');
 const quiet=e=>{e?.stopPropagation?.();e?.preventDefault?.();};
 const swipePause=(e,c)=>{quiet(e);w.pauseAgent(c);};
 const swipeStart=(e,c)=>{quiet(e);w.startAgent(c);};
 const swipeDelete=(e,c)=>{quiet(e);w.deleteConversation(c);};
 const sourcesOpen=ref(false),sourcesPoint=ref({clientX:0,clientY:0});
 const openSources=e=>{sourcesPoint.value={clientX:e?.clientX??0,clientY:e?.clientY??0};sourcesOpen.value=!sourcesOpen.value;};
 const current=computed(()=>w.listSources.value.find(s=>s.value===w.listSource.value));
 const sourceIcon=computed(()=>current.value?.icon||null),sourceLabel=computed(()=>current.value?.label||'');
 // A menu waiting in the agent's terminal reads in its row in place of the last
 // message, so the list says who waits on the owner.
 // Only an admin answers such menus (ConversationPage's TerminalPromptCard).
 const waitingChoice=c=>{const p=c.terminalPrompt;if(!p||w.user.value?.role!=='admin')return '';const what=(p.title||'').replace(/^[☐☒✔\s]+/,'').trim()||p.body?.split('\n')[0]?.trim()||p.options?.[0]?.label||'';return w.ct('終端機在等你選擇')+(what?'：'+what:'');};
 return {...w,waitingChoice,sourcesOpen,sourcesPoint,openSources,sourceIcon,sourceLabel,thinking,presenceLabel,startGroupDrag,avatarShape,defaultAvatar,openDeleted,isStopped,swipePause,swipeStart,swipeDelete,swiped,justSwiped};}};
</script>

<style scoped>
.agent-search-row {display:flex;align-items:center;gap:16px;padding:0 var(--f7-list-inset-side-margin,16px);margin:var(--f7-list-margin-vertical,32px) 0;}
.agent-search {flex:1;}
/* On a computer the row takes the list's own column, as the inset lists do in skin.css. */
@media (min-width:1024px){.agent-search-row{max-width:min(828px,calc(100% - 32px));margin-left:auto;margin-right:auto;padding:0;}}
.agent-source {flex-shrink:0;width:42px;height:42px;}
.agent-source img {width:42px;height:42px;border-radius:100px;display:block;}
.agent-source .icon {font-size:42px;}
.conversation-list :deep(.item-text) {display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;white-space:normal;overflow:hidden;overflow-wrap:anywhere;text-overflow:ellipsis;margin-right:calc(var(--f7-list-chevron-icon-area,20px) + 8px);height:auto;max-height:calc(2 * var(--f7-list-item-text-line-height,21px));}
.agent-delete {flex-shrink:0;width:32px;min-width:32px;padding:0;margin-right:8px;}
/* Ticking agents for the pause and start buttons. */
.agent-select {flex-shrink:0;width:28px;min-width:28px;padding:0;margin-right:4px;color:var(--cc-color-text-secondary);}
.agent-select[aria-checked="true"] {color:#34c759;}
/* In the list's column, its circle under the rows' circles: the list is 828px wide
   and centred on a desktop, 16px in from each side on a phone. */
.select-all-row {display:flex;align-items:center;gap:6px;margin:0 max(var(--f7-list-inset-side-margin,16px),calc((100% - 828px) / 2)) -8px;padding:4px 16px 4px 26px;font-size:14px;color:var(--cc-color-text-secondary);}
.select-all-label {cursor:pointer;user-select:none;white-space:nowrap;}
.presence-choose {display:inline-flex;width:auto;align-items:center;gap:5px;flex:0 0 auto;margin-left:4px;padding:4px 10px;border:1px solid transparent;border-radius:999px;background:rgba(120,120,128,.16);color:inherit;font:inherit;font-size:13px;white-space:nowrap;cursor:pointer;}
.presence-choose.active {border-color:#34c759;background:rgba(52,199,89,.18);color:var(--f7-text-color, inherit);}
/* A mouse swipes a row too: the row is a link, and the browser's own dragging of
   a link took the gesture over and the row never opened. */
.conversation-list :deep(a.item-link) {-webkit-user-drag:none;user-select:none;}
/* The swipe's buttons as round icons on the row's own card, not coloured slabs. */
.conversation-list :deep(.swipeout-actions-right) {display:flex;align-items:center;gap:10px;padding:0 14px 0 6px;background:transparent;}
.conversation-list :deep(.swipeout-actions-right > a.swipe-round) {background:transparent;padding:0;min-width:0;width:auto;height:auto;}
.swipe-circle {display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:22px;color:#fff;}
.swipe-circle .icon {font-size:19px;}
.pause .swipe-circle {background:#ff9f0a;}
.start .swipe-circle {background:#34c759;}
.delete .swipe-circle {background:#ff3b30;}
.bulk-count {align-self:center;margin-left:4px;padding:2px 8px;border-radius:10px;font-size:12px;white-space:nowrap;background:color-mix(in srgb,currentColor 14%,transparent);}
.agent-rename {color:inherit;font:inherit;}
.agent-avatar {
  position: relative;
  width: 45px;
  height: 45px;
  border-radius: 38%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--cc-surface-card);
  box-shadow:
    var(--cc-glass-ring) 2px 2px 2px -2px inset,
    var(--cc-glass-ring) -2px -2px 2px -2px inset;
}
/* A group's title is a row of the list, so an agent can be dragged past it. It
   drops the card look and reads like the block titles of Settings. */
.list.conversation-list > ul > li.agent-group-row {background:transparent;border-radius:0;overflow:visible;margin:28px 0 8px;padding:0 16px;}
/* Every agent is its own rounded card. A row that swipes is a Framework7 swipeout,
   whose inset-list rule rounds only the list's first row at the top and its last
   at the bottom: a lone agent above a group lost its lower corners. */
.list.conversation-list > ul > li.swipeout {border-radius:var(--cc-radius-card);}
.list.conversation-list > ul > li.agent-group-row:first-child {margin-top:0;}
.agent-group-title {display:flex;align-items:center;gap:0;min-height:28px;font-size:var(--f7-block-title-font-size,16px);font-weight:600;color:var(--f7-block-title-text-color);}
.agent-group-name {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.agent-group-fold {display:flex;align-items:center;gap:8px;flex:1;min-width:0;width:auto;margin:0;padding:0;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;}
.agent-group-count {flex:0 0 auto;font-size:13px;font-weight:500;color:var(--cc-color-text-secondary);}
.agent-group-busy {flex:0 0 auto;--f7-preloader-color:#34c759;}
.agent-group-tags {display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.agent-group-tag {display:inline-flex;align-items:center;gap:5px;width:auto;max-width:100%;margin:0;padding:3px 10px;border:0;border-radius:11px;background:color-mix(in srgb,currentColor 12%,transparent);color:var(--cc-color-text-secondary);font:inherit;font-size:12px;font-weight:500;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;}
/* The tapped agent while its conversation loads: the tap took, it is on its way
   (a slow load read as a tap that did nothing). */
.conversation-list :deep(li.waiting-choice .item-text) {color:#ff9f0a;}
.conversation-list :deep(li.row-opening .item-link) {opacity:.7;}
.conversation-list :deep(li.row-opening .item-inner::before) {visibility:hidden;}
.conversation-list :deep(li.row-opening .item-inner::after) {content:'';position:absolute;right:14px;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;opacity:.6;animation:row-opening .8s linear infinite;}
@keyframes row-opening {to {transform:rotate(360deg);}}
.tag-dot {flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:#8e8e93;}
.tag-dot.online {background:#34c759;}
.tag-dot.working {background:#ff9500;}
.agent-group-tag.thinking {color:#34c759;background:rgba(52,199,89,.14);}
.agent-group-chevron {flex:0 0 auto;margin-left:auto;font-size:14px;color:var(--cc-color-text-secondary);transition:transform .2s ease;}
.agent-group-chevron.collapsed {transform:rotate(-90deg);}
.agent-group-empty {margin:0;font-size:13px;line-height:1.4;color:var(--cc-color-text-secondary);}
/* An empty group's slot: the size of an agent's row, so a drop on it lands inside. */
.list.conversation-list > ul > li.agent-group-slot {display:flex;align-items:center;justify-content:center;min-height:64px;margin-bottom:10px;border:1px dashed color-mix(in srgb,currentColor 18%,transparent);border-radius:16px;box-sizing:border-box;background:none;}
/* Editing, a dashed line goes round each whole group, its title and its agents,
   with delete at the left of the title, its name to tap and edit, and the handle
   at the right that drags the group. The rows
   are one list, so each draws its own stretch of the line behind its card. */
.list.conversation-list > ul > li.agent-group-row.agent-group-block {margin:24px 10px 10px;padding:8px 54px 8px 16px;overflow:visible;}
/* Edit mode lines every row's controls up in the same three columns, the tick,
   the delete button and the drag handle: every
   agent's card sits 10px in, as a grouped one does inside its frame; a group's
   title starts its controls where the cards start theirs, and an empty group,
   which has nothing to tick, keeps the tick's place. */
.list.conversation-list.editing > ul > li:not(.agent-group-row):not(.in-group):not(.agent-group-slot) {margin-left:10px;margin-right:10px;}
.agent-select-spacer {flex:0 0 auto;width:28px;margin-right:4px;}
.list.conversation-list > ul > li.in-group {margin-left:10px;margin-right:10px;overflow:visible;}
.list.conversation-list > ul > li.agent-group-block::before,
.list.conversation-list > ul > li.in-group::before {content:'';position:absolute;z-index:-1;pointer-events:none;left:-10px;right:-10px;top:0;bottom:-10px;
  border:1px dashed color-mix(in srgb,currentColor 30%,transparent);border-top:0;border-bottom:0;background:color-mix(in srgb,currentColor 4%,transparent);}
.list.conversation-list > ul > li.agent-group-block::before {top:-2px;border-top:1px dashed color-mix(in srgb,currentColor 30%,transparent);border-radius:20px 20px 0 0;}
.list.conversation-list > ul > li.group-end::before {border-bottom:1px dashed color-mix(in srgb,currentColor 30%,transparent);border-bottom-left-radius:20px;border-bottom-right-radius:20px;}
.list.conversation-list > ul > li.agent-group-block.group-end::before {border-radius:20px;}
/* An agent picked up to move to another group leaves its stretch of line behind. */
.list.conversation-list > ul > li.sorting::before {display:none;}
.agent-group-block .agent-group-name {cursor:text;}
.agent-group-delete {margin-right:4px;}
.agent-group-name-input {flex:1;min-width:0;font:inherit;color:inherit;background:transparent;border:0;border-bottom:1px solid var(--cc-color-accent,#d97757);padding:2px 0;outline:none;-webkit-user-select:text;user-select:text;}
/* Dragging must not select the text it passes over. */
.conversation-list.sortable-enabled {-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}
.conversation-list .disallow-sorting :deep(.sortable-handler) {display:none;}
/* In All, while an agent or a group is dragged, the other sources' rows dim: it
   cannot be dropped there. Framework7 drops their handles' padding with .no-sorting,
   which would rewrap their text mid-drag, so it is kept. A drop that did not take
   shakes the row once (src/js/sourceFence.js). */
.conversation-list :deep(li.source-fenced) {opacity:.4;transition:opacity .2s ease;}
.list.conversation-list.sortable-enabled :deep(li.source-fenced:not(.disallow-sorting) .item-inner) {padding-right:calc(var(--f7-sortable-handler-width) + var(--f7-safe-area-right));}
.conversation-list :deep(li.drop-refused > *) {animation:drop-refused .4s ease;}
@keyframes drop-refused {20%,60% {transform:translateX(-6px);} 40%,80% {transform:translateX(6px);}}
/* A group dragged as one block: its rows ride together above the others, which
   slide aside to make room. */
.agent-group-handle {touch-action:none;cursor:grab;}
.conversation-list :deep(ul.group-sorting > li) {transition:transform .2s ease;}
.conversation-list :deep(ul.group-sorting > li.group-dragging) {transition:none;z-index:10;position:relative;opacity:.92;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:grabbing;}
.conversation-list :deep(ul.group-sorting > li.agent-group-row.group-dragging) {box-shadow:none;}
.agent-group-add {margin-left:auto;}
.list.conversation-list > ul > li.agent-source-title {display:flex;align-items:center;gap:8px;background:transparent;border-radius:0;overflow:visible;margin:40px 0 14px;padding:0 16px;font-size:13px;font-weight:600;color:var(--cc-color-text-secondary);text-transform:uppercase;letter-spacing:.04em;}
.list.conversation-list > ul > li.agent-source-title:first-child {margin-top:0;}
.list.conversation-list > ul > li.agent-source-title img {border-radius:6px;}
/* In All, a source's agents and groups sit indented under its title. Edit mode keeps its own block layout. */
.list.conversation-list:not(.editing) > ul > li.in-source {margin-left:18px;}
.list.conversation-list > ul > li.agent-source-title + li.agent-group-row {margin-top:22px;}
.agent-group-add :deep(.button) {display:inline-flex;gap:6px;width:auto;padding:0 12px;}
/* A picture chosen in Agent Profile: a photo fills the tile, an icon with a
   transparent background sits in it at the default logo's size (avatarShape.js). */
.agent-avatar-photo {width:100%;height:100%;object-fit:cover;border-radius:inherit;}
.agent-avatar-icon {width:82%;height:82%;object-fit:contain;}
.agent-avatar-unknown {width:82%;height:82%;visibility:hidden;}
.presence-dot {
  position: absolute;
  /* One size for every state: a 14 px light in a 3 px
     ring, 20 px across, the same circle the thinking spinner sits in. */
  right: -3px;
  bottom: -3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #8e8e93; /* grey = offline */
  box-shadow: 0 0 0 3px var(--cc-color-page); /* ring to separate the dot from the list bg */
}
.presence-dot.online {
  background: #34c759; /* green = agent Channel heartbeat and ready */
}
.presence-dot.working {background:#ff9500;}
.presence-dot.thinking {display:flex;align-items:center;justify-content:center;width:20px;height:20px;right:-6px;bottom:-6px;box-shadow:none;background:var(--cc-color-page,#121212);--f7-preloader-color:#34c759;}
</style>
