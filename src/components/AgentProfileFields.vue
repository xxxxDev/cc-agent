<template>
 <!-- A member sees the profile the admin set, as text: nothing here is theirs to change. -->
 <template v-if="readonly">
  <f7-list inset strong-ios class="agent-profile-readonly">
   <f7-list-item :title="ct('Agent 名稱')" :after="modelValue.title"/>
   <f7-list-item :title="ct('模型與 Effort')" :after="modelLabel(modelValue.model)+' · '+effortLabel(modelValue.effort)"/>
  </f7-list>
  <f7-list v-if="modelValue.description||modelValue.memory" inset accordion-list class="cc-settings-list profile-fold">
   <f7-list-item v-if="modelValue.description" accordion-item title="Description" :after="lengthLabel(modelValue.description)"><f7-accordion-content><f7-block class="profile-text">{{modelValue.description}}</f7-block></f7-accordion-content></f7-list-item>
   <f7-list-item v-if="modelValue.memory" accordion-item title="Memory" :after="lengthLabel(modelValue.memory)"><f7-accordion-content><f7-block class="profile-text">{{modelValue.memory}}</f7-block></f7-accordion-content></f7-list-item>
  </f7-list>
 </template>
 <template v-else-if="!accessOnly">
 <f7-list v-if="!foldText" inset strong-ios>
  <f7-list-input :label="ct('Agent 名稱')" :value="modelValue.title" @update:value="set('title',$event)" :placeholder="ct('輸入 Agent 名稱')" maxlength="80" required/>
   <f7-list-input label="Description" type="textarea" :value="modelValue.description" @update:value="set('description',$event)" :placeholder="ct('這個 Agent 的用途（選填）')" :resizable="true" rows="2" maxlength="4000"/>
   <f7-list-input label="Memory" type="textarea" :value="modelValue.memory" @update:value="set('memory',$event)" :placeholder="ct('針對這個 agent，你想要讓他長久記憶的內容（選填）')" :resizable="true" rows="3" maxlength="20000"/>
 </f7-list>
 <!-- Long text folds in Agent Profile, so the controls below it stay in reach. -->
 <f7-list v-if="foldText" inset accordion-list class="cc-settings-list profile-fold">
  <!-- The name folds too, showing itself; it has no arrow until it is open. -->
  <f7-list-item accordion-item class="fold-quiet agent-name" :title="ct('Agent 名稱')" :after="modelValue.title"><f7-accordion-content><f7-list>
   <f7-list-input :value="modelValue.title" @update:value="set('title',$event)" :placeholder="ct('輸入 Agent 名稱')" maxlength="80" required/>
  </f7-list></f7-accordion-content></f7-list-item>
  <f7-list-item accordion-item title="Description" :after="lengthLabel(modelValue.description)"><f7-accordion-content><f7-list>
   <f7-list-input type="textarea" :value="modelValue.description" @update:value="set('description',$event)" :placeholder="ct('這個 Agent 的用途（選填）')" :resizable="true" rows="6" maxlength="4000"/>
  </f7-list></f7-accordion-content></f7-list-item>
  <f7-list-item accordion-item title="Memory" :after="lengthLabel(modelValue.memory)"><f7-accordion-content><f7-list>
   <f7-list-input type="textarea" :value="modelValue.memory" @update:value="set('memory',$event)" :placeholder="ct('針對這個 agent，你想要讓他長久記憶的內容（選填）')" :resizable="true" rows="8" maxlength="20000"/>
  </f7-list></f7-accordion-content></f7-list-item>
 </f7-list>
 <f7-list v-if="collapsed" inset accordion-list class="cc-settings-list"><f7-list-item accordion-item :title="ct('模型與 Effort')" :after="modelLabel(modelValue.model)+' · '+effortLabel(modelValue.effort)"><f7-accordion-content>
  <f7-list>
   <f7-list-input :label="ct('模型')" type="select" :value="modelValue.model" @update:value="pick('model',$event)"><option v-for="id in modelOptions" :key="id" :value="id">{{modelLabel(id)}}</option></f7-list-input>
   <f7-list-input label="Effort" type="select" :value="modelValue.effort" @update:value="pick('effort',$event)"><option v-for="id in effortOptions" :key="id" :value="id">{{effortLabel(id)}}</option></f7-list-input>
  </f7-list>
 </f7-accordion-content></f7-list-item></f7-list>
 <!-- Model and effort share one row, half each. -->
 <f7-list v-else inset strong-ios class="model-effort">
  <f7-list-input :label="ct('模型')" type="select" :value="modelValue.model" @update:value="pick('model',$event)"><option v-for="id in modelOptions" :key="id" :value="id">{{modelLabel(id)}}</option></f7-list-input>
  <f7-list-input label="Effort" type="select" :value="modelValue.effort" @update:value="pick('effort',$event)"><option v-for="id in effortOptions" :key="id" :value="id">{{effortLabel(id)}}</option></f7-list-input>
 </f7-list>
 </template>
 <!-- What the page showing this wants between the model and the access scope. -->
 <slot name="before-access"/>
 <template v-if="showAccess">
  <template v-if="admin&&!readonly">
   <!-- Offered only where the server allows it: an agent an admin owns. -->
   <!-- What full access means is a hint on the row, shown on hover. -->
   <f7-list v-if="allowFull" inset strong-ios class="agent-full" :title="ct('完整權限：這個 Agent 不受範圍限制，讀寫得到這台電腦上你的帳號能碰到的一切，包括金鑰和所有人的對話。只替需要的 Agent 打開。')">
    <f7-list-item ><template #title>{{ct('完整權限')}}<small class="full-flag">（--dangerously-skip-permissions）</small></template><template #after><f7-toggle :checked="!!modelValue.access?.full" :disabled="scopedAgents===false&&!!modelValue.access?.full" @toggle:change="setFull"/></template></f7-list-item>
   </f7-list>
   <f7-block-footer v-if="allowFull&&scopedAgents===false">{{ct('這台伺服器（Windows）只支援完整權限。')}}</f7-block-footer>
   <f7-list v-if="!(allowFull&&modelValue.access?.full)" inset strong-ios class="agent-access">
    <f7-list-input :label="ct('允許的資料夾')" type="textarea" :value="raw.allow" @update:value="setLines('allow',$event)" :placeholder="ct('每行一個，例如 ~/Desktop/project')" :resizable="true" rows="2"/>
    <f7-list-input :label="ct('排除的資料夾')" type="textarea" :value="raw.exclude" @update:value="setLines('exclude',$event)" :placeholder="ct('允許範圍裡要擋掉的資料夾')" :resizable="true" rows="2"/>
    <f7-list-input :label="ct('允許的網站')" type="textarea" :value="raw.domains" @update:value="setLines('domains',$event)" :placeholder="ct('每行一個，例如 api.github.com')" :resizable="true" rows="2"/>
   </f7-list>
   <f7-block-footer v-if="!(allowFull&&modelValue.access?.full)" class="exclude-note">{{ct('排除是照路徑：排除的資料夾在設定後被移動或改名，就不再被排除。排除不能取代不開通上層資料夾。')}}</f7-block-footer>
   <!-- Folders it may read and never write, such as
        where a program run outside the sandbox saves its output. -->
   <f7-list v-if="!(allowFull&&modelValue.access?.full)" inset strong-ios class="agent-read-only">
    <f7-list-input :label="ct('唯讀資料夾')" type="textarea" :value="raw.readOnly" @update:value="setLines('readOnly',$event)" :placeholder="ct('每行一個，例如 ~/Documents/reports')" :resizable="true" rows="2" autocapitalize="off" autocorrect="off" spellcheck="false"/>
   </f7-list>
   <f7-block-footer v-if="!(allowFull&&modelValue.access?.full)" class="read-only-note">{{ct('Agent 只能讀、不能改。可以是沙盒外程式專案裡放輸出的子資料夾，但不能是專案資料夾本身；放進來的資料夾裡不能有 .env、金鑰等機密。')}}</f7-block-footer>
   <!-- MCP servers chosen per agent, ticked from this computer's list; none by default. -->
   <template v-if="!(allowFull&&modelValue.access?.full)">
    <f7-block-title class="mcp-title">{{ct('允許的 MCP')}}</f7-block-title>
    <f7-list inset strong-ios class="agent-mcp">
     <f7-list-item v-for="o in mcpChoices" :key="o.name" checkbox :checked="(modelValue.access?.mcp||[]).includes(o.name)" :title="o.label" :after="o.kind==='local'?ct('本機'):o.kind==='claude.ai'?'claude.ai':''" @change="toggleMcp(o.name,$event.target.checked)"/>
     <f7-list-item v-if="!mcpChoices.length" :title="ct('這台電腦沒有可選的 MCP')"/>
    </f7-list>
    <!-- Programs it may run outside the sandbox, such as a tool that opens a browser: one exact command per line, or a prefix
         ending in :*. Set on one agent at a time, never in a template. -->
    <template v-if="programs">
     <f7-list inset strong-ios class="agent-unsandboxed">
      <f7-list-input :label="ct('沙盒外執行的程式')" type="textarea" :value="raw.unsandboxed" @update:value="setLines('unsandboxed',$event)" :placeholder="ct('每行：程式完整路徑、空格、它的專案資料夾；要接參數再加 +args，例如 /Users/me/mytool/src/login.js /Users/me/mytool')" :resizable="true" rows="2" autocapitalize="off" autocorrect="off" spellcheck="false"/>
     </f7-list>
     <f7-block-footer class="unsandboxed-note">{{ct('這些程式以這台電腦擁有者的身分、在沙盒外執行，碰得到擁有者碰得到的一切。只放沙盒裡跑不動的程式（例如會開瀏覽器的）。CC Agent 會在它的專案資料夾、用清空的環境執行它，專案資料夾對這個 Agent 唯讀。加上 +args 才能接參數；參數可能改變程式做的事，而且會先由沙盒外的 shell 展開（萬用字元、波浪號、$ 變數），可能透露 Agent 讀不到的檔名。')}}</f7-block-footer>
    </template>
   </template>
   <!-- An admin's own agent (allowFull) may use claude.ai connectors unticked, in auto
        mode; anyone else's uses only the ticked ones. -->
   <f7-block-footer v-if="allowFull&&!modelValue.access?.full" class="mcp-note">{{ct('這個 Agent 以 auto mode 執行：範圍外的檔案一律讀寫不到；讀取網頁只能連到「允許的網站」，其他網站由 CC Agent 擋下（Bash 照沙盒的網站清單、不擋解析到私有位址的名稱；網頁搜尋不受限；同一網站的 www. 轉址、檢查後改變解析位址、檢查逾時這幾種情況擋不到）；MCP 只有勾選的能用，claude.ai 的（用你的帳號）也一樣。本機的 MCP（例如 excel、word）要勾選才會載入，而且在範圍限制之外執行，選了它，這個 Agent 就能透過它讀寫範圍外的檔案。')}}</f7-block-footer>
   <f7-block-footer v-else-if="!allowFull" class="mcp-note">{{ct('這個 Agent 以 auto mode 執行：範圍外的檔案一律讀寫不到；讀取網頁只能連到「允許的網站」，其他網站由 CC Agent 擋下（Bash 照沙盒的網站清單、不擋解析到私有位址的名稱；網頁搜尋不受限；同一網站的 www. 轉址、檢查後改變解析位址、檢查逾時這幾種情況擋不到）。MCP 只有勾選的能用，claude.ai 的也一樣，使用者自己不能改。勾選的 MCP 以這台電腦擁有者的身分執行：claude.ai 的用擁有者的帳號，本機的（例如 excel、word）在範圍限制之外，選了它，使用這個 Agent 的人就能透過它讀寫擁有者在那裡碰得到的資料。')}}</f7-block-footer>
  </template>
  <f7-list v-else inset strong-ios class="agent-access"><f7-list-item :title="ct('可存取範圍')" :after="summary"/></f7-list>
  <f7-block-footer v-if="!modelValue.access?.full">{{ct('預設只有這個 Agent 自己的工作區。範圍外的動作會被擋下，並開一張報告單給管理員。')}}</f7-block-footer>
 </template>
</template>
<script setup>
import {computed,reactive,ref,watch} from 'vue';import {api} from '../js/api.js';import {ct} from '../js/agent-i18n.js';
import {preferencesLoaded,scopedAgents} from '../js/agentPreferences.js';
// What a folded field says about itself: how much is in it.
const lengthLabel=text=>{const n=Array.from(String(text||'')).length;return n?n.toLocaleString()+' '+ct('字'):ct('未填');};
import {models,efforts,modelLabel,effortLabel} from '../js/agent-models.js';
const props=defineProps({modelValue:{type:Object,required:true},collapsed:{type:Boolean,default:true},foldText:{type:Boolean,default:false},admin:{type:Boolean,default:false},showAccess:{type:Boolean,default:false},accessOnly:{type:Boolean,default:false},readonly:{type:Boolean,default:false},allowFull:{type:Boolean,default:false},programs:{type:Boolean,default:true}}),emit=defineEmits(['update:modelValue','engine-change']);
// Access lists are edited as one entry per line. The typed text is kept as typed
// (a trailing newline included) and only re-read from the model when the model
// really says something different, or Enter would be undone on every keystroke.
const LISTS=['allow','exclude','readOnly','domains','unsandboxed'],entries=text=>String(text||'').split('\n').map(s=>s.trim()).filter(Boolean);
// A program outside the sandbox is one line on the page, "<program> <folder>" and "+args"
// when it takes arguments, and {program, folder, args} in the scope. A line of any
// other shape goes as typed, for the server to refuse with its reason.
const toLine=e=>e&&typeof e==='object'?`${e.program} ${e.folder}${e.args?' +args':''}`:String(e);
const fromLine=line=>{const w=line.split(/\s+/);return w.length===2||(w.length===3&&w[2]==='+args')?{program:w[0],folder:w[1],...(w[2]?{args:true}:{})}:{program:line};};
const linesOf=(k,list)=>(list||[]).map(k==='unsandboxed'?toLine:x=>x),valuesOf=(k,lines)=>k==='unsandboxed'?lines.map(fromLine):lines;
const raw=reactive({allow:'',exclude:'',readOnly:'',domains:'',unsandboxed:''});
// The MCP servers to tick: this computer's, plus any already chosen that it no longer lists.
const mcpOptions=ref([]);
const mcpChoices=computed(()=>[...mcpOptions.value,...(props.modelValue.access?.mcp||[]).filter(n=>!mcpOptions.value.some(o=>o.name===n)).map(name=>({name,label:name,kind:''}))]);
function toggleMcp(name,on){const access={allow:[],exclude:[],domains:[],...(props.modelValue.access||{})};const next=new Set(access.mcp||[]);if(on)next.add(name);else next.delete(name);access.mcp=[...next];if(!access.mcp.length)delete access.mcp;emit('update:modelValue',{...props.modelValue,access});}
if(props.admin&&props.showAccess&&!props.readonly)api('/agent-mcp-options').then(r=>{mcpOptions.value=Array.isArray(r?.options)?r.options:[];}).catch(()=>{});
watch(()=>props.modelValue.access,a=>{for(const k of LISTS){const joined=linesOf(k,a?.[k]).join('\n');if(entries(raw[k]).join('\n')!==joined)raw[k]=joined;}},{immediate:true,deep:true});
function setLines(key,text){raw[key]=text;const access={allow:[],exclude:[],domains:[],...(props.modelValue.access||{}),[key]:valuesOf(key,entries(text))};if(!access.mcp?.length)delete access.mcp;if(!access.unsandboxed?.length)delete access.unsandboxed;if(!access.readOnly?.length)delete access.readOnly;emit('update:modelValue',{...props.modelValue,access});}
const summary=computed(()=>{if(props.modelValue.access?.full)return ct('完整權限');const n=(props.modelValue.access?.allow?.length||0)+(props.modelValue.access?.readOnly?.length||0);return n?ct('工作區＋')+n+ct(' 個資料夾'):ct('只有工作區');});
// Off removes the key rather than storing false, as the server stores it.
function setFull(on){const {full,...scope}={allow:[],exclude:[],domains:[],...(props.modelValue.access||{})};emit('update:modelValue',{...props.modelValue,access:on?{...scope,full:true}:scope});}
const modelOptions=computed(()=>models(props.admin,props.modelValue.model));
const effortOptions=computed(()=>efforts(props.admin,props.modelValue.effort));
// A saved model that is not a Claude model is offered the newest Opus instead.
watch([modelOptions,preferencesLoaded,()=>props.modelValue.model],([list])=>{
 if(props.readonly||props.accessOnly||!props.allowFull||!preferencesLoaded.value||list.includes(props.modelValue.model))return;
 emit('update:modelValue',{...props.modelValue,model:list.includes('claude-opus-5-5')?'claude-opus-5-5':list[0]});
},{immediate:true});
function set(key,value){emit('update:modelValue',{...props.modelValue,[key]:value});}
// A model or effort the person picked, as opposed to one filled in: the page may want to say what that does.
function pick(key,value){if(value!==props.modelValue[key])emit('engine-change',key);set(key,value);}
</script>
<style scoped>
/* Cards follow one another at the distance rows keep inside a card. */
.list{--f7-list-margin-vertical:10px;}
.list+.block-footer{margin-top:8px;}
.profile-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;}
/* Every card here is as wide as the folding ones (.cc-settings-list); they used to be a little wider. */
.list.inset:not(.cc-settings-list)>:deep(ul)>li{margin-left:var(--cc-space-5);margin-right:var(--cc-space-5);}
.model-effort :deep(ul){display:grid;grid-template-columns:1fr 1fr;column-gap:10px;padding:0 var(--cc-space-5);}
.model-effort :deep(li){min-width:0;margin:0!important;}
/* Label at the left, the chosen value at the right, like the folded rows. */
.model-effort :deep(.item-content){min-height:var(--cc-size-control-md);}
.model-effort :deep(.item-inner){flex-direction:row;align-items:center;gap:8px;min-height:var(--cc-size-control-md);padding-top:0;padding-bottom:0;}
.model-effort :deep(.item-title.item-label){width:auto;flex:0 0 auto;margin:0;font-size:var(--f7-list-item-title-font-size);color:var(--f7-list-item-title-text-color);line-height:inherit;}
.model-effort :deep(.item-input-wrap){flex:1 1 0;min-width:0;margin:0;}
.model-effort :deep(select){height:var(--cc-size-control-md);text-align:right;text-align-last:right;color:var(--f7-list-item-after-text-color);}
.full-flag{margin-left:4px;font-size:12px;opacity:.6;}
.fold-quiet:not(.accordion-item-opened) :deep(>.item-link .item-inner:before){opacity:0;}
.fold-quiet:not(.accordion-item-opened) :deep(>.item-link .item-inner){padding-right:var(--f7-list-item-padding-horizontal);}
</style>
