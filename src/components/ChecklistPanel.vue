<template>
 <!-- The agent's checklists: a workflow, to-dos,
      things still to verify. The agent keeps them with its checklist tool; the owner
      follows them here and changes them too. The circle steps an item on; a long
      press or right click has the rest. -->
 <div ref="root" class="ck">
  <p v-if="!lists.length" class="ck-empty">{{ct('還沒有清單。agent 整理出步驟、待辦或未驗證事項時會放在這裡，你也可以按右上角的＋自己建。')}}</p>
  <section v-for="list in lists" :key="list.id" class="ck-list" :data-list="list.id">
   <div class="ck-top" role="button" tabindex="0" :aria-expanded="String(isOpen(list))" @click="toggle(list)" @keydown.enter="toggle(list,true)" @contextmenu.prevent="listMenu(list,$event)" @pointerdown="press($event,()=>listMenu(list,$event))" @pointerup="release" @pointerleave="release" @pointercancel="release">
    <span class="ck-name">{{list.title}}</span>
    <span class="ck-count">{{countText(list)}}<template v-if="!isOpen(list)"> ›</template></span>
   </div>
   <div class="ck-bar" role="progressbar" :aria-valuenow="done(list)" aria-valuemin="0" :aria-valuemax="list.items.length"><i :style="{width:percent(list)+'%'}"/></div>
   <template v-if="isOpen(list)">
    <div v-for="item in list.items" :key="item.id" class="ck-item" :class="'is-'+item.status" :data-item="item.id" @contextmenu.prevent="itemMenu(list,item,$event)" @pointerdown="press($event,()=>itemMenu(list,item,$event))" @pointerup="release" @pointerleave="release" @pointercancel="release">
     <button type="button" class="ck-ic" :class="'s-'+item.status" :aria-label="ct(STATUS_LABEL[item.status])+'，'+ct('點一下切換狀態')" @click.stop="step(list,item)" @pointerdown.stop>{{ICON[item.status]}}</button>
     <div class="ck-body">
      <div class="ck-text">{{item.text}}</div>
      <div v-if="item.note" class="ck-note">{{item.note}}</div>
      <div class="ck-meta">{{item.by==='owner'?ct('你'):'agent'}} · {{when(item.updatedAt)}}</div>
     </div>
    </div>
    <form class="ck-add" @submit.prevent="addItem(list)">
     <span class="ck-ic s-add" aria-hidden="true">＋</span>
     <input v-model="drafts[list.id]" type="text" maxlength="300" :placeholder="ct('新增項目…')" :aria-label="ct('新增項目到')+' '+list.title" enterkeyhint="done"/>
    </form>
   </template>
  </section>
  <p v-if="lists.length" class="ck-legend">{{ct('點圓圈切換狀態：待做 → 進行中 → 完成；長按或按右鍵可標成卡住、改字、加說明或刪除。')}}</p>
  <GlassDropdown :open="!!menu" :point="menuPoint" :items="menu?.items||[]" @close="menu=null" @select="choose"/>
 </div>
</template>
<script>
import {timeLocale} from '../js/i18n.js';
import GlassDropdown from "./GlassDropdown.vue";
import {inject,computed,ref,reactive,onMounted,nextTick} from "vue";
import {f7} from "framework7-vue";
const ICON={todo:'',doing:'●',done:'✓',blocked:'!'};
const STATUS_LABEL={todo:'待做',doing:'進行中',done:'完成',blocked:'卡住'};
const NEXT={todo:'doing',doing:'done',done:'todo',blocked:'doing'};
const OPEN_KEY='cc-agent-checklist-open';
function readOpen(){try{return JSON.parse(localStorage.getItem(OPEN_KEY)||'{}')||{};}catch{return {};}}
// A group's lists come with their own change;
// otherwise the open agent's.
// startAtEnd: opened scrolled to the end, where the newest list is (the phone's popup), so as
// not to scroll down past every older list.
export default {components:{GlassDropdown},props:{source:Object,startAtEnd:Boolean},setup(props){
 const root=ref(null);
 onMounted(()=>{if(!props.startAtEnd)return;nextTick(()=>requestAnimationFrame(()=>{const box=root.value?.closest('.page-content');if(box)box.scrollTop=box.scrollHeight;}));});
 const w=inject("workspace");
 const lists=computed(()=>props.source?props.source.lists:w.detail.value?.checklists||[]);
 // Which lists are open is the reader's, per device. Unset, the one changed last is open.
 const opened=ref(readOpen());
 const newest=computed(()=>lists.value.reduce((a,l)=>!a||String(l.updatedAt)>=String(a.updatedAt)?l:a,null)?.id);
 const isOpen=list=>opened.value[list.id]??list.id===newest.value;
 const toggle=(list,keyboard)=>{if(pressed&&!keyboard){pressed=false;return;}pressed=false;opened.value={...opened.value,[list.id]:!isOpen(list)};try{localStorage.setItem(OPEN_KEY,JSON.stringify(opened.value));}catch{}};
 const done=list=>list.items.filter(i=>i.status==='done').length;
 const percent=list=>list.items.length?Math.round(done(list)/list.items.length*100):0;
 const countText=list=>{const n=list.items.length,d=done(list),b=list.items.filter(i=>i.status==='blocked').length;
  if(!n)return w.ct('沒有項目');if(d===n)return w.ct('全部完成');return d+'/'+n+' '+w.ct('完成')+(b?' · '+w.ct('卡住')+' '+b:'');};
 const when=iso=>{const t=Date.parse(iso||'');if(!Number.isFinite(t))return '';const m=Math.round((Date.now()-t)/60000);
  if(m<1)return w.ct('剛剛');if(m<60)return m+' '+w.ct('分鐘前');const d=new Date(t);if(Date.now()-t<86400000)return d.toLocaleTimeString(timeLocale(),{hour:'2-digit',minute:'2-digit'});return (d.getMonth()+1)+'/'+d.getDate();};
 // One change at a time: a second tap on a circle waits for the first, so it steps
// from what the server has, not from the page's older copy.
let changing=false;
const change=async body=>{if(changing)return;changing=true;try{return await (props.source?props.source.change(body):w.action('checklist',body));}finally{changing=false;}};
 const step=(list,item)=>change({listId:list.id,update:[{id:item.id,status:NEXT[item.status]}]});
 const drafts=reactive({});
 const addItem=async list=>{const text=String(drafts[list.id]||'').trim();if(!text)return;if(await change({listId:list.id,add:[{text}]}))drafts[list.id]='';};
 // A long press opens the menu; the click that ends it does nothing else.
 let timer=null,pressed=false;
 const press=(event,open)=>{if(event.pointerType==='mouse'&&event.button!==0)return;pressed=false;clearTimeout(timer);const point={clientX:event.clientX,clientY:event.clientY};timer=setTimeout(()=>{pressed=true;open(point);},550);};
 const release=()=>clearTimeout(timer);
 const menu=ref(null),menuPoint=ref({clientX:0,clientY:0});
 const openMenu=(event,target,items)=>{release();menuPoint.value={clientX:event?.clientX??0,clientY:event?.clientY??0};menu.value={...target,items};};
 const itemMenu=(list,item,event)=>openMenu(event,{list,item},[
  item.status==='blocked'?{value:'unblock',label:w.ct('取消卡住'),icon:undefined}:{value:'block',label:w.ct('標成卡住')},
  {value:'text',label:w.ct('改字')},{value:'note',label:item.note?w.ct('改說明'):w.ct('加說明')},
  {value:'remove',label:w.ct('刪除'),danger:true}]);
 const listMenu=(list,event)=>openMenu(event,{list},[{value:'rename',label:w.ct('重新命名')},{value:'delete-list',label:w.ct('刪除清單'),danger:true}]);
 const prompt=(title,value,then)=>f7.dialog.prompt('',title,v=>then(String(v??'').trim()),()=>{},value);
 const choose=value=>{const {list,item}=menu.value||{};menu.value=null;if(!list)return;
  if(value==='block')prompt(w.ct('卡在什麼？'),item.note||'',note=>change({listId:list.id,update:[{id:item.id,status:'blocked',note}]}));
  else if(value==='unblock')change({listId:list.id,update:[{id:item.id,status:'todo'}]});
  else if(value==='text')prompt(w.ct('改字'),item.text,text=>text&&change({listId:list.id,update:[{id:item.id,text}]}));
  else if(value==='note')prompt(w.ct('說明'),item.note||'',note=>change({listId:list.id,update:[{id:item.id,note}]}));
  else if(value==='remove')change({listId:list.id,remove:[item.id]});
  else if(value==='rename')prompt(w.ct('清單名稱'),list.title,title=>title&&change({listId:list.id,title}));
  else if(value==='delete-list')f7.dialog.confirm(w.ct('刪除「')+list.title+w.ct('」和裡面的所有項目？'),w.ct('刪除清單'),()=>change({listId:list.id,deleteList:true}));
 };
 return {root,ct:w.ct,lists,isOpen,toggle,done,percent,countText,when,step,drafts,addItem,press,release,menu,menuPoint,itemMenu,listMenu,choose,ICON,STATUS_LABEL};
}};
// The header's ＋: a new list, named by the reader.
// Made in the agent it was asked for, even if the reader moved on meanwhile.
export function askNewChecklist(w){const id=w.selected.value;f7.dialog.prompt('',w.ct('新清單名稱'),title=>{title=String(title??'').trim();if(title&&w.selected.value===id)w.action('checklist',{title});},()=>{},'');}
</script>
<style scoped>
.ck{font-size:15px;padding-bottom:8px}
.ck-empty{margin:18px 16px;opacity:.6;line-height:1.5}
.ck-list{margin:14px 12px 16px;background:var(--f7-list-bg-color);border-radius:14px;padding:12px 14px}
.ck-top{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.ck-name{font-weight:600;font-size:16px;flex:1;min-width:0;overflow-wrap:anywhere}
.ck-count{font-size:13px;opacity:.7;white-space:nowrap}
.ck-bar{height:6px;border-radius:3px;background:rgba(127,127,127,.25);margin:10px 0 4px;overflow:hidden}
.ck-bar i{display:block;height:100%;background:#30d158;border-radius:3px;transition:width .25s}
.ck-item{display:flex;gap:10px;padding:9px 0;border-top:1px solid rgba(127,127,127,.18);user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.ck-ic{box-sizing:border-box;flex:0 0 22px;width:22px;height:22px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;margin-top:1px;background:none;color:inherit;cursor:pointer;font-family:inherit}
.s-todo{border:2px solid rgba(127,127,127,.6)}
.s-doing{border:2px solid #0a84ff;color:#0a84ff}
.s-done{border:0;background:#30d158;color:#000}
.s-blocked{border:0;background:#ff9f0a;color:#000}
.s-add{border:2px dashed rgba(127,127,127,.6);opacity:.6;cursor:default}
.ck-body{flex:1;min-width:0;overflow-wrap:anywhere}
.ck-text{line-height:1.35}
.is-done .ck-text{opacity:.55;text-decoration:line-through}
.ck-note{font-size:13px;opacity:.7;margin-top:3px;white-space:pre-wrap}
.is-blocked .ck-note{color:#ff9f0a;opacity:1}
.ck-meta{font-size:12px;opacity:.45;margin-top:3px}
.ck-add{display:flex;gap:10px;align-items:center;padding:8px 0 2px;border-top:1px solid rgba(127,127,127,.18)}
.ck-add input{flex:1;min-width:0;background:none;border:0;outline:0;color:inherit;font:inherit;padding:4px 0}
.ck-legend{margin:0 16px 8px;font-size:12px;opacity:.55}
</style>
