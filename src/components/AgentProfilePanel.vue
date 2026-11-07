<template>
 <!-- What Agent Profile shows, wherever it is shown: the popup on a phone, the
      right column of the conversation page on a desktop width. One component, so the two never drift apart. -->
 <template v-if="detail">
  <!-- What can be done to the conversation, as icon buttons at the top like the ones
       in a navbar. Start brings up an agent that is
       not running; restart pauses and starts one that is, a turn in progress included. -->
  <div class="profile-actions" role="toolbar" :aria-label="ct('對話操作')">
   <a v-for="b in actionButtons" :key="b.key" href="#" class="profile-action" :class="[b.cls,{disabled:b.off}]" :title="b.label" :aria-label="b.label" :aria-disabled="b.off?'true':null" @click.prevent="!b.off&&b.run()"><f7-icon :f7="b.icon"/><span>{{b.short}}</span></a>
  </div>
  <!-- The agent's own picture, an admin's choice. -->
  <template v-if="user?.role==='admin'">
   <!-- One row: the picture with its two actions as pills on the right, like the
        notification row in Settings. -->
   <f7-list inset class="cc-settings-list agent-picture">
    <f7-list-item><template #media><img class="agent-picture-preview" :class="{'is-icon':avatarShape(detail.avatar||defaultAvatar(detail))==='icon'}" :src="detail.avatar||defaultAvatar(detail)" :alt="ct('Agent 圖像')" width="36" height="36"/></template><template #after>
     <a v-if="detail.avatar" href="#" class="profile-pill agent-picture-reset" :aria-label="ct('還原預設圖像')" @click.prevent="resetAvatar()"><f7-icon f7="arrow_counterclockwise"/><span>{{ct('還原')}}</span></a>
     <a href="#" class="profile-pill agent-picture-upload" :aria-label="ct('上傳圖像')" @click.prevent="avatarInput?.click()"><f7-icon f7="photo"/><span>{{ct('上傳')}}</span></a>
    </template></f7-list-item>
   </f7-list>
   <input ref="avatarInput" class="agent-picture-input" type="file" accept="image/*" hidden @change="chooseAvatar"/>
   <GlassDropdown :open="thresholdOpen" :point="thresholdPoint" :items="thresholdItems" :selected="thresholdSelected" @close="thresholdOpen=false" @select="chooseThreshold"/>
   <GlassDropdown :open="autoCompactOpen" :point="autoCompactPoint" :items="autoCompactItems" :selected="autoCompactSelected" @close="autoCompactOpen=false" @select="chooseAutoCompact"/>
  </template>
  <AgentProfileFields :key="detail.id" v-model="profileDraft" :collapsed="false" :fold-text="true" :admin="user?.role==='admin'" :readonly="user?.role!=='admin'" :show-access="true" @engine-change="engineNote" :allow-full="user?.role==='admin'">
   <!-- This agent's own compact policy, or the one on the Admin tab, above the access scope. Applies at once. -->
   <template v-if="user?.role==='admin'" #before-access><f7-list inset class="cc-settings-list agent-compact">
    <!-- Its subagents' model and effort, or the admin page's; asked before it starts again. -->
    <f7-list-item v-if="detail.subagentsApply" link no-chevron class="agent-subagents" :title="ct('子代理模型與 Effort')" :after="subagentRowLabel" :footer="subagentHint" @click.prevent="editAgentSubagents"></f7-list-item>
    <!-- When its Claude Code compacts, or the admin page's; asked before it starts again (issue #12). -->
    <f7-list-item v-if="detail.autoCompactApply" link no-chevron class="agent-auto-compact" :title="ct('自動壓縮時機')" :after="autoCompactRowLabel" :footer="autoCompactHint" @click.prevent="openAutoCompact($event)"></f7-list-item>
    <f7-list-item link no-chevron :title="ct('Compact 後自動接續')" :after="thresholdLabel" @click.prevent="openThreshold($event)"></f7-list-item>
    <!-- The wrap-up check after a finished task, for this agent. -->
    <f7-list-item class="agent-wrap-up" :title="ct('自動收尾檢查')" :footer="wrapUpGlobal?undefined:ct('管理頁的總開關目前是關的，不會送出。')"><template #after><f7-toggle :checked="detail.wrapUp!==false" @toggle:change="setWrapUp"/></template></f7-list-item>
   </f7-list></template>
  </AgentProfileFields>
  <template v-if="user?.role==='admin'">
  <f7-block-footer v-if="!detail.sessionModel">{{ct('既有 session 沿用原設定，儲存模型設定後套用。')}}</f7-block-footer>
  </template>
  <f7-block-footer v-else>{{ct('Agent 設定由管理員調整；如需變更，請聯絡 CC Agent 管理員。')}}</f7-block-footer>
  <template v-if="usageRows">
   <f7-list inset class="cc-settings-list agent-usage" :title="ct('依各模型的 token 與 API 參考價格估算，不是實際帳單；未知價格不計入金額。')+' '+ct('含這個 Agent 的所有世代。')">
    <f7-list-item :title="ct('累計 token')" :after="usageRows.total"/>
    <f7-list-item :title="ct('輸入 / 輸出')" :after="usageRows.io"/>
    <f7-list-item :title="ct('快取 讀 / 寫')" :after="usageRows.cache"/>
    <f7-list-item :title="ct('回合數')" :after="usageRows.turns"/>
    <f7-list-item :title="ct('估算費用')" :after="usageRows.cost"/>
   </f7-list>
  </template>
  <AgentDiagnostics :admin="user?.role==='admin'" @trace-start="$emit('trace-start')" :detail="detail" :status="statusLabel"/>
  <!-- Messages with agents of a paired machine: an admin opens the agent, ticks which agents there it may hear from and write to,
       and may let its replies go back without being read first. Saved together. -->
  <f7-list v-if="user?.role==='admin'&&detail.mode!=='command'&&peerDraft" inset class="cc-settings-list agent-peer-link" :class="{'peer-ineligible':!peerEligible}">
   <f7-list-item class="agent-peer-on" :class="{disabled:!peerEligible&&!peerDraft.on}" :title="ct('跨機傳訊')" :footer="peerEligible?ct('和已配對電腦上勾選的 agent 互傳訊息。'):peerWhy"><template #media><f7-icon f7="link"/></template><template #after><f7-toggle :checked="peerDraft.on" :disabled="!peerEligible&&!peerDraft.on" @toggle:change="peerDraft={...peerDraft,on:$event}"/></template></f7-list-item>
   <template v-if="peerDraft.on||peerDraft.allow.length">
    <f7-list-item v-if="!peerChoices.length" class="agent-peer-none" :footer="ct('還沒有已配對的電腦，或對方還沒開放任何 agent。請到管理頁的「跨機連線」設定。')" :title="ct('可以往來的 agent')"/>
    <f7-list-item v-for="x in peerChoices" :key="x.pairId+'/'+x.agentId" checkbox class="agent-peer-allow" :data-agent-id="x.agentId" :title="x.machine+' · '+(x.title||ct('不在對方名單'))" :footer="[x.owner,x.agentId.slice(0,8)].filter(Boolean).join(' · ')" :checked="peerTicked(x)" @change="peerTick(x,$event.target.checked)"/>
    <f7-list-item class="agent-peer-auto" :title="ct('自動送回回覆')" :footer="ct('打開後，回覆會直接送回對方，不會先讓你看過。')"><template #after><f7-toggle :checked="peerDraft.autoReply" @toggle:change="peerDraft={...peerDraft,autoReply:$event}"/></template></f7-list-item>
   </template>
   <f7-list-item v-if="peerDirty" link no-chevron class="agent-peer-save" :title="ct('保存跨機傳訊設定')" @click.prevent="savePeer"><template #media><f7-icon f7="checkmark_circle"/></template></f7-list-item>
  </f7-list>

  <f7-block v-if="error" role="alert">{{error}}</f7-block>
 </template>
</template>
<script>
import AgentDiagnostics from "./AgentDiagnostics.vue";
import AgentProfileFields from "./AgentProfileFields.vue";
import GlassDropdown from "./GlassDropdown.vue";
import {inject,computed,ref,watch,onBeforeUnmount} from "vue";
import {api} from "../js/api.js";
import {escapeHtml} from "../js/safeDialog.js";
import {adminProblem,withAdminAgain} from "../js/adminAgain.js";
import {f7} from "framework7-vue";
import {compactCount,compactPolicy,autoCompactLabel,autoCompactFollow} from "../js/agent-i18n.js";
import {compactThreshold,wrapUp,autoCompactPresets} from "../js/agentPreferences.js";
import {editSubagents,subagentLabel} from "../js/subagentDialog.js";
import {defaultAvatar,avatarShape} from "../js/avatarShape.js";
// Why an agent cannot be opened to the peer link (server peerWhyNot).
const PEER_WHY={scoped:'受限的 agent 不能開通',"watch-open":'開放給外部聊天的 agent 不能開通',"owner-not-admin":'擁有者不是在職的管理員，不能開通',archived:'已刪除的 agent 不能開通',"not-claude":'只有 Claude agent 能開通'};
const peerOf=d=>d?.peerLink?{on:!!d.peerLink.on,allow:(d.peerLink.allow||[]).map(x=>({pairId:x.pairId,agentId:x.agentId})),autoReply:!!d.peerLink.autoReply}:null;
const peerSame=(a,b)=>!!a&&!!b&&a.on===b.on&&a.autoReply===b.autoReply&&a.allow.length===b.allow.length&&a.allow.every(x=>b.allow.some(y=>y.pairId===x.pairId&&y.agentId===x.agentId));
// `title` on a list item is its label, so a row's hover hint is set on its element.
const hint=(el,binding)=>{el.title=binding.value||'';};
export default {components:{AgentProfileFields,AgentDiagnostics,GlassDropdown},directives:{hint},emits:['trace-start'],setup(){const w=inject("workspace");const avatarInput=ref(null);
 let engineToast=null;
 const thresholdOpen=ref(false),thresholdPoint=ref({clientX:0,clientY:0});
 const autoCompactOpen=ref(false),autoCompactPoint=ref({clientX:0,clientY:0});
 const toast=text=>f7.toast.create({text:w.ct(text),closeTimeout:3000}).open();
 const merge=r=>{if(r&&r.id===w.detail.value?.id)w.detail.value={...w.detail.value,...r,messages:w.detail.value?.messages||r.messages,hasOlder:w.detail.value?.hasOlder};};
 // A setting saved but not in effect until the agent starts again (subagents, auto-compact):
 // starting it again is asked first, and only on yes is it applied.
 function askRestart(d,needs,title,applyAction,applyKey){
  if(needs==='next-start'){toast('已保存，下次啟動時套用。');return;}
  if(needs!=='idle'&&needs!=='busy'){toast('設定已保存');return;}
  toast('設定已保存');
  const apply=async()=>{try{const a=await api('/conversations/'+d.id+'/'+applyAction,{method:'POST',body:'{}'});merge(a);
    toast({now:'agent 已重新啟動並套用。','after-reply':'會在 agent 這次完成後自動重新啟動套用。','next-start':'下次啟動時套用。'}[a?.[applyKey]]||'設定已保存');}catch(e){f7.dialog.alert(e.message);}};
  setTimeout(()=>f7.dialog.create({title,
    text:escapeHtml(d.title)+' '+w.ct(needs==='idle'?'要重新啟動才會套用，現在重新啟動嗎？聊天內容不會不見。':'正在工作，要在它這次完成後自動重新啟動套用嗎？'),
    buttons:[{text:w.ct('稍後')},{text:w.ct(needs==='idle'?'重新啟動':'好'),strong:true,onClick:apply}],destroyOnClose:true}).open(),350);
 }
 const pendingHint=(pending,waiting)=>pending?w.ct(waiting?'等 agent 閒下來會自動重新啟動；要立即套用，請按上方的「重啟」。':'還沒套用，按上方的「重啟」才會生效。'):undefined;
 const following=()=>w.ct('跟隨管理設定')+'（'+compactPolicy(compactThreshold.value)+'）';
 // The peer link section: a draft of on, ticks and auto-reply, saved together; the
 // paired machines' directories to tick from, read when the panel shows an agent.
 const peerDraft=ref(peerOf(w.detail.value)),peerPeers=ref([]);
 const peerDirty=computed(()=>!!peerDraft.value&&!peerSame(peerDraft.value,peerOf(w.detail.value)));
 watch(()=>[w.detail.value?.id,JSON.stringify(w.detail.value?.peerLink||null)],([id],[wasId]=[])=>{if(id!==wasId||!peerDirty.value)peerDraft.value=peerOf(w.detail.value);});
 async function loadPeers(){if(w.user.value?.role!=='admin'||!w.detail.value||w.detail.value.mode==='command')return;try{peerPeers.value=(await api('/peer-link')).peers||[];}catch{peerPeers.value=[];}}
 watch(()=>[w.detail.value?.id,w.user.value?.role],([id],[wasId]=[])=>{if(id&&id!==wasId)loadPeers();},{immediate:true});
 // The other machine's list comes in by itself: the live socket says the pairing state
 // changed.
 const onPeerLive=()=>{if(w.detail.value?.peerLink)loadPeers();};
 window.addEventListener('cc-agent-changed',onPeerLive);onBeforeUnmount(()=>window.removeEventListener('cc-agent-changed',onPeerLive));
 const peerChoices=computed(()=>{
  const list=[];
  for(const p of peerPeers.value)for(const a of p.directory||[])list.push({pairId:p.pairId,machine:p.name,agentId:a.agentId,title:a.title,owner:a.owner});
  // A tick whose agent is no longer listed stays, so it can be taken away.
  for(const x of peerDraft.value?.allow||[])if(!list.some(y=>y.pairId===x.pairId&&y.agentId===x.agentId))list.push({...x,machine:peerPeers.value.find(p=>p.pairId===x.pairId)?.name||x.pairId.slice(0,8),title:'',owner:''});
  return list;
 });
 const peerTicked=x=>!!peerDraft.value?.allow.some(y=>y.pairId===x.pairId&&y.agentId===x.agentId);
 function peerTick(x,on){const d=peerDraft.value;if(!d)return;const rest=d.allow.filter(y=>!(y.pairId===x.pairId&&y.agentId===x.agentId));peerDraft.value={...d,allow:on?[...rest,{pairId:x.pairId,agentId:x.agentId}]:rest};}
 // Widening (on, a new tick, auto-reply) asks for the admin's password; narrowing does not.
 async function savePeer(){
  const id=w.detail.value?.id,body=peerDraft.value;if(!id||!body)return;
  try{
   const d=await withAdminAgain(w.ct('跨機傳訊'),again=>api('/conversations/'+id+'/peer-link',{method:'POST',body:JSON.stringify({...body,...again})}));
   if(!d||w.detail.value?.id!==id)return;
   w.detail.value={...w.detail.value,...d,messages:w.detail.value.messages,hasOlder:w.detail.value.hasOlder};
   peerDraft.value=peerOf(w.detail.value);
   f7.toast.create({text:w.ct('設定已保存'),closeTimeout:1800}).open();
  }catch(e){f7.dialog.alert(adminProblem(e)||e.message);}
 }
 const canStart=computed(()=>["stopped","error"].includes(w.detail.value?.phase)||!w.detail.value?.connected&&!["starting","busy","handing-off"].includes(w.detail.value?.phase));
 const canRestart=computed(()=>!!w.detail.value&&!["stopped","error","starting","handing-off"].includes(w.detail.value.phase));
 return {...w,defaultAvatar,avatarShape,
  peerDraft,peerDirty,peerChoices,peerTicked,peerTick,savePeer,
  peerEligible:computed(()=>w.detail.value?.peerLink?.eligible!==false),
  peerWhy:computed(()=>{const why=w.detail.value?.peerLink?.why;return why?w.ct(PEER_WHY[why]||why):'';}),
  thresholdOpen,thresholdPoint,
  thresholdLabel:computed(()=>w.detail.value?.thresholdOwn?compactPolicy(w.detail.value.threshold):following()),
  thresholdItems:computed(()=>[{value:'follow',label:following()},...Array.from({length:10},(_,i)=>({value:String(i+1),label:compactCount(i+1)})),{value:'0',label:compactPolicy(0)}]),
  thresholdSelected:computed(()=>w.detail.value?.thresholdOwn?String(w.detail.value.threshold):'follow'),
  openThreshold:event=>{thresholdPoint.value={clientX:event?.clientX??0,clientY:event?.clientY??0};thresholdOpen.value=true;},
  wrapUpGlobal:computed(()=>wrapUp.value.enabled===true),
  setWrapUp:async on=>{if((w.detail.value?.wrapUp!==false)===!!on)return;if(await w.action('wrap-up',{wrapUp:!!on}))f7.toast.create({text:w.ct('設定已保存'),closeTimeout:1800}).open();},
  subagentRowLabel:computed(()=>{const d=w.detail.value;return (d?.subagents?subagentLabel(d.subagents):w.ct('跟隨管理設定')+'（'+subagentLabel(d?.subagentDefault)+'）')+(d?.subagentPending?w.ct('（重新啟動後套用）'):'');}),
  editAgentSubagents:()=>{const d=w.detail.value;if(!d)return;editSubagents({title:d.title+' '+w.ct('的子代理模型與 Effort'),text:w.ct('只套用在這個 agent。選「跟隨管理設定」就照管理頁的設定。改了要等 agent 重新啟動才生效。'),value:d.subagents||d.subagentDefault,own:{follow:!d.subagents},
   save:async next=>{const r=await api('/conversations/'+d.id+'/subagents',{method:'POST',body:JSON.stringify({subagents:next})});merge(r);
   // Saved only: starting it again is asked first.
   askRestart(d,r?.subagentNeeds,w.ct('子代理模型與 Effort'),'subagents-apply','subagentApply');
  }});},
  // Not in effect yet: what still has to happen.
  subagentHint:computed(()=>pendingHint(w.detail.value?.subagentPending,w.detail.value?.subagentWaiting)),
  // When its Claude Code compacts: its own, or following the admin page (issue #12).
  autoCompactOpen,autoCompactPoint,
  autoCompactRowLabel:computed(()=>{const d=w.detail.value;return (d?.autoCompactOwn?autoCompactLabel(d.autoCompact):autoCompactFollow(d?.autoCompactDefault))+(d?.autoCompactPending?w.ct('（重新啟動後套用）'):'');}),
  autoCompactItems:computed(()=>[{value:'follow',label:autoCompactFollow(w.detail.value?.autoCompactDefault)},{value:'default',label:autoCompactLabel(null)},...autoCompactPresets.value.map(n=>({value:String(n),label:autoCompactLabel(n)}))]),
  autoCompactSelected:computed(()=>{const d=w.detail.value;return !d?.autoCompactOwn?'follow':d.autoCompact?String(d.autoCompact):'default';}),
  autoCompactHint:computed(()=>pendingHint(w.detail.value?.autoCompactPending,w.detail.value?.autoCompactWaiting)),
  openAutoCompact:event=>{autoCompactPoint.value={clientX:event?.clientX??0,clientY:event?.clientY??0};autoCompactOpen.value=true;},
  chooseAutoCompact:async value=>{
   autoCompactOpen.value=false;const d=w.detail.value;if(!d)return;
   const next=value==='follow'?'follow':value==='default'?null:Number(value);
   try{const r=await api('/conversations/'+d.id+'/auto-compact',{method:'POST',body:JSON.stringify({autoCompact:next})});merge(r);
    askRestart(d,r?.autoCompactNeeds,w.ct('自動壓縮時機'),'auto-compact-apply','autoCompactApply');}
   catch(e){f7.dialog.alert(e.message);}
  },
  chooseThreshold:async value=>{thresholdOpen.value=false;if(await w.action('threshold',{threshold:value==='follow'?null:Number(value)}))f7.toast.create({text:w.ct('設定已保存'),closeTimeout:1800}).open();},
  avatarInput,
  // What changing the model or effort does is said when one is changed, not all the
  // time; one toast at a time.
  engineNote:()=>{engineToast?.close();engineToast=f7.toast.create({text:w.ct('變更模型或 effort 會重新連線並保留原本對話；請先等待回覆完成。'),closeTimeout:4500,cssClass:'engine-note'});engineToast.open();},
  // The same picture may be chosen twice in a row, so the input is emptied each time.
  chooseAvatar:event=>{const file=event.target.files?.[0];event.target.value='';if(file)w.uploadAvatar(file);},
  // F7's `disabled` class only styles a list item; the @click still fires. These
  // guard the handlers so a greyed-out control is actually inert.
  busyPhase:computed(()=>["starting","busy","handing-off"].includes(w.detail.value?.phase)),
  stopped:computed(()=>["stopped","error"].includes(w.detail.value?.phase)),
  canStart,
  canRestart,
  // F7's `disabled` class only styles; `off` keeps a greyed-out button inert.
  actionButtons:computed(()=>{const d=w.detail.value;if(!d)return [];const stopped=["stopped","error"].includes(d.phase);return [
   {key:'start',short:w.ct('啟動'),cls:'agent-start',icon:'play_circle',label:w.ct('啟動'),off:!canStart.value,run:()=>w.action('start')},
   {key:'restart',short:w.ct('重啟'),cls:'agent-restart',icon:'arrow_clockwise_circle',label:w.ct('重啟'),off:!canRestart.value,run:()=>w.restart()},
   {key:'pause',short:w.ct('暫停'),icon:'pause_circle',label:w.ct('暫停執行'),off:stopped,run:()=>w.pause()},
   {key:'handoff',short:w.ct('接續'),icon:'arrow_2_circlepath',label:w.ct('接續到新 session'),off:d.phase==='busy',run:()=>w.handoff()},
   ...(d.mode==='claude'?[{key:'import',short:w.ct('讀取'),icon:'arrow_down_doc',label:w.ct('讀取 session 既有對話'),off:false,run:()=>w.importHistory()},
    {key:'compact',short:w.ct('壓縮'),icon:'arrow_down_right_arrow_up_left',label:w.ct('執行一次 compact'),off:d.phase!=='ready',run:()=>w.action('compact')}]:[]),
   ...(d.mode==='demo'?[{key:'simulate',short:w.ct('模擬'),icon:'arrow_2_circlepath',label:w.ct('模擬一次 compact'),off:false,run:()=>w.action('simulate-compact')}]:[])];})}}};
</script>

<style scoped>
/* Cards follow one another at the distance rows keep inside a card. */
.list{--f7-list-margin-vertical:10px;}
.list+.block-footer{margin-top:8px;}
/* The folded name shows no arrow until it is open, as in AgentProfileFields. */
.agent-picture-preview {width:36px;height:36px;border-radius:38%;object-fit:cover;}
/* An icon (the default symbol, or a picture with a transparent background) whole, not cut. */
.agent-picture-preview.is-icon {border-radius:0;object-fit:contain;}
.agent-picture :deep(.item-after) {gap:8px;align-items:center;}
.profile-pill {display:flex;align-items:center;gap:5px;height:28px;padding:0 12px;border-radius:14px;background:rgba(120, 120, 128, .24);color:var(--f7-list-item-title-text-color, var(--f7-text-color));font-size:13px;white-space:nowrap;}
.profile-pill .icon {font-size:17px;}
.profile-actions {display:flex;justify-content:center;gap:8px;margin:14px var(--cc-space-5) 16px;padding:0 16px;}
.profile-action {display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;flex:1 1 0;min-width:0;max-width:72px;height:54px;border-radius:16px;background:rgba(120, 120, 128, .24);color:var(--f7-list-item-title-text-color, var(--f7-text-color));font-size:12px;line-height:1;white-space:nowrap;}
.profile-action .icon {font-size:22px;}
.profile-action.disabled {opacity:.3;pointer-events:none;}
</style>
