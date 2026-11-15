<template><section ref="root" class="terminal-tabs" :class="['layout-'+layout,{tight,split:split2}]">
 <!-- The terminal page's tabs: Claude's own first, then shells opened with ＋
      (server/terminalShells.js). On a computer with room, two of them side by side or one
      above the other. -->
 <div class="terminal-tabbar" role="tablist" :aria-label="ct('終端機分頁')">
  <div class="terminal-tablist">
   <div class="terminal-tablist-track">
   <button v-for="t in tabs" :key="t.key" type="button" role="tab" class="terminal-tab" :class="{shown:panes.includes(t.key),current:panes[focused]===t.key}" :aria-selected="panes[focused]===t.key" :aria-label="t.label" :title="t.label" :data-tab="t.key" @click="pick(t.key)">
    <img v-if="t.key==='claude'" class="terminal-tab-avatar" :src="avatar" alt=""/><f7-icon v-else class="terminal-tab-shell" :f7="panes[focused]===t.key?'chevron_right_square_fill':'chevron_right_square'" :size="16" aria-hidden="true"/>
    <!-- Every tab is named while the row has room, Claude's too; only the current one offers
         ✕ and its whole name, the others' names are cut short, or left out when the row is
         tight; past that the row scrolls. -->
    <span class="terminal-tab-name">{{t.label}}</span>
    <span v-if="t.state==='working'" class="terminal-tab-spin" role="img" :aria-label="ct('執行中')"><SpinnerIcon/></span><span v-else class="terminal-tab-dot" :class="t.state" role="img" :aria-label="ct(t.state==='online'?'可使用':'離線')"/>
    <span v-if="t.n&&panes[focused]===t.key" class="terminal-tab-close" role="button" :aria-label="ct('關閉')+' '+t.label" :title="ct('關閉')" @click.stop="closeShell(t)"><f7-icon f7="xmark" :size="11"/></span>
   </button>
   </div>
   <button v-if="available" type="button" class="terminal-tab-add" :aria-label="ct('新增終端機')" :title="ct('新增終端機')" :disabled="opening" @click="openShell()"><f7-icon f7="plus" :size="15"/></button>
  </div>
  <div v-if="(canColumns||canRows)&&(available||tabs.length>1)" class="terminal-layouts" role="group" :aria-label="ct('排列方式')">
   <button type="button" class="terminal-layout" :class="{active:shownLayout==='single'}" :aria-pressed="shownLayout==='single'" :title="ct('單一')" :aria-label="ct('單一')" @click="setLayout('single')"><f7-icon f7="rectangle" :size="15"/></button>
   <button v-if="canColumns" type="button" class="terminal-layout" :class="{active:shownLayout==='columns'}" :aria-pressed="shownLayout==='columns'" :title="ct('左右分割')" :aria-label="ct('左右分割')" @click="setLayout('columns')"><f7-icon f7="square_split_2x1" :size="15"/></button>
   <button v-if="canRows" type="button" class="terminal-layout" :class="{active:shownLayout==='rows'}" :aria-pressed="shownLayout==='rows'" :title="ct('上下分割')" :aria-label="ct('上下分割')" @click="setLayout('rows')"><f7-icon f7="square_split_1x2" :size="15"/></button>
  </div>
 </div>
 <div ref="body" class="terminal-tabs-body" :style="{'--terminal-split':split}">
  <template v-for="(key,i) in shownPanes" :key="key">
   <div v-if="i===1" class="terminal-split-divider" role="separator" :aria-orientation="layout==='rows'?'horizontal':'vertical'" :aria-label="ct('拖曳調整大小')" :title="ct('拖曳調整大小，按兩下恢復')" @pointerdown.prevent="startDrag" @dblclick="split=.5;write('cc-terminal-split',.5)"/>
   <div class="terminal-tabs-cell" :class="{focused:split2&&paneIndex(key)===focused}" @pointerdown.capture="focusPane(key)" @focusin="focusPane(key)">
    <TerminalPane :ref="el=>setPane(key,el)" :conversation-id="conversationId" :shell="shellOf(key)" :label="tabOf(key)?.label" :path="key==='claude'?folder:tabOf(key)?.cwd" :focused="split2&&paneIndex(key)===focused" :choosable="split2" @choose="(e)=>openChoice(key,e)" :autofocus="!split2||paneIndex(key)===focused" :accept-files="acceptFiles" @files="(f)=>emit('files',f)"/>
   </div>
  </template>
 </div>
 <GlassDropdown :open="choiceOpen" :point="choicePoint" :items="choiceItems" :selected="choiceFor" @close="choiceOpen=false" @select="(v)=>{choiceOpen=false;showIn(choiceFor,v);}"/>
</section></template>

<script setup>
import {ref,computed,onMounted,onUnmounted,watch} from 'vue';
import {f7} from 'framework7-vue';
import TerminalPane from '../TerminalPane.vue';
import SpinnerIcon from './SpinnerIcon.vue';
import GlassDropdown from './GlassDropdown.vue';
import {ct} from '../js/agent-i18n.js';
import {api} from '../js/api.js';

const props=defineProps({conversationId:String,acceptFiles:Boolean,avatar:String,agentState:String});
const emit=defineEmits(['files']);
const root=ref(null),body=ref(null);
const shells=ref([]),available=ref(true),folder=ref(''),opening=ref(false);
const tabs=computed(()=>[{key:'claude',label:'Claude',state:props.agentState||'offline'},...shells.value.map(s=>({key:'sh'+s.n,n:s.n,label:shellLabel(s)||ct('終端機')+' '+s.n,cwd:s.cwd,state:s.busy?'working':'online'}))]);
// A shell's tab is named after the folder it is in now, as a terminal app's tab is, read
// every few seconds with the list.
// While a program runs, its tab is named as a terminal app names it: the title the program
// gave itself and the program, "Claude Code (claude)", or the program alone. A shell's own
// prompt title ("user@host:~/dir") is not a program's.
function shellLabel(s){
 if(!(s.running||s.busy)||!s.command)return folderName(s.cwd);
 const title=s.title||'';
 if(!title||/^[^\s@]+@[^\s:]+:/.test(title)||title.toLowerCase()===s.command.toLowerCase())return s.command;
 // The shell's own title for a command line ("npm run dev") already names it.
 if(title.split(/\s/)[0]===s.command)return title;
 return title+' ('+s.command+')';
}
const folderName=cwd=>cwd==='~'?'~':String(cwd||'').split('/').filter(Boolean).pop()||'';
// Which shell a pane attaches to comes from its key, not the list: a pane remembered from
// before is put back before the list has come, and attached to Claude's terminal under a
// shell's tab.
const shellOf=key=>/^sh[1-9]\d{0,5}$/.test(key)?Number(key.slice(2)):null;
const tabOf=key=>tabs.value.find(t=>t.key===key);

// What each pane shows, and which one typing goes to; kept per agent in this browser.
const STORE='cc-terminal-tabs:'+props.conversationId;
const read=(k,fallback)=>{try{const v=JSON.parse(localStorage.getItem(k));return v??fallback;}catch{return fallback;}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};
const saved=read(STORE,{});
const panes=ref(Array.isArray(saved.panes)&&saved.panes.length?saved.panes.slice(0,2):['claude']);
const focused=ref(saved.focused===1&&panes.value.length>1?1:0);
const layout=ref(read('cc-terminal-layout','single'));
const split=ref(read('cc-terminal-split',0.5));
watch([panes,focused],()=>write(STORE,{panes:panes.value,focused:focused.value}),{deep:true});
// The current tab stays in view when the row is scrolled.
watch(()=>panes.value[focused.value],key=>requestAnimationFrame(()=>root.value?.querySelector(`.terminal-tab[data-tab="${key}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'})));

// Two panes only where each still has room, and never on a touch screen.
const size=ref({w:0,h:0});
const touch=typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches;
// Many tabs in a narrow row: the ones not chosen show their icon alone, named on hover.
const tight=computed(()=>size.value.w>0&&size.value.w<130*tabs.value.length);
const canColumns=computed(()=>!touch&&size.value.w>=720);
const canRows=computed(()=>!touch&&size.value.h>=480&&size.value.w>=420);
const effective=computed(()=>layout.value==='columns'&&canColumns.value?'columns':layout.value==='rows'&&canRows.value?'rows':'single');
// The layout as it shows: one pane when there is nothing to put beside Claude's, so the
// split button does not stay lit with Claude's tab alone.
const shownLayout=computed(()=>split2.value?effective.value:'single');
const split2=computed(()=>effective.value!=='single'&&panes.value.length>1);
const shownPanes=computed(()=>split2.value?panes.value:[panes.value[focused.value]||'claude']);
const paneIndex=key=>panes.value.indexOf(key);

const paneEls=new Map();
const setPane=(key,el)=>{if(el)paneEls.set(key,el);else paneEls.delete(key);};
function focusPane(key){const i=paneIndex(key);if(i>=0)focused.value=i;}

// A tab goes into the pane typing goes to; one already showing is focused instead.
function pick(key){
 const i=paneIndex(key);
 if(i>=0){focused.value=i;}
 else if(split2.value){panes.value[focused.value]=key;}
 else{panes.value[focused.value]=key;}
 requestAnimationFrame(()=>paneEls.get(key)?.focus());
}
// In a split, the switch at a pane's right lists the tabs to show in it, with no clicking the
// pane first, then a tab; one shown in the other pane changes places.
const choiceOpen=ref(false),choicePoint=ref(null),choiceFor=ref('');
const choiceItems=computed(()=>tabs.value.map(t=>({value:t.key,label:t.label})));
function openChoice(key,e){const r=(e?.target?.closest?.('.terminal-choose')||e?.currentTarget)?.getBoundingClientRect?.();choiceFor.value=key;choicePoint.value=r?{clientX:r.right,clientY:r.bottom}:{clientX:e?.clientX??0,clientY:e?.clientY??0};choiceOpen.value=true;}
function showIn(was,key){
 const i=paneIndex(was);if(i<0||was===key)return;
 const j=paneIndex(key),next=[...panes.value];
 if(j>=0)next[j]=was;next[i]=key;panes.value=next;focused.value=i;
 requestAnimationFrame(()=>paneEls.get(key)?.focus());
}
async function setLayout(next){
 layout.value=next;write('cc-terminal-layout',next);
 if(next==='single')return;
 // Splitting with a single tab opens a shell for the other side.
 if(panes.value.length<2){const other=tabs.value.find(t=>!panes.value.includes(t.key));if(other)panes.value.push(other.key);else await openShell(true);}
}

async function load(){
 try{const r=await api('/conversations/'+props.conversationId+'/shells');shells.value=r.shells||[];available.value=r.available!==false;folder.value=r.folder||'';}
 catch{return;}
 // Claude's tab alone: back to one pane, as chosen.
 if(!shells.value.length&&layout.value!=='single'){layout.value='single';write('cc-terminal-layout','single');}
 // A shell that exited, or was closed, leaves its pane to a tab not shown yet, if any,
 // as an editor's pane does; else the pane goes.
 const known=new Set(tabs.value.map(t=>t.key));
 if(panes.value.every(k=>known.has(k)))return;
 const spare=tabs.value.map(t=>t.key).filter(k=>!panes.value.includes(k));
 const next=panes.value.map(k=>known.has(k)?k:spare.shift()).filter(Boolean);
 panes.value=next.length?next:['claude'];if(focused.value>=panes.value.length)focused.value=0;
}
async function openShell(second=false){
 if(opening.value)return;opening.value=true;
 try{const s=await api('/conversations/'+props.conversationId+'/shells',{method:'POST'});await load();const key='sh'+s.n;
  if(second&&panes.value.length<2){panes.value.push(key);focused.value=1;}else pick(key);
 }catch(e){f7.dialog.alert(ct(e.message));}finally{opening.value=false;}
}
function closeShell(t){
 const go=async()=>{try{await api('/conversations/'+props.conversationId+'/shells/'+t.n,{method:'DELETE'});}catch(e){if(e.status!==404)return f7.dialog.alert(ct(e.message));}await load();};
 // A program still running in it ends with it: asked first.
 if(t.state==='working')f7.dialog.confirm(ct('裡面正在執行的程式會一起結束。'),ct('關閉')+' '+t.label+'？',go);else go();
}

// The divider between two panes, as the conversation and terminal one is dragged.
function startDrag(e){
 const box=body.value.getBoundingClientRect(),rows=effective.value==='rows';
 const move=ev=>{const r=rows?(ev.clientY-box.top)/box.height:(ev.clientX-box.left)/box.width;split.value=Math.min(.8,Math.max(.2,r));};
 const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);write('cc-terminal-split',split.value);};
 window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
}

// What the page pastes (a dropped file's path) goes to the pane typing goes to.
function paste(text){return paneEls.get(shownPanes.value[split2.value?focused.value:0])?.paste(text)??false;}
defineExpose({paste});

let observer,timer;
const visible=()=>{if(!document.hidden)load();};
onMounted(()=>{observer=new ResizeObserver(([e])=>{size.value={w:e.contentRect.width,h:e.contentRect.height};});observer.observe(root.value);load();timer=setInterval(()=>{if(!document.hidden)load();},4000);document.addEventListener('visibilitychange',visible);});
onUnmounted(()=>{observer?.disconnect();clearInterval(timer);document.removeEventListener('visibilitychange',visible);});
</script>

<style scoped>
.terminal-tabs {display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;background:#121212;color:#ececec;}
/* Built like the app's other switches (chatPage.css .view-switch, the bottom nav): a
   rounded translucent track with the current tab as a raised pill, not editor-style tabs. */
.terminal-tabbar {flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 12px;background:#121212;}
.terminal-tablist {flex:1;min-width:0;display:flex;align-items:center;gap:2px;}
.terminal-tablist-track {min-width:0;display:flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:rgba(255,255,255,.08);overflow-x:auto;scrollbar-width:none;}
.terminal-tablist-track::-webkit-scrollbar {display:none;}
.terminal-tab {flex:0 0 auto;width:auto;margin:0;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:0;border-radius:999px;background:transparent;color:rgba(255,255,255,.6);font-size:13px;font-weight:500;line-height:1;text-transform:none;cursor:pointer;transition:background-color .2s,color .2s;-webkit-user-select:none;user-select:none;}
.terminal-tab-name {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:56px;}
.terminal-tab.current .terminal-tab-name {max-width:140px;}
.tight .terminal-tab:not(.current) .terminal-tab-name {display:none;}
.tight .terminal-tab:not(.current) {padding:0 9px;}
.terminal-tab.shown {color:rgba(255,255,255,.85);}
/* The current one lifted only a little, as the list's open agent is. */
.terminal-tab.current {color:#fff;background:rgba(255,255,255,.11);box-shadow:0 1px 3px rgba(0,0,0,.35);}
.terminal-tab-avatar {width:16px;height:16px;border-radius:5px;object-fit:cover;}
.terminal-tab-shell {flex:0 0 auto;color:inherit;}
.terminal-tab-dot {flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#8e8e93;}
.terminal-tab-dot.online {background:#34c759;}
.terminal-tab-dot.working {background:#ff9500;}
/* Something running turns, as the list's agents do. */
.terminal-tab-spin {flex:0 0 auto;display:inline-flex;color:#ff9500;}
.terminal-tab-spin :deep(.spinner-icon-box) {font-size:13px;}
.terminal-tab-close {display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-right:-6px;border-radius:50%;color:rgba(255,255,255,.5);}
.terminal-tab-close:hover {background:rgba(255,255,255,.16);color:#fff;}
.terminal-tab-add,.terminal-layout {flex:0 0 auto;width:34px;height:34px;margin:0;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;cursor:pointer;}
.terminal-tab-add {margin-left:6px;}
.terminal-tab-add:disabled {opacity:.4;}
.terminal-layouts {flex:0 0 auto;display:flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:rgba(255,255,255,.08);}
.terminal-layout {width:30px;height:30px;background:transparent;color:rgba(255,255,255,.55);}
.terminal-layout.active {color:#fff;background:rgba(255,255,255,.11);box-shadow:0 1px 3px rgba(0,0,0,.35);}
.terminal-tabs-body {flex:1;min-height:0;display:flex;}
/* Split, each pane is a card of its own with rounded corners, a hairline edge and the page
   showing between them; the gap is the divider. */
.terminal-tabs.split .terminal-tabs-body {padding:0 8px 8px;}
.terminal-tabs.split .terminal-tabs-cell {border-radius:12px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);}
.layout-rows .terminal-tabs-body {flex-direction:column;}
.terminal-tabs-cell {flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;}
.terminal-tabs-cell:first-child {flex-grow:0;flex-basis:calc(var(--terminal-split) * 100%);}
.terminal-tabs-cell:only-child {flex:1 1 0;}
/* In a split, the pane typing goes to has a thin frame of the app's blue, so nothing is sent
   to the wrong one. */
.terminal-tabs-cell {position:relative;}
.terminal-tabs-cell.focused::after {content:'';position:absolute;inset:0;pointer-events:none;z-index:2;border-radius:inherit;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--cc-accent-blue,var(--f7-theme-color)) 60%,transparent);}
.terminal-split-divider {flex:0 0 8px;background:transparent;cursor:col-resize;touch-action:none;position:relative;}
/* No grip drawn: the gap itself drags. */
.layout-rows .terminal-split-divider {cursor:row-resize;}
.terminal-tabs-cell :deep(.terminal-bar) {border-bottom:1px solid rgba(255,255,255,.06);}
</style>
