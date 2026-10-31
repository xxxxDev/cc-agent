<template>
 <!-- The admin's split view (experimental): the page
      divides into rows × columns chosen on a grid picker, and each cell shows one
      agent's conversation, drawn natively (components/SplitCell.vue) with the same
      bubbles as the conversation page; it sends, interrupts and scrolls back. -->
 <div class="split-view">
  <header class="split-bar">
   <a class="split-back external" href="/" :aria-label="ct('返回 Agents 清單')" @click.prevent="leave('/')"><i class="icon f7-icons">chevron_left</i><span>Agents</span></a>
   <span class="split-title">{{ct('分割畫面')}}<small>{{ct('實驗')}}</small></span>
   <div class="split-size" @mouseleave="hover=null">
    <button type="button" class="split-size-button" :aria-expanded="String(picking)" @click="picking=!picking">
     <i class="icon f7-icons">square_grid_2x2</i><span>{{rows}} × {{cols}}</span>
    </button>
    <div v-if="picking" class="split-picker" role="grid" :aria-label="ct('選擇分割方式')">
     <div v-for="r in MAX" :key="'r'+r" class="split-picker-row" role="row">
      <button v-for="c in MAX" :key="'c'+c" type="button" role="gridcell" class="split-picker-cell"
       :class="{lit:(hover?r<=hover.r&&c<=hover.c:r<=rows&&c<=cols)}" :aria-label="r+' × '+c"
       @mouseenter="hover={r,c}" @focus="hover={r,c}" @click="choose(r,c)"/>
     </div>
     <p class="split-picker-label">{{(hover||{r:rows,c:cols}).r}} × {{(hover||{r:rows,c:cols}).c}}</p>
    </div>
   </div>
  </header>

  <p v-if="!allowed" class="split-note">{{ct('分割畫面只提供給管理員，在電腦寬度使用。')}}</p>
  <div v-else ref="grid" class="split-grid" :class="{dragging:!!dragging}" :style="{gridTemplateColumns:colSizes.map(f=>'minmax(0,'+f+'fr)').join(' '),gridTemplateRows:rowSizes.map(f=>'minmax(0,'+f+'fr)').join(' ')}">
   <section v-for="(id,index) in cells" :key="index+':'+(id||'')" class="split-cell">
    <div class="split-cell-bar">
     <span v-if="id" class="split-presence" :class="presence[id]||'offline'" role="img" :aria-label="ct(presence[id]==='working'?'Agent 正在處理':presence[id]==='online'?'Agent 在線':'Agent 離線')" :title="ct(presence[id]==='working'?'Agent 正在處理':presence[id]==='online'?'Agent 在線':'Agent 離線')"/>
     <select :value="id||''" :aria-label="ct('這一格顯示的 Agent')" @change="assign(index,$event.target.value)">
      <option value="">{{ct('選擇 Agent')}}</option>
      <optgroup v-for="section in sections" :key="section.label" :label="section.label"><option v-for="a in section.agents" :key="a.id" :value="a.id">{{a.title}}</option></optgroup>
     </select>
     <!-- The cell's terminal, as on the conversation page, when an admin has the
          chat/terminal switch on on the Admin tab. -->
     <button v-if="id&&terminalSwitch" type="button" class="split-cell-terminal" :class="{on:terminalCells.has(index)}" :aria-pressed="String(terminalCells.has(index))" :title="terminalCells.has(index)?ct('回到聊天室'):ct('開啟 Claude 終端機')" :aria-label="terminalCells.has(index)?ct('回到聊天室'):ct('開啟 Claude 終端機')" @click="toggleTerminal(index)"><i class="icon f7-icons">chevron_left_slash_chevron_right</i></button>
     <!-- What the conversation's navbar holds besides: its checklists, search, Agent
          Profile and Transcript, in the cell's side column. -->
     <button v-if="id" type="button" class="split-cell-more" :class="{on:!!panels[index]}" :aria-label="ct('更多')" :title="ct('更多')" @click="openMore(index,$event)"><i class="icon f7-icons">ellipsis</i></button>
     <a v-if="id" class="split-cell-open external" :href="'/?conversation='+id" @click.prevent="leave('/?conversation='+encodeURIComponent(id))" :title="ct('單獨打開這個 Agent')" :aria-label="ct('單獨打開這個 Agent')"><i class="icon f7-icons">arrow_up_right_square</i></a>
    </div>
    <SplitCell v-if="id" :key="id" :conversation-id="id" :terminal="terminalSwitch&&terminalCells.has(index)" :panel="panels[index]||null"
     @close-panel="setPanel(index,null)" @open-terminal="terminalSwitch&&!terminalCells.has(index)&&toggleTerminal(index)" @presence="presence={...presence,[id]:$event}"
     @open-peer="leave('/?conversation='+encodeURIComponent($event))" @open-group="leave('/?group='+encodeURIComponent($event))"/>
    <p v-else class="split-empty">{{ct('從上方選一個 Agent')}}</p>
   </section>
   <!-- Dividers between the columns and between the rows: dragged, they share the
        width or the height between their two neighbours; a double click evens them
        out. While one is dragged a clear layer
        covers the cells, so a cell's page cannot take the pointer. -->
   <div v-for="(at,i) in colEdges" :key="'c'+i" class="split-divider vertical" :style="{left:'calc('+at+'% - 5px)'}" role="separator" aria-orientation="vertical" :aria-label="ct('拖曳調整欄寬')" @pointerdown="startDrag($event,'col',i)" @dblclick="evenOut('col',i)"/>
   <div v-for="(at,i) in rowEdges" :key="'r'+i" class="split-divider horizontal" :style="{top:'calc('+at+'% - 5px)'}" role="separator" aria-orientation="horizontal" :aria-label="ct('拖曳調整列高')" @pointerdown="startDrag($event,'row',i)" @dblclick="evenOut('row',i)"/>
   <div v-if="dragging" class="split-drag-cover" :class="dragging"/>
  </div>
  <GlassDropdown :open="moreFor!==null" :point="morePoint" :items="moreItems" :selected="moreFor!==null?panels[moreFor]||undefined:undefined" @close="moreFor=null" @select="pickMore"/>
 </div>
</template>
<script setup>
import {ref,computed,onMounted,onUnmounted,watch} from 'vue';
import {api} from '../js/api.js';
import SplitCell from './SplitCell.vue';
import GlassDropdown from './GlassDropdown.vue';
import {terminalSwitch,transcriptSwitch,loadAgentPreferences,loadListPreferences,listGroups} from '../js/agentPreferences.js';
import {agentSections} from '../js/agentSections.js';
import {ct} from '../js/agent-i18n.js';
import {currentUser} from '../js/auth.js';

const MAX=4;
const KEY='cc-split-layout';
function saved(){try{const v=JSON.parse(localStorage.getItem(KEY)||'null');if(v&&Number.isInteger(v.rows)&&Number.isInteger(v.cols))return v;}catch{}return {rows:1,cols:2,cells:[]};}
const start=saved();
const rows=ref(Math.min(MAX,Math.max(1,start.rows))),cols=ref(Math.min(MAX,Math.max(1,start.cols)));
// Each column's and row's share, in fr: even unless dragged, kept with the layout.
const even=n=>Array.from({length:n},()=>1);
const sizes=(list,n)=>Array.isArray(list)&&list.length===n&&list.every(f=>Number.isFinite(f)&&f>0)?list:even(n);
const colSizes=ref(sizes(start.colSizes,cols.value)),rowSizes=ref(sizes(start.rowSizes,rows.value));
const edges=list=>{const total=list.reduce((a,b)=>a+b,0);let run=0;return list.slice(0,-1).map(f=>{run+=f;return run/total*100;});};
const colEdges=computed(()=>edges(colSizes.value)),rowEdges=computed(()=>edges(rowSizes.value));
const grid=ref(null),dragging=ref('');
const MIN_SHARE=.12;
function startDrag(event,kind,i){
 const box=grid.value?.getBoundingClientRect();if(!box)return;
 event.preventDefault();
 const handle=event.currentTarget;try{handle.setPointerCapture(event.pointerId);}catch{}
 const list=kind==='col'?colSizes:rowSizes,total=list.value.reduce((a,b)=>a+b,0);
 const before=list.value.slice(0,i).reduce((a,b)=>a+b,0)/total,pair=(list.value[i]+list.value[i+1])/total;
 dragging.value=kind==='col'?'vertical':'horizontal';
 const move=e=>{
  const at=kind==='col'?(e.clientX-box.left)/box.width:(e.clientY-box.top)/box.height;
  const share=Math.min(pair-MIN_SHARE,Math.max(MIN_SHARE,at-before));
  const next=[...list.value];next[i]=share*total;next[i+1]=(pair-share)*total;list.value=next;
 };
 const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);dragging.value='';persist();};
 handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
}
// Which cells have their terminal open: asked for each time, not kept.
const terminalCells=ref(new Set());
function toggleTerminal(index){const next=new Set(terminalCells.value);if(next.has(index))next.delete(index);else next.add(index);terminalCells.value=next;}
// Each cell's side column, one at a time, asked for each time as the terminal is.
const panels=ref({}),moreFor=ref(null),morePoint=ref({clientX:0,clientY:0}),presence=ref({});
function setPanel(index,name){panels.value={...panels.value,[index]:name};}
function openMore(index,event){const r=event.currentTarget.getBoundingClientRect();morePoint.value={clientX:r.left+r.width/2,clientY:r.bottom};moreFor.value=index;}
// The Transcript as on the conversation page: an admin's, for a Claude Code agent,
// once switched on on the Admin tab.
const moreItems=computed(()=>{
 const agent=moreFor.value===null?null:agents.value.find(a=>a.id===cells.value[moreFor.value]);
 return [{value:'checklist',f7:'checkmark_square',label:ct('清單')},{value:'search',f7:'search',label:ct('搜尋這個對話')},{value:'profile',f7:'info',label:'Agent Profile'},
  ...(transcriptSwitch.value&&agent?.mode==='claude'?[{value:'inspector',f7:'ant',label:ct('Transcript 檢視')}]:[])];
});
function pickMore(value){const index=moreFor.value;moreFor.value=null;if(index!==null)setPanel(index,panels.value[index]===value?null:value);}
function evenOut(kind,i){const list=kind==='col'?colSizes:rowSizes;const next=[...list.value],half=(next[i]+next[i+1])/2;next[i]=half;next[i+1]=half;list.value=next;persist();}
const ids=ref(Array.isArray(start.cells)?start.cells.map(v=>typeof v==='string'&&v?v:null):[]);
const cells=computed(()=>Array.from({length:rows.value*cols.value},(_,i)=>ids.value[i]||null));
const picking=ref(false),hover=ref(null),agents=ref([]);
// Grouped as the Agents list is (agentSections.js).
const sections=computed(()=>agentSections(agents.value,listGroups.value));
const wide=ref(typeof matchMedia==='function'?matchMedia('(min-width: 1024px)').matches:true);
const allowed=computed(()=>currentUser.value?.role==='admin'&&wide.value);

function persist(){try{localStorage.setItem(KEY,JSON.stringify({rows:rows.value,cols:cols.value,cells:cells.value,colSizes:colSizes.value,rowSizes:rowSizes.value}));}catch{}}
function choose(r,c){panels.value={};rows.value=r;cols.value=c;colSizes.value=even(c);rowSizes.value=even(r);picking.value=false;hover.value=null;persist();}
function assign(index,id){setPanel(index,null);const next=[...cells.value];next[index]=id||null;ids.value=next;persist();}
// A real page load: F7 routes an ordinary link inside the app, which kept the split
// view on screen.
function leave(to){location.assign(to);}

let query,track,refresh;
async function loadAgents(){try{agents.value=(await api('/conversations')).conversations||[];}catch{}}
onMounted(()=>{
 document.title=ct('分割畫面')+' · CC Agent';
 if(typeof matchMedia==='function'){query=matchMedia('(min-width: 1024px)');track=()=>{wide.value=query.matches;};query.addEventListener('change',track);}
 loadAgents();refresh=setInterval(loadAgents,15000);
 if(currentUser.value?.role==='admin')loadAgentPreferences().catch(()=>{});
 loadListPreferences().catch(()=>{});
});
onUnmounted(()=>{query?.removeEventListener('change',track);clearInterval(refresh);});
watch(()=>currentUser.value?.id,loadAgents);
</script>
<style scoped>
.split-view {position:fixed;inset:0;display:flex;flex-direction:column;background:var(--f7-page-bg-color,#121212);color:var(--cc-color-text,#fff);z-index:100;}
.split-bar {display:flex;align-items:center;gap:16px;height:52px;padding:0 16px;flex:0 0 auto;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent);}
.split-back {display:flex;align-items:center;gap:4px;color:inherit;text-decoration:none;}
.split-title {font-weight:600;display:flex;align-items:baseline;gap:8px;flex:1;}
.split-title small {font-weight:400;font-size:12px;color:var(--cc-color-text-secondary,#999);border:1px solid currentColor;border-radius:6px;padding:0 6px;}
.split-size {position:relative;}
.split-size-button {display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:17px;border:0;background:color-mix(in srgb,currentColor 12%,transparent);color:inherit;font:inherit;cursor:pointer;}
.split-picker {position:absolute;right:0;top:42px;padding:12px;border-radius:14px;background:var(--f7-page-bg-color,#1c1c1e);box-shadow:0 10px 30px rgba(0,0,0,.45);z-index:10;}
.split-picker-row {display:flex;gap:4px;margin-bottom:4px;}
.split-picker-cell {width:26px;height:26px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:transparent;padding:0;cursor:pointer;}
.split-picker-cell.lit {background:var(--cc-color-accent,#d97757);border-color:transparent;}
.split-picker-label {margin:8px 0 0;text-align:center;font-size:13px;}
.split-note {margin:32px;}
.split-grid {position:relative;flex:1;min-height:0;display:grid;gap:1px;background:color-mix(in srgb,currentColor 14%,transparent);}
.split-divider {position:absolute;z-index:5;touch-action:none;}
.split-divider.vertical {top:0;bottom:0;width:10px;cursor:col-resize;}
.split-divider.horizontal {left:0;right:0;height:10px;cursor:row-resize;}
.split-divider::after {content:'';position:absolute;border-radius:1px;background:var(--cc-color-accent,#d97757);opacity:0;transition:opacity .15s;}
.split-divider.vertical::after {left:4px;top:0;bottom:0;width:2px;}
.split-divider.horizontal::after {top:4px;left:0;right:0;height:2px;}
.split-divider:hover::after,.split-grid.dragging .split-divider::after {opacity:.8;}
.split-drag-cover {position:absolute;inset:0;z-index:4;}
.split-drag-cover.vertical {cursor:col-resize;}
.split-drag-cover.horizontal {cursor:row-resize;}
.split-grid.dragging {-webkit-user-select:none;user-select:none;}
.split-cell {display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--f7-page-bg-color,#121212);}
.split-cell-bar {display:flex;align-items:center;gap:8px;height:36px;padding:0 8px;flex:0 0 auto;}
.split-cell-bar select {flex:1;min-width:0;height:28px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;font:inherit;padding:0 6px;}
/* Framework7 colours a dark option but not its group, which Windows drew as a pale band with the name unreadable. */
.split-cell-bar option,.split-cell-bar optgroup {background:var(--f7-page-bg-color,#121212);}
.split-cell-open {display:flex;color:inherit;opacity:.75;}
.split-presence {flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:#8e8e93;}
.split-presence.online {background:#34c759;}
.split-presence.working {background:#ff9500;}
.split-cell-more {display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;opacity:.75;cursor:pointer;}
.split-cell-more.on {opacity:1;background:color-mix(in srgb,currentColor 14%,transparent);}
.split-cell-more .icon {font-size:18px;}
.split-cell-terminal {display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;opacity:.75;cursor:pointer;}
.split-cell-terminal.on {opacity:1;background:color-mix(in srgb,currentColor 14%,transparent);}
.split-cell-terminal .icon {font-size:18px;}
.split-empty {margin:auto;color:var(--cc-color-text-secondary,#999);}
</style>
