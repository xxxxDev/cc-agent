<template>
 <!-- One conversation's bubbles: its messages, attachments, markdown and the typing
      bubbles, wherever a conversation is shown (the conversation page, a split-view
      cell). Main chat typing state comes from the workspace so its ticks do not redraw the list. -->
 <f7-messages :init="false" class="message-list" @click="onMarkdownClick" @animationend="onArrivalEnd">
  <f7-messages-title v-if="!messages.length&&emptyText">{{emptyText}}</f7-messages-title>
  <div v-if="hasOlder" class="older-turns"><f7-preloader v-if="olderBusy" :size="18"/><f7-link v-else @click="$emit('load-older')">{{ct('載入更早的對話')}}</f7-link></div>
  <template v-for="m in messages" :key="m.id"><f7-messages-title v-if="m.role==='system'&&!cardOf(m)" :data-message-id="m.id" :class="{'message-arrival':arrivingIds.has(m.id)}">{{m.text}}</f7-messages-title><div v-else-if="cardOf(m)" class="message schedule-card" :class="{'message-arrival':arrivingIds.has(m.id),'message-found':foundId===m.id,open:opened.has(m.id)}" :data-message-id="m.id" role="button" tabindex="0" :aria-expanded="String(opened.has(m.id))" @click="toggleOpen(m,$event)" @keydown.enter="toggleOpen(m,$event)"><div class="schedule-card-head"><f7-icon :f7="cardOf(m).icon" :size="15"/><span class="schedule-card-name">{{cardOf(m).name}}</span><span class="schedule-card-time">{{time(m.at)}}</span><f7-icon f7="chevron_down" :size="12" class="schedule-card-more"/></div><div v-if="scheduleResult(m)" class="schedule-card-result"><b v-if="scheduleResult(m).title">{{scheduleResult(m).title}}</b><span v-if="scheduleResult(m).summary">{{scheduleResult(m).summary}}</span></div><div v-if="m.outbound&&m.attachments?.length" class="message-files" @click.stop><div v-for="file in m.attachments" :key="file.id" class="attachment-chip"><a class="attachment-open" href="#" :title="file.name" @click.prevent="$emit('preview',{...file,group:m.attachments})"><f7-icon f7="doc" :size="20"/><span>{{file.name}}<small>{{file.size<1024?file.size+' B':(file.size/1024).toFixed(1)+' KB'}}</small></span></a></div></div><div v-if="opened.has(m.id)" class="schedule-card-body message-markdown message-copy" v-html="renderTypedMarkdown(m.text)"></div><div v-else class="schedule-card-preview">{{preview(scheduleInstruction(m.text))}}</div></div><f7-message v-else :data-message-id="m.id" :type="m.role==='user'&&!m.peer?'sent':'received'" :avatar="m.role==='assistant'?(m.speaker?.avatar||avatar):m.peer?peerIconOf(m):undefined" :name="m.speaker?.label" :first="true" :last="true" :tail="true" :class="{'message-arrival':arrivingIds.has(m.id),'avatar-icon':m.role==='assistant'&&avatarShape(m.speaker?.avatar||avatar)==='icon','attachment-only':m.attachments?.length&&!m.text,'inspectable':inspectable,'inspected':inspectable&&inspectId===m.id,'imported-turn':m.imported,'message-found':foundId===m.id,'relay-message':m.role==='relay'||!!m.speaker?.to,'relay-folded':folded(m)}" :aria-expanded="foldable(m)?String(!folded(m)):undefined" @click="onBubble(m,$event)"><template v-if="m.role==='relay'" #header><div class="relay-head"><f7-icon :f7="m.relay?.direction==='out'?'arrow_up_right':'arrow_down_left'" :size="14"/>{{m.relay?.direction==='out'?ct('已傳給 '):ct('來自 ')}}<a v-if="m.relay?.peerId" href="#" class="relay-peer" @click.prevent.stop="$emit('open-peer',m.relay.peerId)">{{m.relay.peerName}}</a><span v-else class="relay-peer">{{m.relay?.peerName}}<small> · {{ct('不在 CC Agent 內')}}</small></span></div></template><template v-else-if="m.attachments?.length" #header><div v-if="picturesOf(m).length" class="message-pictures" :class="{grid:picturesOf(m).length>1}"><a v-for="(file,i) in picturesOf(m).slice(0,4)" :key="file.id" class="message-picture" href="#" :aria-label="ct('預覽')+' '+file.name" @click.prevent="$emit('preview',{...file,group:m.attachments})"><img :src="attachmentUrl(file)" :alt="file.name" loading="lazy" draggable="false"/><span v-if="i===3&&picturesOf(m).length>4" class="message-picture-more">+{{picturesOf(m).length-4}}</span></a></div><div class="message-files"><div v-for="file in m.attachments" :key="file.id" class="attachment-chip"><a class="attachment-open" href="#" :title="file.name" @click.prevent="$emit('preview',{...file,group:m.attachments})"><f7-icon :f7="/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(file.name)?'music_note':/\.(mp4|m4v|mov|webm|ogv)$/i.test(file.name)?'film':'doc'" :size="20"/><span>{{file.name}}<small>{{file.size<1024?file.size+' B':(file.size/1024).toFixed(1)+' KB'}}</small></span></a><a class="attachment-download external" :href="attachmentUrl(file)" :download="file.name" target="_blank" rel="noopener" :aria-label="ct('下載')+' '+file.name" @click.stop="onDownload(file,$event)"><f7-icon f7="arrow_down_circle" :size="22"/></a></div></div></template><template #text><div v-if="m.text&&folded(m)" class="relay-preview"><span class="relay-preview-text">{{preview(m.text)}}</span><f7-icon f7="chevron_down" :size="12" class="relay-preview-more"/></div><div v-else-if="m.text" class="message-markdown message-copy" v-html="m.role==='assistant'?withOwner(renderMarkdown(m.text),m):withMentions(renderTypedMarkdown(m.text),m.mentions)"></div></template><template #footer>{{time(m.at)}}<span v-if="m.imported"> · {{ct('來自 session')}}</span><span v-if="m.schedule?.name" class="schedule-label"> · {{ct('排程：')}}{{m.schedule.name}}</span><span v-if="m.group?.name" class="schedule-label"> · {{ct('群組：')}}{{m.group.name}}</span><span v-if="m.peer?.machine" class="schedule-label"> · {{ct('來自 ')}}{{m.peer.machine}} · {{m.peer.title}}</span><span v-else-if="m.footnote" class="schedule-label"> · {{m.footnote}}</span><span v-if="m.peerOut" class="schedule-label peer-out-line"> · {{peerOutLine(m)}}</span><span v-if="m.peerOut?.status==='draft'&&isAdmin" class="peer-draft-actions" @click.stop><f7-button small fill round class="peer-draft-send" :class="{disabled:draftBusy.has(m.id)}" @click="decideDraft(m,true)">{{ct('送出')}}</f7-button><f7-button small round class="peer-draft-drop" :class="{disabled:draftBusy.has(m.id)}" @click="decideDraft(m,false)">{{ct('不送')}}</f7-button></span><button v-if="m.text" type="button" class="bubble-copy" :aria-label="ct('複製這則訊息')" :title="ct('複製這則訊息')" @click.stop="copyText(m.text)"><i class="icon f7-icons">doc_on_doc</i></button></template></f7-message></template>
  <TypingBubbles :background-text="backgroundText" :typing="typing" :typing-text="typingText" :typing-note="typingNote" :interruptible="interruptible" :interrupting="interrupting" @interrupt="$emit('interrupt')"/>
 </f7-messages>
</template>
<script setup>
import {defineComponent,h,inject,ref,computed,watch} from 'vue';
import {api} from '../js/api.js';
import {currentUser} from '../js/auth.js';
import {f7,f7Message} from 'framework7-vue';
import {ct} from '../js/agent-i18n.js';
import {timeLocale} from '../js/i18n.js';
import {avatarShape} from '../js/avatarShape.js';
import {bubbleTime} from '../js/bubbleTime.js';
import {renderMarkdown,renderTypedMarkdown} from '../js/markdown.js';
import {saveFile,sharesFiles} from '../js/saveFile.js';
const props=defineProps({messages:{type:Array,default:()=>[]},conversationId:String,peerTargets:{type:Array,default:()=>[]},hasOlder:Boolean,olderBusy:Boolean,avatar:String,
 inspectable:Boolean,inspectId:String,foundId:String,backgroundText:String,typing:{type:Boolean,default:undefined},typingText:String,typingNote:String,emptyText:String,interruptible:{type:Boolean,default:undefined},interrupting:{type:Boolean,default:undefined}});
const emit=defineEmits(['load-older','inspect','preview','interrupt','open-peer','open-group']);
// Isolate per-second typing/progress updates into a child component so the messages v-for does not re-render on each status tick.
const TypingBubbles=defineComponent({
 name:'TypingBubbles',
 props:{backgroundText:String,typing:{type:Boolean,default:undefined},typingText:String,typingNote:String,interruptible:{type:Boolean,default:undefined},interrupting:{type:Boolean,default:undefined}},
 emits:['interrupt'],
 setup(p,{emit:emitTyping}){
  const ws=inject('workspace',null);
  return ()=>{
   const fromProps=p.typing!==undefined;
   const bg=fromProps?p.backgroundText:ws?.backgroundProgress?.value;
   const on=fromProps?p.typing:ws?.typingBubble?.value;
   const text=fromProps?p.typingText:ws?.progressInBubble?.value;
   const note=fromProps?p.typingNote:ws?.noteInBubble?.value;
   const canStop=fromProps?p.interruptible:ws?.canInterrupt?.value;
   const stopping=fromProps?p.interrupting:ws?.interrupting?.value;
   const stop=()=>fromProps?emitTyping('interrupt'):ws?.interruptTurn?.();
   const out=[];
   if(bg)out.push(h(f7Message,{key:'bg',type:'received',typing:true,first:true,last:true,tail:true,class:'typing-progress background-progress'},{
    text:()=>h('span',{class:'typing-progress-text',role:'status','aria-live':'polite'},bg),
   }));
   if(on){
    const hasBody=!!(text||note||canStop);
    out.push(h(f7Message,{key:'typing',type:'received',typing:true,first:true,last:true,tail:true,class:'typing-progress'},hasBody?{
     text:()=>[
      h('span',{class:'typing-lines'},[
       note?h('span',{class:'typing-note'},note):null,
       text?h('span',{class:'typing-progress-text',role:'status','aria-live':'polite'},text):null,
      ]),
      canStop?h('button',{type:'button',class:'interrupt-turn',disabled:stopping,'aria-label':ct('中斷這一輪'),title:ct('中斷這一輪'),onClick:e=>{e.stopPropagation();stop();}},[h('i',{class:'icon f7-icons'},'stop_fill')]):null,
     ],
    }:{}));
   }
   return out;
  };
 },
});
// Track seen message ids so only newly appended messages play the arrival animation, without TransitionGroup measuring every bubble's box.
const seenIds=new Set((props.messages||[]).map(m=>m.id));
const arrivingIds=new Set();
let seenConv=props.conversationId;
watch(()=>[props.conversationId,props.messages],([cid,list])=>{
 const items=list||[];
 if(cid!==seenConv||(seenIds.size&&!items.some(m=>seenIds.has(m.id)))){
  seenConv=cid;seenIds.clear();arrivingIds.clear();
  for(const m of items)seenIds.add(m.id);
  return;
 }
 let pastKnown=!seenIds.size;
 for(const m of items){
  if(seenIds.has(m.id)){pastKnown=true;continue;}
  seenIds.add(m.id);
  if(pastKnown)arrivingIds.add(m.id);
 }
},{flush:'sync'});
function onArrivalEnd(event){if(event.animationName!=='message-arrival')return;const id=event.target?.dataset?.messageId;if(id){arrivingIds.delete(id);event.target.classList.remove('message-arrival');}}
// An agent named with @ from the menu, as a tag that opens it. The name is found in the text already rendered, escaped as it is there.
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// One pass, longest name first, and only a whole name: "@writer" is not the start of
// "@writer-notes".
function withMentions(html,mentions){
 const list=(mentions||[]).filter(m=>UUID.test(m?.id||'')&&m.title).sort((a,b)=>b.title.length-a.title.length);
 if(!list.length)return html;
 const byText=new Map(list.map(m=>[esc('@'+m.title),m]));
 const pattern=new RegExp('('+[...byText.keys()].map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?![\\w-])','g');
 return html.replace(pattern,t=>{const m=byText.get(t);return `<a href="#" class="mention-tag" ${m.group?'data-group-id':'data-agent-id'}="${m.id}">${t}</a>`;});
}
// What agents send one another across sessions folds to one line: a tap opens it and a second closes it; the one a search
// landed on stays open.
const opened=ref(new Set());
const foldable=m=>m.role==='relay'||!!m.speaker?.to;
const folded=m=>foldable(m)&&!opened.value.has(m.id)&&props.foundId!==m.id;
// Pictures show above their capsules, one as it is and several in a grid of four; the capsules stay for the name and download.
// Only what every browser draws: a HEIC still has its capsule and preview.
const PICTURE=/\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const picturesOf=m=>(m.attachments||[]).filter(f=>PICTURE.test(f.name||''));
const attachmentUrl=file=>'/api/conversations/'+(file.conversationId||props.conversationId)+'/attachments/'+file.id;
const preview=text=>String(text).replace(/```[^\n]*/g,'').replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm,'').replace(/\*\*|__|`/g,'').replace(/\s+/g,' ').trim().slice(0,160);
// A message a schedule sent is not the owner speaking:
// it shows as a card of its own, the schedule's name and time, what its check found,
// and the instruction folded.
// A usage limit that stopped the agent, and the automatic wake when it resets, use
// the same card.
function cardOf(m){
 if(m.role==='user'&&m.schedule)return {icon:'alarm',name:ct('排程：')+m.schedule.name};
 if(m.role==='user'&&m.limitResume)return {icon:'arrow_clockwise',name:ct('自動喚醒')};
 // The wrap-up check CC Agent sends after a finished task.
 if(m.role==='user'&&m.wrapUp)return {icon:'checkmark_seal',name:ct('收尾檢查')};
 if(m.role==='system'&&m.notice==='limit')return {icon:'hourglass',name:ct('額度用完')};
 // The agent rewrote its own Agent Profile description: before and after.
 if(m.role==='system'&&m.notice==='describe')return {icon:'person_crop_circle',name:ct('Agent 更新了自己的描述')};
 // Where the conversation was compacted: its size before and after, and
 // inside, the summary the agent now works from.
 if(m.role==='system'&&m.notice==='compact'){const c=m.compact||{},k=v=>v>=1000?Math.round(v/1000)+'K':String(v);return {icon:'archivebox',name:[ct('整理了對話記憶'),Number.isFinite(c.preTokens)&&Number.isFinite(c.postTokens)?k(c.preTokens)+' → '+k(c.postTokens)+' tokens':'',Number.isFinite(c.durationMs)?Math.round(c.durationMs/1000)+' '+ct('秒'):'',c.trigger==='manual'?ct('手動'):''].filter(Boolean).join(' · ')};}
 return null;
}
// The instruction above a script's result, in either language it is sent in.
// On an iPhone home-screen app the file goes to the share sheet, not a full-screen
// download with no way back (saveFile.js); elsewhere the link downloads as before.
function onDownload(file,event){if(!sharesFiles())return;event.preventDefault();saveFile(attachmentUrl(file),file.name,{confirm:run=>f7.dialog.create({title:file.name.replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),text:ct('檔案準備好了'),buttons:[{text:ct('取消')},{text:ct('儲存或分享'),bold:true,onClick:run}]}).open()});}
function scheduleInstruction(text){return String(text).split(/\n\n(?:腳本結果|Script result)/)[0];}
const scheduleResults=new Map();
// Messages to and from a paired machine are plain bubbles: one from the other machine
// on the left with that machine's own icon, one sent there with a line under it
// saying where it went and what became of it.
const PEER_OUT_STATUS={queued:'排隊中',draft:'草稿，等你送出',delivered:'已送達',expired:'已過期',refused:'被拒',unsent:'未送出'};
const peerIconOf=m=>props.peerTargets.find(t=>t.pairId===m.peer?.pairId)?.icon||undefined;
const peerOutLine=m=>(m.peerOut.kind==='reply'?ct('回覆給'):ct('已傳給'))+' '+m.peerOut.machine+' · '+(m.peerOut.toTitle||m.peerOut.toAgent)+' · '+ct(PEER_OUT_STATUS[m.peerOut.status]||m.peerOut.status)+(m.peerOut.reason?'：'+m.peerOut.reason:'');
// A reply draft for the other machine: an admin sends it on or drops it. The line
// shows the answer at once; the next poll brings the stored one.
const isAdmin=computed(()=>currentUser.value?.role==='admin');
const draftBusy=ref(new Set());
async function decideDraft(m,send){
 if(draftBusy.value.has(m.id))return;
 draftBusy.value=new Set([...draftBusy.value,m.id]);
 try{
  const r=await api('/conversations/'+(m.conversationId||props.conversationId)+'/peer-draft/'+encodeURIComponent(m.id),{method:'POST',body:JSON.stringify({send})});
  const next={...m.peerOut,status:r.status||m.peerOut.status};if(r.reason)next.reason=r.reason;else delete next.reason;m.peerOut=next;
 }catch(e){f7.dialog.alert(e.message);}
 finally{const s=new Set(draftBusy.value);s.delete(m.id);draftBusy.value=s;}
}
function scheduleResult(m){
 if(scheduleResults.has(m.id))return scheduleResults.get(m.id);
 let found=null;const block=String(m.text).match(/```json\n([\s\S]*?)\n```/);
 if(block){try{const j=JSON.parse(block[1]);const plain=v=>typeof v==='string'||typeof v==='number'?String(v):'';found={title:plain(j.title).slice(0,120),summary:plain(j.summary).slice(0,300)};if(!found.title&&!found.summary)found=null;}catch{found=null;}}
 scheduleResults.set(m.id,found);return found;
}
function toggleOpen(m,event){
 if(event.target.closest?.('a,button,.md-copy')||String(window.getSelection?.()||''))return;
 const next=new Set(opened.value);if(next.has(m.id))next.delete(m.id);else next.add(m.id);opened.value=next;
}
function onBubble(m,event){
 if(props.inspectable)emit('inspect',m);
 if(!foldable(m)||event.target.closest?.('a,button,.md-copy')||String(window.getSelection?.()||''))return;
 const next=new Set(opened.value);if(next.has(m.id))next.delete(m.id);else next.add(m.id);opened.value=next;
}
// An agent calling on the owner in a group: its @owner reads as a tag
// for "you", the one that notified the owner's phone.
function withOwner(html,m){
 if(!m.mentionsOwner)return html;
 return html.replace(/(^|[^\w@.])@(owner|你)(?![\w.-])/gi,(all,before)=>`${before}<span class="mention-tag owner-tag">@${ct('你')}</span>`);
}
const time=s=>bubbleTime(s,{yesterday:ct('昨天'),locale:timeLocale()});
// Code blocks carry a copy button, and a click on inline code copies that code. A click that ends a text selection is left to it.
async function copyText(text){
 try{await navigator.clipboard.writeText(text);}
 catch{const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}
 f7.toast.create({text:ct('已複製'),closeTimeout:1400}).open();
}
function onMarkdownClick(event){
 const tag=event.target.closest?.('.mention-tag');
 if(tag){event.preventDefault();event.stopPropagation();if(tag.dataset.groupId)emit('open-group',tag.dataset.groupId);else emit('open-peer',tag.dataset.agentId);return;}
 const button=event.target.closest?.('.md-copy');
 if(button){event.preventDefault();event.stopPropagation();const pre=button.parentElement?.querySelector('pre');if(pre)copyText(pre.textContent.replace(/\n$/,''));return;}
 const code=event.target.closest?.('.message-markdown code');
 if(code&&!code.closest('pre')&&!String(window.getSelection?.()||'')){event.stopPropagation();copyText(code.textContent);}
}
</script>

<style scoped>
/* The agent's picture: a photo in a rounded tile as in
   the Agents list; an icon (the default symbol, or any picture with a transparent
   background) on its own, whole, with no tile and no circle around it. */
.message :deep(.message-avatar){border-radius:38%;}
.message.avatar-icon :deep(.message-avatar){background-color:transparent;background-size:contain;background-repeat:no-repeat;background-position:center;border-radius:0;}
/* The bubbles' own look, the same wherever the list is shown. */
.message-list {
  /* The sent bubble is pure black with white text, in both modes: plain white
     reads as glare beside the dark page, and greys blur together. Its code is tinted from the text, so it reads as lighter
     grey on the black. */
  --f7-message-sent-bg-color: #000000;
  --f7-message-sent-text-color: #ffffff;
  --f7-message-bubble-padding-vertical: 14px;
  --f7-message-bubble-padding-horizontal: 20px;
  --f7-message-bubble-line-height: 1.5;
}
/* The space under the last bubble is the list's own, not the last bubble's margin
   (Framework7 gives it as .message:last-child). Vue's TransitionGroup appends a
   hidden copy of a bubble at the end of the list on every update, to read its move
   transition; for that moment the last real bubble was no longer :last-child, and
   where the browser laid the list out then, it lost its 16 px and a reader at the
   newest bubble dropped by 16 px until the next scroll to the bottom. With a
   subagent's row ticking in the background that was every second or two. Same geometry as before, only steady. */
.message-list > :is(.message,.messages-title):last-child {margin-bottom:0;}
.message-list::after {content:'';display:block;flex:none;height:var(--f7-message-margin);}
:deep(.message-sent .message-text) {color:#ffffff;}
.message-copy {white-space:pre-line;}
/* The message a search opened the conversation at, marked for a moment. The bubble
   itself is masked to draw its tail, which cuts off a ring, so the glow is on the
   part holding it and follows the bubble's shape. */
:deep(.message.message-found .message-content) {animation:message-found 2.6s ease-out;}
@keyframes message-found {0%,40% {filter:drop-shadow(0 0 2px #ff9f0a) drop-shadow(0 0 6px #ff9f0a);} 100% {filter:none;}}

/* In the typing bubble the dots keep saying "alive" and the text says what is
   happening. F7 renders the text slot before its own indicator, so the row is
   flex and the indicator is pulled first; it is inline-block with its own inner
   layout, which a flex item does not disturb. */
/* The thinking bubble may be as wide as an answer, so its status reads on one line
   (it wrapped at 70% with room to spare). */
.message-list :deep(.message-received.typing-progress) {max-width:calc((100% - 32px - var(--f7-safe-area-left,0px) - var(--f7-safe-area-right,0px)) * .9);}
:deep(.typing-progress .message-text) {display:flex;align-items:center;gap:8px;min-width:0;}
:deep(.typing-progress .message-typing-indicator) {order:-1;flex:0 0 auto;}
:deep(.typing-progress-text) {font-size:13px;line-height:1.3;color:var(--cc-color-text-secondary);overflow-wrap:anywhere;}
/* What the agent last said in its terminal this turn, over the status line. */
:deep(.typing-lines) {display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto;}
:deep(.typing-note) {font-size:14px;line-height:1.45;color:var(--cc-color-text);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;}
/* Stopping the turn is a small button in the bubble that says it is running, away
   from send, where it was pressed by mistake. */
:deep(.interrupt-turn) {flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:24px;height:24px;margin:0;padding:0;border:0;border-radius:12px;background:color-mix(in srgb,currentColor 16%,transparent);color:var(--cc-color-text);cursor:pointer;}
:deep(.interrupt-turn .icon) {font-size:10px;}
:deep(.interrupt-turn:disabled) {opacity:.4;cursor:default;}

/* Turns pulled from the session are history, not part of this conversation's own
   exchange: same shape, less contrast, so they read as background. */
.message.imported-turn {opacity:.82;}
/* Older pages arrive above the reader; the control sits where they will appear. */
.older-turns {display:flex;justify-content:center;padding:6px 0 10px;}

/* Arrival timing and 12px rise; only newly inserted messages animate. */
.message-arrival {animation:message-arrival 2s cubic-bezier(0.22,1,0.36,1);}
@keyframes message-arrival {from {opacity:0;transform:translateY(12px);}}
@media (prefers-reduced-motion:reduce) {.message-arrival {animation:none;}}

/* Short replies fit their content; long replies wrap at 90% of available width. */
:deep(.message-received:not(.message-typing)) {width:fit-content;max-width:calc((100% - 32px - var(--f7-safe-area-left,0px) - var(--f7-safe-area-right,0px)) * .9);align-self:flex-start;margin-right:calc(16px + var(--f7-safe-area-right,0px));}
:deep(.message-received:not(.message-typing) .message-content) {flex:0 1 auto;min-width:0;}
:deep(.message-received:not(.message-typing) .message-bubble) {width:auto;}

/* A chip in a bubble: open on the name, download on the arrow (the name as complete as fits, and no popup needed to save the file). */
.attachment-chip {display:flex;align-items:center;gap:8px;flex:0 0 auto;max-width:260px;border-radius:var(--cc-radius-card,16px);padding:8px 10px;background:var(--cc-glass-fill-subtle);color:var(--cc-color-text);}
.attachment-chip small {display:block;color:var(--cc-color-text-secondary);}
.message-pictures {margin:4px 0 6px;max-width:100%;}
/* One picture keeps its own proportions within 200px of height; the height is
   fixed, so the list does not move when it loads. */
.message-picture {position:relative;display:block;border-radius:12px;overflow:hidden;background:var(--cc-glass-fill-subtle);}
.message-pictures:not(.grid) .message-picture {display:inline-block;height:200px;max-width:100%;}
.message-pictures:not(.grid) .message-picture img {display:block;height:200px;width:auto;max-width:100%;object-fit:cover;}
.message-pictures.grid {display:grid;grid-template-columns:1fr 1fr;gap:4px;width:240px;border-radius:12px;overflow:hidden;}
.message-pictures.grid .message-picture {aspect-ratio:1;border-radius:0;}
.message-pictures.grid .message-picture img {display:block;width:100%;height:100%;object-fit:cover;}
.message-picture-more {position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);color:#fff;font-size:20px;font-weight:600;}
:deep(.message-sent .message-pictures) {margin-left:auto;text-align:right;}
.message-files {display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px;text-align:left;}
.message-files .attachment-chip {font-size:14px;box-sizing:border-box;max-width:100%;padding:8px 8px 8px 10px;}
.message-files .attachment-open {display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto;color:inherit;text-decoration:none;}
/* The whole name, wrapped where it has to: a file name is rarely long enough to
   need clipping, and the clipped part was usually the part that told files apart. */
.message-files .attachment-open span {min-width:0;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;line-height:1.3;}
.message-files .attachment-download {flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:32px;height:32px;margin-left:2px;color:var(--cc-color-text-secondary);}
.message-files .icon {flex-shrink:0;}
:deep(.message-sent .message-files) {justify-content:flex-end;}
:deep(.attachment-only .message-bubble) {display:none;}

/* With a mouse over a bubble, a button beside its time copies the message as it was
   written, markdown and all: selecting the drawn text loses the marks. It keeps its place while hidden, so nothing moves. */
.bubble-copy {display:none;}
@media (hover:hover) and (pointer:fine) {
 .bubble-copy {display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;width:24px;height:20px;margin-left:4px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;opacity:0;cursor:pointer;}
 .bubble-copy .icon {font-size:15px;}
 :deep(.message-sent) .bubble-copy {float:left;margin:-3px 4px 0 0;}
 :deep(.message:hover) .bubble-copy,.bubble-copy:focus-visible {opacity:.85;}
 .bubble-copy:hover {opacity:1;background:color-mix(in srgb,currentColor 14%,transparent);}
}

/* A wide code block or table scrolls inside its bubble instead of widening it past
   the screen. F7's bubble and text are flex items that size to their longest line:
   one long SQL line made a phone's reply bubble 974 px wide on a 390 px screen,
   cutting every paragraph off at the edge (measured). A code block
   inside it scrolled on its own; without min-width it widened the bubble past both
   screen edges on a phone. */
:deep(.message-content) {min-width:0;max-width:100%;}
:deep(.message-bubble) {min-width:0;max-width:100%;}
:deep(.message-text) {min-width:0;max-width:100%;}

/* Markdown in the bubbles, set the way rendered markdown usually reads. Every tint is mixed from the bubble's own text colour, so the
   same rules hold on the dark and light received bubble and on the sent bubble. */
.message-markdown {white-space:normal;overflow-wrap:anywhere;min-width:0;max-width:100%;}
.message-markdown :deep(pre) {max-width:100%;}
.message-markdown :deep(> :first-child) {margin-top:0;}
.message-markdown :deep(> :last-child) {margin-bottom:0;}
.message-markdown :deep(p) {margin:0 0 .7em;}
.message-markdown :deep(:is(h1,h2,h3,h4,h5,h6)) {margin:1.1em 0 .45em;line-height:1.3;font-weight:700;}
.message-markdown :deep(h1) {font-size:1.35em;}
.message-markdown :deep(h2) {font-size:1.2em;}
.message-markdown :deep(h3) {font-size:1.08em;}
.message-markdown :deep(:is(h4,h5,h6)) {font-size:1em;}
.message-markdown :deep(:is(h1,h2)) {padding-bottom:.25em;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent);}
.message-markdown :deep(:is(ul,ol)) {margin:0 0 .7em;padding-left:1.35em;}
.message-markdown :deep(li) {margin:.18em 0;}
.message-markdown :deep(li > :is(ul,ol)) {margin:.18em 0 0;}
.message-markdown :deep(li > p) {margin:0;}
.message-markdown :deep(li::marker) {color:color-mix(in srgb,currentColor 60%,transparent);}
.message-markdown :deep(strong) {font-weight:700;}
.message-markdown :deep(code) {font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;padding:.14em .4em;border-radius:6px;background:color-mix(in srgb,currentColor 13%,transparent);}
/* A code block wraps instead of scrolling sideways,
   leaving room on the right for its copy button. */
.message-markdown :deep(pre) {margin:0 0 .7em;padding:12px 44px 12px 14px;border-radius:10px;background:color-mix(in srgb,currentColor 8%,transparent);border:1px solid color-mix(in srgb,currentColor 12%,transparent);white-space:pre-wrap;overflow-wrap:anywhere;overflow-x:visible;line-height:1.5;}
.message-markdown :deep(.md-code) {position:relative;}
.message-markdown :deep(.md-code > pre) {margin-bottom:.7em;}
.message-markdown :deep(.md-copy) {position:absolute;top:6px;right:6px;display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:color-mix(in srgb,currentColor 12%,transparent);color:inherit;opacity:.75;cursor:pointer;}
.message-markdown :deep(.md-copy:hover) {opacity:1;}
.message-markdown :deep(.md-copy .icon) {font-size:16px;}
/* Inline code copies on a click, so it reads as something to press. */
.message-markdown :deep(:not(pre) > code) {cursor:copy;}
.message-markdown :deep(pre code) {padding:0;border-radius:0;background:none;}
.message-markdown :deep(blockquote) {margin:0 0 .7em;padding:.1em 0 .1em .85em;border-left:3px solid color-mix(in srgb,currentColor 35%,transparent);color:color-mix(in srgb,currentColor 75%,transparent);}
.message-markdown :deep(hr) {height:1px;margin:1em 0;border:0;background:color-mix(in srgb,currentColor 22%,transparent);}
.message-markdown :deep(a) {color:inherit;text-decoration:underline;text-decoration-color:color-mix(in srgb,currentColor 45%,transparent);text-underline-offset:2px;}
/* A link in a reply reads as a link, in a blue fitted to each theme; on the sent
   bubble, whose colour the user picks, it keeps the text colour, underlined. */
:deep(.message-received .message-markdown a) {color:#0969da;text-decoration-color:currentColor;}
:global(html.dark) .message-list :deep(.message-received .message-markdown a) {color:#58a6ff;}
.message-markdown :deep(.md-scroll) {max-width:100%;overflow-x:auto;margin:0 0 .7em;}
/* Cells break only where text normally may (F7's bubble would break inside a word,
   turning a code like AB-1001 into three lines) and never narrower than a short code; a table
   that needs more room than the bubble has scrolls sideways in .md-scroll. */
.message-markdown :deep(table) {border-collapse:collapse;font-size:.92em;overflow-wrap:normal;word-break:normal;}
.message-markdown :deep(:is(th,td)) {min-width:5em;padding:6px 10px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);text-align:left;vertical-align:top;}
.message-markdown :deep(th) {font-weight:600;white-space:nowrap;background:color-mix(in srgb,currentColor 8%,transparent);}
:deep(.message.relay-message .message-bubble){background:rgba(127,127,127,.12);border:1px dashed rgba(127,127,127,.45)}
/* Room between bubbles, the thinking bubble included. */
:deep(.message + .message){margin-top:28px}
.schedule-card{align-self:center;width:min(100%,560px);box-sizing:border-box;margin:36px auto 4px !important;padding:10px 14px;border-radius:16px;border:1px solid color-mix(in srgb,#ff9f0a 45%,transparent);background:color-mix(in srgb,#ff9f0a 9%,transparent);color:var(--cc-color-text);cursor:pointer;flex-direction:column;align-items:stretch;gap:6px}
.schedule-card-head{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#ff9f0a}
.schedule-card-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.schedule-card-time{flex:0 0 auto;font-weight:400;color:var(--cc-color-text-secondary)}
.schedule-card-more{flex:0 0 auto;opacity:.7;transition:transform .2s}
.schedule-card.open .schedule-card-more{transform:rotate(180deg)}
.schedule-card-result{display:flex;flex-direction:column;gap:2px;font-size:14px;line-height:1.4}
.schedule-card-result span{color:var(--cc-color-text-secondary)}
.schedule-card-preview{font-size:13px;color:var(--cc-color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.schedule-card-body{font-size:14px;line-height:1.5}
.schedule-card.message-found{box-shadow:0 0 0 2px #ff9f0a}
.peer-draft-actions{display:flex;gap:8px;margin:8px 0 4px}
.peer-draft-actions .button{flex:0 0 auto;min-width:72px}
.relay-preview{display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer}
.relay-preview-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.75}
.relay-preview-more{flex:0 0 auto;opacity:.6}
:deep(.message.relay-message:not(.relay-folded) .message-bubble){cursor:pointer}
.relay-head{display:flex;align-items:center;gap:4px;font-size:12px;opacity:.8;margin-bottom:2px}
.relay-peer{font-weight:600}
.relay-peer small{font-weight:400}
:deep(.mention-tag) {display:inline-block;padding:0 6px;border-radius:8px;background:rgba(10,132,255,.22);color:#4da3ff;font-weight:600;text-decoration:none;}
:deep(.message-sent .mention-tag) {background:rgba(255,255,255,.18);color:#fff;}
</style>
