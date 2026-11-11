// After Agent Profile is saved, and before an unsaved one is closed: the conversation page (js/agent-chat.js) and a split-view cell
// (js/cellAgent.js) save the whole profile in one request, the subagents' model and
// effort and the auto-compact timing with it, and then ask one question, only when
// something saved waits for the agent to start again.
import {f7} from 'framework7-vue';
import {api} from './api.js';
import {ct} from './agent-i18n.js';
import {escapeHtml} from './safeDialog.js';
import {mergeProfile} from './agentOperation.js';

const NAMES={subagents:'子代理模型與 Effort',autoCompact:'自動壓縮時機'};
const toast=(text,closeTimeout=3000)=>f7.toast.create({text:ct(text),closeTimeout}).open();

// r is the save's answer: restartNeeds {needs: none | next-start | idle | busy, what}, and
// a warning when something after the save did not work. update(d) takes the agent as the
// apply answers it. ask false: a start or restart about to run puts it into effect, so
// nothing is asked; 'hint': another dialog follows (pause, handoff), so what still waits
// is said in the toast instead of a question. done(): called once all of that is over, after
// the restart question is answered when there is one (Agent Profile opened from the usage
// view goes back to it then).
export function afterProfileSave(r,{update,ask=true,done}){
 const finish=()=>{done?.();};
 if(r?.warning)f7.dialog.alert(escapeHtml(r.warning));
 const {needs,what=[]}=r?.restartNeeds||{};
 const waits=(needs==='idle'||needs==='busy')&&what.length>0;
 if(ask==='hint'&&waits){toast(ct('設定已保存')+' '+ct('還沒套用，按上方的「重啟」才會生效。'),4000);finish();return;}
 if(needs==='next-start'&&ask){toast('已保存，下次啟動時套用。');finish();return;}
 if(!ask||ask==='hint'||!waits){toast('設定已保存',1800);finish();return;}
 toast('設定已保存');
 const id=r.id;
 const apply=async()=>{try{const a=await api('/conversations/'+id+'/profile-apply',{method:'POST',body:'{}'});if(a?.id===id)update(a);
  toast({now:'agent 已重新啟動並套用。','after-reply':'會在 agent 這次完成後自動重新啟動套用。','next-start':'下次啟動時套用。'}[a?.profileApply]||'設定已保存');}catch(e){f7.dialog.alert(e.message);}};
 const changed=ct('這次修改的{what}要重新啟動才會生效。').replace('{what}',what.map(k=>ct(NAMES[k]||k)).join(ct('、')));
 setTimeout(()=>f7.dialog.create({title:escapeHtml(r.title||''),
  text:escapeHtml(changed+' '+ct(needs==='idle'?'現在重新啟動嗎？聊天內容不會不見。':'agent 正在工作，要在它這次完成後自動重新啟動套用嗎？')),
  buttons:[{text:ct('稍後')},{text:ct(needs==='idle'?'重新啟動':'好'),strong:true,onClick:apply}],destroyOnClose:true,on:{closed:finish}}).open(),350);
}

// Closing with unsaved changes asks first; true when they may go.
export function askDiscard(){
 return new Promise(resolve=>f7.dialog.create({text:escapeHtml(ct('有未保存的修改，要放棄嗎？')),cssClass:'profile-discard',
  buttons:[{text:ct('繼續編輯'),onClick:()=>resolve(false)},{text:ct('放棄修改'),strong:true,onClick:()=>resolve(true)}],destroyOnClose:true}).open());
}

// Before an operation (start, restart, pause, handoff, read, compact) on an agent whose
// profile has unsaved changes: 'save', 'discard' or 'cancel'.
export function askSaveFirst(){
 return new Promise(resolve=>f7.dialog.create({text:escapeHtml(ct('有未保存的修改，要先保存嗎？')),cssClass:'profile-save-first',verticalButtons:true,
  buttons:[{text:ct('保存並繼續'),strong:true,onClick:()=>resolve('save')},{text:ct('放棄修改'),onClick:()=>resolve('discard')},{text:ct('取消'),onClick:()=>resolve('cancel')}],destroyOnClose:true}).open());
}
// The host's side: false when the operation is not to run; otherwise {later}, which a
// restart calls when its own confirmation is cancelled, so a saved change that waits for
// a restart is still asked about. Compact and read ask about it at once; start
// and restart put it into effect; pause and handoff have a dialog of their own, so a toast
// says it instead.
const ASK={compact:true,import:true,pause:'hint',handoff:'hint',start:false,restart:false};
export async function guardOperation(kind,{dirty,save,discard,ask}){
 const none={later:()=>{}};
 if(!dirty())return none;
 const choice=await askSaveFirst();
 if(choice==='cancel')return false;
 if(choice==='discard'){discard();return none;}
 const r=await save({ask:ASK[kind]??true});
 if(!r)return false;
 return {later:()=>{if(kind==='restart')ask(r);}};
}
// A save refused because the profile changed after the draft was taken (another tab, a
// switch changed elsewhere, the agent's own memory): the host loads it again and says so.
export const staleProfile=e=>e?.status===409&&/profile changed/i.test(e?.message||'');
export const staleNotice=()=>f7.dialog.alert(escapeHtml(ct('這個 Agent 的設定剛在別處改過，已合併最新的設定，請再按一次保存。')));
// What each draft field is called on the page, to name a conflict.
const FIELD_NAMES={title:'Agent 名稱',description:'Description',memory:'Memory',model:'模型',effort:'Effort',access:'可存取範圍',subagents:'子代理模型與 Effort',autoCompact:'自動壓縮時機',threshold:'Compact 後自動接續',wrapUp:'自動收尾檢查'};
export const conflictText=keys=>ct('{fields} 在別處改過了，請確認後再保存。').replace('{fields}',keys.map(k=>ct(FIELD_NAMES[k]||k)).join(ct('、')));
export const conflictNotice=keys=>f7.dialog.alert(escapeHtml(conflictText(keys)));
// The host's side of a refused save: merge (mergeProfile) onto the agent as it is now.
// No conflict: saved again once by itself; a conflict: the values typed here kept and named.
export async function resolveStale({latest,draft,base,take,again,retried}){
 const fresh=await latest();if(!fresh)return;
 const m=mergeProfile(draft,base,fresh);take(fresh,m.draft,m.conflicts);
 if(m.conflicts.length){conflictNotice(m.conflicts);return;}
 if(retried){staleNotice();return;}
 return again();
}
export const busyNotice=()=>toast('agent 正在處理操作，稍後再保存。');
