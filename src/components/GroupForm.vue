<template>
 <!-- A group's name, members and lead: a message
      that names no one goes to the lead. -->
 <!-- On a phone a pushed card, as Agent Profile is (sheetSwipe.js); its ✕, a backdrop tap
      and a pull down ask first about unsaved changes. -->
 <f7-popup ref="popup" :opened="open" class="group-form-popup" :class="{'sheet-swipe':sheetSwipe}" :close-by-backdrop-click="false" :swipe-to-close="sheetSwipe" :push="sheetSwipe" @popup:closed="open&&$emit('close')"><div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"/><f7-view><f7-page>
  <f7-navbar>
   <f7-nav-left><f7-link icon-only icon-f7="xmark" class="group-form-close" :aria-label="ct('關閉')" @click="request()"/></f7-nav-left>
   <f7-nav-title>{{group?ct('編輯群組'):ct('新增群組')}}</f7-nav-title>
   <f7-nav-right><f7-link class="group-save" :class="{disabled:!ready||saving}" @click="ready&&!saving&&save()">{{group?ct('保存'):ct('建立')}}</f7-link></f7-nav-right>
  </f7-navbar>
  <!-- Only while open: the names below would otherwise sit in the page, hidden. -->
  <template v-if="open">
  <f7-block-title>{{ct('群組名稱')}}</f7-block-title>
  <f7-list inset><f7-list-input v-model:value="name" type="text" maxlength="40" :placeholder="ct('例如：release-team')" class="group-name"/></f7-list>
  <!-- Notified only when a member calls on you with @, and only while this is on. -->
  <div class="list inset group-notify"><ul><li><div class="item-content"><div class="item-inner">
   <div class="item-title">{{ct('群聊通知')}}</div>
   <div class="item-after"><label class="toggle"><input type="checkbox" :aria-label="ct('群聊通知')" :checked="notify" @change="notify=$event.target.checked"/><span class="toggle-icon"></span></label></div>
  </div></div></li></ul></div>
  <f7-block-footer>{{ct('成員討論出結果、在群裡 @你 時才會通知你。')}}</f7-block-footer>
  <f7-block-title>{{ct('成員（勾選要加入的 agent）')}}</f7-block-title>
  <!-- In the Agents list's sources and groups, as the @ menu. -->
  <template v-for="section in sections" :key="section.label"><div class="member-section">{{section.label}}</div>
  <div class="list inset group-members"><ul>
   <li v-for="a in section.agents" :key="a.id" :data-id="a.id"><div class="item-content">
    <button type="button" class="member-check" :class="{on:picked.has(a.id)}" role="checkbox" :aria-checked="String(picked.has(a.id))" :aria-label="a.title" @click="toggle(a.id)">{{picked.has(a.id)?'✓':''}}</button>
    <img class="member-avatar" :class="{'is-icon':avatarShape(a.avatar||defaultAvatar(a))==='icon'}" :src="a.avatar||defaultAvatar(a)" alt=""/>
    <span class="member-name" @click="toggle(a.id)">{{a.title}}</span>
    <span v-if="lead===a.id" class="lead-badge">{{ct('主負責')}}</span>
    <button v-else-if="picked.has(a.id)" type="button" class="make-lead" @click="lead=a.id">{{ct('設為主負責')}}</button>
   </div></li>
  </ul></div></template>
  <f7-block-footer>{{ct('訊息開頭 @ 誰就交給誰，@All 給所有成員，沒有 @ 就交給主負責；句子中間提到的人不會收到。成員之間互傳的訊息也會顯示在群裡。')}}</f7-block-footer>
  <p v-if="error" class="group-error" role="alert">{{error}}</p>
  </template>
 </f7-page></f7-view></f7-popup>
</template>
<script setup>
import {ref,computed,watch,inject} from 'vue';
import {ct} from '../js/agent-i18n.js';
import {defaultAvatar,avatarShape} from '../js/avatarShape.js';
import {createGroup,updateGroup} from '../js/groups.js';
import {agentSections} from '../js/agentSections.js';
import {listGroups} from '../js/agentPreferences.js';
import {sheetSwipe,guardSheet,closeAsking} from '../js/sheetSwipe.js';
const props=defineProps({open:Boolean,group:Object});
const emit=defineEmits(['close','saved']);
const w=inject('workspace');
const agents=computed(()=>(w.conversations.value||[]).filter(c=>c.mode==='claude'));
const sections=computed(()=>agentSections(agents.value,listGroups.value));
const name=ref(''),picked=ref(new Set()),lead=ref(null),notify=ref(true),saving=ref(false),error=ref('');
// What the form held when it opened, to tell an unsaved change.
const state=()=>JSON.stringify([name.value,[...picked.value].sort(),lead.value,notify.value]);
let opened='';
watch(()=>props.open,open=>{if(!open)return;error.value='';name.value=props.group?.name||'';picked.value=new Set(props.group?.members.map(m=>m.id)||[]);lead.value=props.group?.lead||null;notify.value=props.group?.notify!==false;opened=state();},{immediate:true});
const dirty=()=>props.open&&state()!==opened;
const popup=ref(null);
const request=closeAsking(dirty,()=>emit('close'));
guardSheet(popup,{dirty,request});
function toggle(id){const next=new Set(picked.value);if(next.has(id))next.delete(id);else next.add(id);picked.value=next;if(!next.has(lead.value))lead.value=[...next][0]||null;if(!lead.value&&next.size)lead.value=[...next][0];}
const ready=computed(()=>name.value.trim()&&picked.value.size&&picked.value.has(lead.value));
async function save(){
 saving.value=true;error.value='';
 const body={name:name.value.trim(),members:agents.value.map(a=>a.id).filter(id=>picked.value.has(id)),lead:lead.value,notify:notify.value};
 try{const g=props.group?await updateGroup(props.group.id,body):await createGroup(body);emit('saved',g);}
 catch(e){error.value=e.message;}
 finally{saving.value=false;}
}
</script>
<style scoped>
.group-members ul {padding:0;}
.member-section {margin:14px 20px 6px;font-size:12px;font-weight:600;color:var(--cc-color-text-secondary);text-transform:uppercase;}
.group-members .item-content {display:flex;align-items:center;gap:12px;padding:10px 14px;}
.member-check {flex:0 0 auto;margin:0;width:24px;height:24px;border-radius:50%;border:2px solid color-mix(in srgb,currentColor 35%,transparent);background:none;color:#fff;font-size:13px;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;}
.member-check.on {border:0;background:#0a84ff;}
.member-avatar {flex:0 0 auto;width:28px;height:28px;border-radius:8px;object-fit:cover;}
.member-avatar.is-icon {border-radius:0;object-fit:contain;}
.member-name {flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}
.lead-badge {flex:0 0 auto;font-size:12px;padding:2px 8px;border-radius:9px;background:#0a84ff;color:#fff;}
.make-lead {flex:0 0 auto;width:auto;margin:0;background:none;border:0;color:#0a84ff;font:inherit;font-size:13px;cursor:pointer;padding:0;}
.group-error {margin:12px 20px;color:#ff453a;}
.group-save.disabled {opacity:.4;pointer-events:none;}
</style>
