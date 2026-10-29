<template>
 <div class="toolbar messagebar">
  <slot name="before-inner"/>
  <div ref="pill" class="toolbar-inner composer-pill" :class="{'composer-tall':tall}">
   <div class="toolbar-pane composer-start" :class="{'composer-empty':!$slots['inner-start']}"><slot name="inner-start"/></div>
   <div ref="area" class="messagebar-area">
    <!-- The same text laid out again over the editor, invisible but for a capsule
         behind each name: the browser places it, so it stays with the text however
         the bar moves or scales. -->
    <div v-if="parts.some(x=>x.name)" ref="mirror" class="mention-mirror" aria-hidden="true" :style="mirrorBox"><template v-for="(x,i) in parts" :key="i"><span v-if="x.name" class="mention-capsule">{{x.text}}</span><template v-else>{{x.text}}</template></template></div>
    <div ref="editor" :id="editorId||undefined" class="chat-editor" contenteditable="plaintext-only"
     role="textbox" aria-multiline="true" :aria-label="placeholder" :data-placeholder="placeholder"
     :data-empty="empty" dir="auto" autocomplete="off" inputmode="text" enterkeyhint="enter"
     autocorrect="on" autocapitalize="sentences" spellcheck="true"
     @input="input" @compositionstart="composing=true" @compositionend="compositionEnd"
     @keydown="keydown"/>
   </div>
   <div class="toolbar-pane composer-end" @click.capture="guardComposition"><slot name="inner-end"/></div>
  </div>
 </div>
</template>
<script setup>
import {ref,watch,onMounted,onBeforeUnmount,nextTick} from 'vue';
import {paintMentions} from '../js/mentionHighlight.js';
// editorId: the conversation page's own box is #cc-agent-prompt; a split-view cell's
// boxes, several on one page, have none.
const props=defineProps({value:{type:String,default:''},placeholder:String,highlights:{type:Array,default:()=>[]},editorId:{type:String,default:'cc-agent-prompt'}});
const emit=defineEmits(['update:value','keydown']);
const editor=ref(null),area=ref(null),empty=ref(!props.value);
let composing=false;
function text(){return editor.value?.innerText.replace(/\r\n?/g,'\n')||'';}
function input(){if(composing)return;const value=text();empty.value=!value;emit('update:value',value);mark();}
function compositionEnd(){composing=false;input();}
function keydown(event){if(composing||event.isComposing||event.keyCode===229)return;emit('keydown',event);}
function guardComposition(event){if(composing){event.preventDefault();event.stopPropagation();}}
function sync(value){
 if(!editor.value||composing)return;
 // Never replace the live DOM for an input echo: preserve selection and undo.
 if(text()!==value)editor.value.textContent=value;
 // Browsers can leave a placeholder BR after deleting the final character.
 if(!value&&editor.value.textContent==='')editor.value.replaceChildren();
 empty.value=!value;
}
watch(()=>props.value,sync);onMounted(()=>sync(props.value));
// An agent named with @ shows as a tag inside the text itself: the editor stays plain text, and the browser paints the names.
const own=Symbol('composer'),mirror=ref(null),parts=ref([]),mirrorBox=ref({});
function namesAt(t,names){
 const out=[];let plain='';
 for(let i=0;i<t.length;){
  const name=names.find(n=>t.startsWith(n,i)&&!/[\w-]/.test(t[i+n.length]||''));
  if(!name){plain+=t[i];i+=1;continue;}
  if(plain)out.push({text:plain});plain='';out.push({text:name,name:true});i+=name.length;
 }
 if(plain)out.push({text:plain});
 return out;
}
function mark(){
 if(!editor.value)return;
 const names=[...new Set(props.highlights.filter(Boolean))].sort((a,b)=>b.length-a.length),ranges=[];
 if(names.length){
  const walker=document.createTreeWalker(editor.value,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   let at=0;
   for(const x of namesAt(node.data,names)){if(x.name){const r=document.createRange();r.setStart(node,at);r.setEnd(node,at+x.text.length);ranges.push(r);}at+=x.text.length;}
  }
 }
 paintMentions(own,ranges);
 parts.value=names.length&&ranges.length?namesAt(text(),names):[];
 place();measureTall();
}
// On a computer the box puts + and send on a row of their own once the text needs
// more than one line. Measured against
// the one-row text width whichever layout shows, so the two never take turns.
const pill=ref(null),tall=ref(false),wideMedia=typeof matchMedia==='function'?matchMedia('(min-width: 768px)'):null;let ruler=null;
function measureTall(){
 if(wideMedia&&!wideMedia.matches){tall.value=false;return;}
 const e=editor.value,p=pill.value,t=text();
 if(!e||!p||!t.trim()){tall.value=false;return;}
 if(t.replace(/\n$/,'').includes('\n')){tall.value=true;return;}
 const es=getComputedStyle(e),ps=getComputedStyle(p),px=v=>parseFloat(v)||0;
 const panes=[...p.children].filter(x=>x.classList.contains('toolbar-pane')).reduce((w,x)=>w+x.offsetWidth,0);
 const room=p.clientWidth-px(ps.paddingLeft)-px(ps.paddingRight)-panes-px(es.paddingLeft)-px(es.paddingRight);
 ruler??=document.createElement('canvas').getContext('2d');
 ruler.font=`${es.fontStyle} ${es.fontWeight} ${es.fontSize} ${es.fontFamily}`;
 tall.value=ruler.measureText(t.replace(/\n$/,'')).width>room-2;
}
// The mirror takes the editor's own box and scroll, from layout, not the screen.
function place(){
 const e=editor.value;if(!e)return;
 // And its padding as it is now: the box's own rules give the editor other padding in
 // some layouts (the text after the ＋, the card over the keyboard), and a mirror on the
 // token alone put the capsule a few pixels off its name.
 const cs=getComputedStyle(e);
 mirrorBox.value={top:e.offsetTop+'px',left:e.offsetLeft+'px',width:e.offsetWidth+'px',height:e.offsetHeight+'px',padding:`${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`};
 nextTick(()=>{if(mirror.value)mirror.value.scrollTop=e.scrollTop;});
}
watch(()=>[props.value,props.highlights.join('\n')],()=>nextTick(mark));
let resized=null,widened=null;
onMounted(()=>{mark();editor.value?.addEventListener('scroll',place,{passive:true});if(typeof ResizeObserver!=='undefined'){resized=new ResizeObserver(place);resized.observe(editor.value);widened=new ResizeObserver(measureTall);widened.observe(pill.value);}});
onBeforeUnmount(()=>{paintMentions(own,[]);resized?.disconnect();widened?.disconnect();});
</script>
<style scoped>
.messagebar-area {position:relative;}
/* Laid out exactly as the editor: same box, padding, border width, font and wrapping. */
.mention-mirror {position:absolute;z-index:1;pointer-events:none;box-sizing:border-box;overflow:hidden;
 padding:var(--f7-messagebar-textarea-padding);border:var(--f7-messagebar-textarea-border);border-color:transparent;
 font-family:inherit;font-size:var(--f7-messagebar-textarea-font-size);line-height:var(--f7-messagebar-textarea-line-height);
 white-space:pre-wrap;overflow-wrap:anywhere;color:transparent;}
.mention-capsule {border-radius:999px;background:rgba(10,132,255,.22);box-shadow:0 0 0 3px rgba(10,132,255,.22);-webkit-box-decoration-break:clone;box-decoration-break:clone;}
/* Same F7 Messagebar tokens as its textarea; the glass is the box's (below). */
.chat-editor {
 box-sizing:border-box;display:block;width:100%;min-height:var(--f7-messagebar-textarea-height);
 max-height:min(30vh,208px);overflow-y:auto;overscroll-behavior:contain;
 padding:var(--f7-messagebar-textarea-padding);border:var(--f7-messagebar-textarea-border);
 border-radius:var(--f7-messagebar-textarea-border-radius);background:var(--f7-messagebar-textarea-bg-color);
 color:var(--f7-messagebar-textarea-text-color);font-family:inherit;
 font-size:var(--f7-messagebar-textarea-font-size);line-height:var(--f7-messagebar-textarea-line-height);
 white-space:pre-wrap;overflow-wrap:anywhere;outline:none;user-select:text;-webkit-user-select:text;
}
.chat-editor[data-empty="true"]::before {content:attr(data-placeholder);color:var(--f7-messagebar-textarea-placeholder-color);pointer-events:none;position:absolute;}
</style>
<style>
/* Painted by the browser over the plain text, so it has no box of its own: a tint
   and the tag colour, as the chips and the bubbles' tags have. */
::highlight(cc-mention) {color:#4da3ff;}
/* One rounded box holding +, the text and send, on a phone and a computer alike. On a phone, while the keyboard is up
   (the page's conversation-keyboard, from conversationViewport.js), it becomes a
   two-row card on top of the keyboard: the text above, + and send below. On a
   computer it takes that shape once the text needs more than one line
   (composer-tall). Unscoped, as Vue's scoped :global(.x) .y compiles to .x alone. */
.messagebar:has(> .toolbar-inner.composer-pill) {--f7-messagebar-textarea-padding:10px 8px 6px;}
.toolbar.messagebar > .toolbar-inner.composer-pill {
 display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"start area end";align-items:end;
 width:auto;margin:0 calc(12px + var(--f7-safe-area-right)) 12px calc(12px + var(--f7-safe-area-left));padding:4px;
 border-radius:24px;
 /* The glass of F7's round bar buttons (.ios .toolbar-pane, the navbar's sides). It was
    meant for the field by a scoped :global(.ios) .chat-editor rule, which compiled to
    .ios alone and so painted the page root instead. */
 background-color:var(--f7-glass-bg-color);box-shadow:var(--f7-glass-shadow);backdrop-filter:saturate(180%) blur(16px);-webkit-backdrop-filter:saturate(180%) blur(16px);
 transition:margin .22s ease,padding .22s ease,border-radius .22s ease;
}
.composer-pill > .composer-start {grid-area:start;}
.composer-pill > .messagebar-area {grid-area:area;}
.composer-pill > .composer-end {grid-area:end;}
.composer-pill > .toolbar-pane {height:auto;width:auto;align-self:end;background:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;}
.composer-pill > .composer-empty {display:none;}
.composer-pill .chat-editor {background:transparent;border-radius:0;}
.composer-pill > .composer-empty + .messagebar-area .chat-editor {padding-left:12px;}
/* On one row the text starts right after the ＋ (it sat too
   far from the left); the two-row card keeps its own inset. */
.chat-page:not(.conversation-keyboard) .toolbar-inner.composer-pill:not(.composer-tall) > .composer-start:not(.composer-empty) + .messagebar-area .chat-editor {padding-left:2px;}
.toolbar.messagebar .toolbar-inner.composer-pill:not(.composer-tall) > .composer-start .link {margin-right:0;}
.chat-page:not(.conversation-keyboard) .toolbar.messagebar > .toolbar-inner.composer-pill:not(.composer-tall) {column-gap:4px;}
/* Inside the glass box + and send are plain icons:
   no button of their own, a 40px target, feedback by opacity only. Send becomes a
   small filled circle once there is something to send. */
.composer-pill > .toolbar-pane .link {transition:opacity .15s ease;}
.composer-pill > .toolbar-pane .link:active {opacity:.5;}
@media (hover:hover) and (pointer:fine) {.composer-pill > .toolbar-pane .link:not(.disabled):hover {opacity:.7;}}
.toolbar.messagebar .composer-pill > .composer-end .link.icon-only:not(.disabled) {width:36px;min-width:36px;height:36px;min-height:36px;margin:2px;border-radius:50%;background:var(--cc-color-text);color:var(--f7-page-bg-color);}
.toolbar.messagebar .composer-pill > .composer-end .link.icon-only:not(.disabled) .icon {font-size:20px;}
@media (max-width:767px) {
 .chat-page.conversation-keyboard .toolbar.messagebar > .toolbar-inner.composer-pill {
  grid-template-columns:auto 1fr auto;grid-template-areas:"area area area" "start . end";margin:0 8px 8px;padding:6px;
 }
 .chat-page.conversation-keyboard .composer-pill .chat-editor {padding-left:12px;padding-right:12px;}
 .chat-page.conversation-keyboard .composer-pill > .toolbar-pane {animation:composer-row-in .22s ease-out;}
}
/* The computer's box keeps the old bar's column: 16px in from each side. */
@media (min-width:768px) {
 .messagebar:has(> .toolbar-inner.composer-pill) {--f7-messagebar-textarea-padding:10px 12px 6px;}
 .toolbar.messagebar > .toolbar-inner.composer-pill {margin:0 calc(16px + var(--f7-safe-area-right)) 16px calc(16px + var(--f7-safe-area-left));}
 .toolbar.messagebar > .toolbar-inner.composer-pill.composer-tall {grid-template-columns:auto 1fr auto;grid-template-areas:"area area area" "start . end";padding:6px 4px;}
 .composer-pill.composer-tall > .toolbar-pane {animation:composer-row-in .22s ease-out;}
}
@keyframes composer-row-in {from{opacity:0;transform:translateY(-6px);}}
@media (prefers-reduced-motion:reduce) {
 .toolbar.messagebar > .toolbar-inner.composer-pill {transition:none;}
 .chat-page.conversation-keyboard .composer-pill > .toolbar-pane,.composer-pill.composer-tall > .toolbar-pane {animation:none;}
}
</style>
