// One split-view cell's agent, for what the conversation page does to the agent it
// has open, so a cell does all the conversation page does. Agent Profile, the
// checklists and the search take the page's workspace (js/agent-chat.js) by
// inject; a cell gives them this one
// instead, the same names acting on the cell's agent, so they are one component in
// both places. The rest of the page's workspace (the agents, the groups, the
// settings) is passed through as it is.
import {ref,computed,watch} from 'vue';
import {f7} from 'framework7-vue';
import {api} from './api.js';
import {ct} from './agent-i18n.js';
import {agentActivity} from './agentActivity.js';
import * as agentOperation from './agentOperation.js';
import {askHandoff} from './handoffAsk.js';
import {afterProfileSave,askDiscard,guardOperation as guardProfile,staleProfile,resolveStale,busyNotice} from './profileSave.js';

export function useCellAgent({workspace, conversationId, detail, refresh, profileOpen, returnFromProfile}) {
 const error=ref(''),operation=ref(null),operationError=ref('');
 const activity=computed(()=>agentActivity(detail.value,operation.value));
 const locked=computed(()=>!!activity.value&&!operationError.value);
 let disposed=false;
 async function attempt(fn){error.value='';try{return await fn();}catch(e){error.value=e.message;return null;}}
 // Start, compact and hand over wait until the agent is back, under the cell's own
 // shield; another of them on the same agent waits for that.
 async function run(kind,body){
  const id=conversationId.value;
  if(operation.value)return;
  const op={kind,generation:detail.value?.generation,token:Symbol()};
  operation.value=op;operationError.value='';profileOpen.value=false;
  const current=()=>!disposed&&operation.value?.token===op.token&&conversationId.value===id;
  try{
   const d=await agentOperation.settleOperation(id,kind,body,{current,update:d=>{if(d?.id===id)detail.value={...detail.value,...d,messages:detail.value?.messages||d.messages};}});
   if(d?.lastError&&current())operationError.value=d.lastError;
   return d||undefined;
  }catch(e){if(current())operationError.value=e.message;}
  finally{if(current())operation.value=null;await refresh();}
 }
 async function action(name,body={}){
  const id=conversationId.value;
  if(['compact','rotate','start'].includes(name)){if(!(await guardOperation(name==='rotate'?'handoff':name)))return;return run(name,body);}
  if(operation.value)return;
  return attempt(async()=>{const d=await api('/conversations/'+id+'/'+name,{method:'POST',body:JSON.stringify(body)});await refresh();return d;});
 }
 const pause=()=>f7.dialog.confirm(ct("暫停會中斷執行中的回覆。聊天紀錄仍會保留。"),ct("暫停執行"),()=>action('stop'));
 const restart=onCancel=>f7.dialog.confirm(ct("重啟會中斷執行中的回覆，並接回同一個 session。聊天紀錄仍會保留。"),ct("重啟"),async()=>{if(await action('stop'))await action('start');},onCancel);
 const handoff=()=>askHandoff(detail.value?.handoffSetting,body=>action('rotate',body));
 async function importHistory(){
  const d=await action('import-history');
  if(!d)return;
  const {added=0,removed=0}=d.imported||{};
  const text=[added>0&&ct('已補上 session 裡的對話')+'（'+added+'）',removed>0&&ct('已移除不是對話的內容')+'（'+removed+'）'].filter(Boolean).join('，')||ct('沒有可補的對話');
  f7.toast.create({text,closeTimeout:2200}).open();
 }
 async function uploadAvatar(file){
  const id=conversationId.value;if(!file||!id)return;
  if(await attempt(async()=>api('/conversations/'+id+'/avatar',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await agentOperation.squarePicture(file)}))){await refresh();f7.toast.create({text:ct('Agent 圖像已更新'),closeTimeout:1800}).open();}
 }
 function resetAvatar(){
  const id=conversationId.value;if(!id)return;
  f7.dialog.confirm(ct('改回預設的 Agent 圖示？'),ct('還原預設圖像'),async()=>{if(await attempt(()=>api('/conversations/'+id+'/avatar',{method:'DELETE'})))await refresh();});
 }
 // Agent Profile's draft: taken when it opens, never on a refresh, which would undo typing.
 // Changed from what was taken or last saved, the save button lights and closing asks
 // first; saving sends everything at once, then asks once about a restart (js/profileSave.js).
 // Closed and opened again with unsaved changes, the draft is kept.
 const profileDraft=ref(null),profileBase=ref(null),profileSaving=ref(false),profileConflicts=ref([]);
 const takeProfileDraft=()=>{profileConflicts.value=[];profileDraft.value=profileBase.value=agentOperation.profileDraftOf(detail.value);error.value='';};
 const profileDirty=computed(()=>workspace.user?.value?.role==='admin'&&!!profileBase.value&&agentOperation.profileKey(profileDraft.value)!==agentOperation.profileKey(profileBase.value));
 watch(()=>[profileOpen.value,detail.value?.id],([open,id],[wasOpen,wasId]=[])=>{if(open&&detail.value&&(!wasOpen||id!==wasId)&&!profileDirty.value)takeProfileDraft();},{immediate:true});
 const merge=d=>{if(d?.id===conversationId.value)detail.value={...detail.value,...d,messages:detail.value?.messages||d.messages};};
 // Only what changed is sent; refused as out of date, it is merged onto the agent as it is now.
 async function saveProfile({ask=true,retried=false,back=true}={}){
  if(profileSaving.value)return;
  if(operation.value){busyNotice();return;}
  profileSaving.value=true;error.value='';
  let r;
  try{r=await api('/conversations/'+conversationId.value+'/profile',{method:'POST',body:JSON.stringify(agentOperation.profileChanges(profileDraft.value,profileBase.value))});}
  catch(e){profileSaving.value=false;if(!staleProfile(e)){error.value=e.message;return;}
   return resolveStale({latest:async()=>{await refresh();return detail.value?agentOperation.profileDraftOf(detail.value):null;},draft:profileDraft.value,base:profileBase.value,retried,again:()=>saveProfile({ask,retried:true,back}),
    take:(fresh,draft,conflicts)=>{profileBase.value=fresh;profileDraft.value=draft;profileConflicts.value=conflicts;}});}
  await refresh();
  profileSaving.value=false;
  if(r){profileDraft.value={...profileDraft.value,profileVersion:r.profileVersion};profileBase.value=profileDraft.value;profileConflicts.value=[];afterProfileSave(r,{update:merge,ask,done:back?()=>returnFromProfile?.():undefined});}
  return r;
 }
 const mayCloseProfile=async()=>{if(!profileDirty.value)return true;if(!(await askDiscard()))return false;profileDraft.value=profileBase.value;profileConflicts.value=[];return true;};
 // Only its own step, as on the conversation page: a change made elsewhere in between
 // still goes through the merge.
 const syncProfileVersion=d=>{if(d?.profileVersion!==(profileDraft.value?.profileVersion??-2)+1)return;if(profileBase.value)profileBase.value={...profileBase.value,profileVersion:d.profileVersion};if(profileDraft.value)profileDraft.value={...profileDraft.value,profileVersion:d.profileVersion};};
 // Opened from the usage view, closing goes back to it (SplitCell.vue returnFromProfile).
 async function closeProfile(){if(!(await mayCloseProfile()))return;if(returnFromProfile?.())return;profileOpen.value=false;}
 const guardOperation=kind=>guardProfile(kind,{dirty:()=>profileOpen.value&&profileDirty.value,save:o=>saveProfile({...o,back:false}),discard:()=>{profileDraft.value=profileBase.value;},ask:r=>afterProfileSave(r,{update:merge})});
 const cell={...workspace,
  selected:conversationId,detail,error,action,pause,restart,handoff,importHistory,uploadAvatar,resetAvatar,
  profileDraft,profileSaving,saveProfile,profileDirty,closeProfile,guardOperation,syncProfileVersion,profileConflicts,
  statusLabel:computed(()=>agentOperation.statusLabel(detail.value)),
 };
 return {cell,activity,locked,operationError,error,action,
  operationTitle:computed(()=>agentOperation.operationTitle(activity.value)),
  operationSteps:computed(()=>detail.value?agentOperation.operationSteps(detail.value,activity.value,operation.value):[]),
  operationPercent:computed(()=>agentOperation.operationPercent(detail.value,activity.value)),
  mayCloseProfile,
  dispose:()=>{disposed=true;}};
}
