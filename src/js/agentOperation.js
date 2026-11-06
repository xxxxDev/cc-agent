// What Agent Profile and the operation shield show for one agent, and the waits
// behind starting, compacting and handing over: the conversation page
// (js/agent-chat.js) and a split-view cell (js/cellAgent.js) use the same ones, so
// the two never drift apart.
import {ct,duration} from './agent-i18n.js';
import {estimatedCost} from './usageCost.js';
import {api} from './api.js';

export function statusLabel(d) {
 return ({'awaiting-workspace':ct("等待工作目錄確認"),'awaiting-confirmation':ct("等待本機 Channel 確認"),starting:ct("Claude agent 喚醒中"),ready:d?.mode==='demo'?ct("模擬助手已就緒"):d?.connected?ct("Claude 已連線"):ct("正在確認連線…"),busy:ct("正在思考與處理…"),stopped:ct("已暫停"),error:ct("需要重新連線"),'handing-off':ct("正在交接…")}[d?.phase]||ct("準備中"));
}

// Tokens are exact; the dollar figure is derived from them, so keep them together.
export function usageRows(u) {
 if(!u)return null;
 const n=x=>Number(x||0).toLocaleString('en-US');
 return {total:n(u.tokens.total),io:n(u.tokens.input)+' / '+n(u.tokens.output),cache:n(u.tokens.cacheRead)+' / '+n(u.tokens.cacheWrite),cost:estimatedCost(u,ct),turns:n(u.turns)};
}

// The shield over a busy agent: kind is agentActivity()'s answer, op the operation
// this page started, if any.
export function operationTitle(kind) {
 return ct(kind==='compact'?'正在整理對話記憶…':kind==='rotate'?'正在接續新 session…':'Claude agent 喚醒中…');
}
// done / in progress / not started, matching the rotate list's existing marks.
const step=(done,active)=>done?'✓ ':active?'⋯ ':'○ ';
export function operationSteps(d, kind, op) {
 // Waking an agent — creating one, or reconnecting a stopped one — is only ever
 // locked in these two phases, so report them instead of only spinning. The
 // awaiting-workspace/confirmation gates deliberately do not lock the page.
 if(kind==='start'){
  const session=d.phase==='ready';
  return [step(session,true)+ct('啟動 Claude session'),step(false,session)+ct('確認連線')];
 }
 // How long it has run; its percentage, from Claude Code's own screen, is a bar.
 if(kind==='compact'){const since=Date.parse(d.compactingSince||'');return Number.isFinite(since)?[ct('已進行')+' '+duration(Math.max(0,Math.round((Date.now()-since)/1000)))]:[];}
 if(kind!=='rotate'&&!(op&&d?.generation>op.generation))return [];
 const started=op?d?.generation>op.generation:d?.phase==='starting';
 return [(started?'✓ ':'⋯ ')+ct('整理並保存交接資料'),(started?'✓ ':'○ ')+ct('啟動新的 session'),(started?'⋯ ':'○ ')+ct('載入交接內容並確認連線')];
}
// A compaction's progress as Claude Code draws it in its terminal, read off that
// screen by the server; null until it shows.
export function operationPercent(d, kind) {
 return kind==='compact'&&Number.isFinite(d?.compactPercent)?d.compactPercent:null;
}

// Start, compact or hand over, then wait until the agent is ready again: each
// answer goes to update(); current() false stops the wait without a word. Returns
// the ready agent, with a warning it still carries as lastError, or throws.
export async function settleOperation(id, kind, body, {current, update}) {
 const until=Date.now()+120000;
 let d=await api('/conversations/'+id+'/'+kind,{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 while(current()){
  update(d);
  if(['error','stopped','awaiting-workspace','awaiting-confirmation'].includes(d.phase))throw new Error(d.lastError||ct('Agent 尚未就緒，請稍後重新確認。'));
  if(d.phase==='ready'&&d.connected&&!d.pendingRotation&&!d.compacting)return d;
  if(Date.now()>=until)throw new Error(ct('操作等待逾時，請查看此 Agent 狀態後再操作。'));
  await new Promise(resolve=>setTimeout(resolve,700));
  if(!current())return null;
  d=await api('/conversations/'+id,{signal:AbortSignal.timeout(Math.min(15000,Math.max(1,until-Date.now())))});
 }
 return null;
}

// Agent Profile's draft, taken when it opens, and what of it is saved.
export function profileDraftOf(d) {
 return {title:d.title,description:d.description||'',memory:d.memory||'',model:d.model,effort:d.effort,subagentModel:d.subagentModel||'',subagentEffort:d.subagentEffort||'',access:d.access||{allow:[],exclude:[],domains:[]},profileVersion:d.profileVersion};
}
export function followSetting(profile) {
 return {...profile};
}

// The agent's own picture, from Agent Profile. It is cut to a centred square and shrunk before it leaves the device: 256 pixels is
// more than anywhere shows it, and it keeps the upload far under the server's limit.
// Anything the browser can draw is accepted here, a phone photo included; what
// arrives is always a PNG.
export async function squarePicture(file) {
 let bitmap;
 try{bitmap=await createImageBitmap(file);}catch{throw new Error(ct('無法讀取這張圖片'));}
 const side=Math.min(bitmap.width,bitmap.height),size=Math.min(256,side);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size,size);
 bitmap.close?.();
 return new Promise((ok,no)=>canvas.toBlob(blob=>blob?ok(blob):no(new Error(ct('無法讀取這張圖片'))),'image/png'));
}
