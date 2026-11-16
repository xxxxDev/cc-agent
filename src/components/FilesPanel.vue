<template>
 <!-- The conversation's files: every file you sent and every file the agent sent, the
      terminal's too, newest first. Each row goes to the bubble
      that carries it, downloads it, or deletes it for good. A deleted one stays on the list,
      greyed and marked, so what was there is still known; it has no actions left. -->
 <div class="fp">
  <p v-if="error" class="fp-empty" role="alert">{{error}}</p>
  <div v-else-if="loading&&!files.length" class="fp-empty fp-loading"><f7-preloader :size="20"/></div>
  <p v-else-if="!files.length" class="fp-empty">{{ct('這個對話還沒有檔案。你或 agent 傳的檔案都會列在這裡。')}}</p>
  <div v-else class="fp-list">
   <div v-for="file in files.slice(0,shownCount)" :key="file.id" class="fp-row" :class="{removed:file.removed}" :data-file="file.id">
    <!-- A picture or a video shows itself at the left; any other
         file, a deleted one, or one that cannot be drawn here keeps its kind's icon. -->
    <!-- A still made once on the server, not a video's first frame drawn again on every
         opening. A row opens the file's preview, as its bubble does. -->
    <button type="button" class="fp-open" :disabled="file.removed" :aria-label="ct('預覽')+' '+file.name" @click="open(file)">
    <FileThumb :file="file" :url="url(file)"/>
    <div class="fp-body">
     <div class="fp-name" :title="file.name">{{file.name}}</div>
     <div class="fp-meta"><template v-if="file.removed">{{ct('已刪除')}} · </template>{{size(file.size)}} · {{who(file)}} · {{when(file.at)}}</div>
    </div>
    </button>
    <div v-if="!file.removed" class="fp-actions">
     <button type="button" class="fp-act fp-jump" :aria-label="ct('到這則訊息')+' '+file.name" v-tip="ct('到這則訊息')" @click="jump(file)"><i class="icon f7-icons">bubble_left</i></button>
     <a class="fp-act fp-download external" :href="url(file)" :download="file.name" target="_blank" rel="noopener" :aria-label="ct('下載')+' '+file.name" v-tip="ct('下載')" @click="onDownload(file,$event)"><i class="icon f7-icons">arrow_down_circle</i></a>
     <button v-if="canDelete" type="button" class="fp-act fp-delete" :disabled="deleting.has(file.id)" :aria-label="ct('刪除檔案')+' '+file.name" v-tip="ct('刪除檔案')" @click="remove(file)"><i class="icon f7-icons">trash</i></button>
    </div>
   </div>
   <div v-if="files.length>shownCount" ref="more" class="fp-more"><f7-preloader :size="16"/></div>
  </div>
  <AttachmentPreview :file="previewing" :conversation-id="id" @close="previewing=null" @change="previewing=$event"/>
 </div>
</template>
<script setup>
import {escapeHtml} from '../js/safeDialog.js';
import {inject,ref,computed,watch,onBeforeUnmount} from 'vue';
import {f7} from 'framework7-vue';
import {api} from '../js/api.js';
import {ct} from '../js/agent-i18n.js';
import {timeLocale} from '../js/i18n.js';
import {sharesFiles} from '../js/saveFile.js';import {saveWithProgress} from '../js/saveWithProgress.js';
import AttachmentPreview from './AttachmentPreview.vue';
import FileThumb from './FileThumb.vue';
const w=inject('workspace');
const files=ref([]),loading=ref(false),error=ref(''),deleting=ref(new Set());
const id=computed(()=>w.detail.value?.id||'');
// Deleting a sent file is for good, so it is an admin's (the route says so too).
const canDelete=computed(()=>w.user.value?.role==='admin'&&!w.detail.value?.archived);
let asked=0;
async function load(){
 const conversation=id.value,run=++asked;if(!conversation){files.value=[];return;}
 loading.value=true;
 try{const r=await api('/conversations/'+conversation+'/files');if(run===asked){files.value=r.files||[];error.value='';}}
 catch(e){if(run===asked)error.value=ct(e.message);}
 finally{if(run===asked)loading.value=false;}
}
// A new file comes with a new bubble or a changed one: the newest bubble and the files the
// page holds say so, and the list is asked again.
const shown=computed(()=>{const m=w.detail.value?.messages||[];return id.value+'|'+(m.at(-1)?.id||'')+'|'+m.reduce((n,x)=>n+(x.attachments?.length||0),0);});
watch(shown,load,{immediate:true});
onBeforeUnmount(()=>{asked++;});
const url=file=>'/api/conversations/'+id.value+'/attachments/'+file.id;
const size=n=>!Number.isFinite(n)?'':n<1024?n+' B':n<1024*1024?(n/1024).toFixed(1)+' KB':(n/1024/1024).toFixed(1)+' MB';
const who=file=>file.from==='you'?ct('你'):file.from==='outside'?ct('外部對話'):file.from==='peer'?ct('另一台電腦'):(w.detail.value?.title||'agent');
const when=iso=>{const t=Date.parse(iso||'');if(!Number.isFinite(t))return '';const d=new Date(t),today=new Date();
 return d.toDateString()===today.toDateString()?d.toLocaleTimeString(timeLocale(),{hour:'2-digit',minute:'2-digit',hour12:false}):d.toLocaleDateString(timeLocale(),{year:d.getFullYear()===today.getFullYear()?undefined:'numeric',month:'numeric',day:'numeric'});};
// A thousand files drawn at once froze an iPhone: the list draws a page and the next when
// its end comes near.
const PAGE=60,shownCount=ref(PAGE),more=ref(null);
let seen=null;
watch(more,el=>{seen?.disconnect();seen=null;if(!el||typeof IntersectionObserver==='undefined')return;
 seen=new IntersectionObserver(e=>{if(e.some(x=>x.isIntersecting))shownCount.value+=PAGE;},{rootMargin:'400px'});seen.observe(el);},{flush:'post'});
watch(id,()=>{shownCount.value=PAGE;});
onBeforeUnmount(()=>seen?.disconnect());
const previewing=ref(null);
const open=file=>{if(file.removed)return;previewing.value={...file,group:files.value.filter(f=>!f.removed)};};
const escape=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
async function jump(file){await w.showFile(file);}
// An iPhone's home-screen app shares the file instead (saveFile.js), as a bubble's link does.
function onDownload(file,event){if(!sharesFiles())return;event.preventDefault();saveWithProgress(url(file),file.name,{title:escape(file.name),size:file.size,ct});}
function remove(file){
 const conversation=id.value;
 f7.dialog.confirm(ct('會永久刪除這個檔案，無法復原。對話裡的訊息會顯示它已刪除。')+'<br><b>'+escape(file.name)+'</b>',ct('刪除檔案'),async()=>{
  deleting.value=new Set([...deleting.value,file.id]);
  try{const r=await api('/conversations/'+conversation+'/files/'+encodeURIComponent(file.id),{method:'DELETE'});if(id.value===conversation)w.markFileRemoved(file.id,r?.file?.removedAt);}
  catch(e){f7.dialog.alert(escapeHtml(e.message?ct(e.message):ct('刪除失敗')));}
  finally{const next=new Set(deleting.value);next.delete(file.id);deleting.value=next;await load();}
 });
}
</script>
<style scoped>
.fp{font-size:15px;padding:8px 0}
.fp-empty{margin:18px 16px;opacity:.6;line-height:1.5}
.fp-loading{text-align:center;opacity:1}
.fp-list{margin:6px 12px 16px;background:var(--f7-list-bg-color);border-radius:14px;padding:2px 6px 2px 12px}
.fp-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(127,127,127,.18);min-width:0}
.fp-row:first-child{border-top:0}
.fp-more{display:flex;justify-content:center;padding:10px 0}
.fp-open{flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:0;margin:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.fp-open:disabled{cursor:default}
.fp-body{flex:1;min-width:0}
.fp-name{line-height:1.35;overflow-wrap:anywhere;word-break:break-word}
.fp-meta{font-size:12px;opacity:.55;margin-top:3px;overflow-wrap:anywhere}
.fp-row.removed .fp-name{opacity:.5;text-decoration:line-through}
.fp-actions{flex:0 0 auto;display:flex;align-items:center}
.fp-act{display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:50%;background:none;color:var(--f7-theme-color);cursor:pointer;font:inherit;text-decoration:none}
.fp-act .f7-icons{font-size:21px}
.fp-act:disabled{opacity:.4;cursor:default}
.fp-delete{color:#ff453a}
@media (hover:hover){.fp-act:not(:disabled):hover{background:rgba(127,127,127,.15)}}
</style>
