const {getDefaultPushService}=require('./services/pushService');
const {getPushConfig}=require('./services/pushCrypto');
// One agent reply, as the push layer takes it.
function replyNotification(c,m){return {conversationId:c.id,replyId:m.id,ownerUserId:c.owner,agentName:c.title,replyText:m.notifyText||m.text,...(c.groupId?{groupId:c.groupId}:{})};}
// One new scope report, from what was stored when it was filed, so a retry builds
// the same notification even if the agent has been renamed since.
// A cap notice (kind 'cap', or an old digest) carries its count.
function reportNotification(r){return {kind:'access_report',conversationId:r.conversationId,replyId:'access-report:'+r.id+(r.pushAttempts?'#'+r.pushAttempts:''),reportId:r.id,ownerUserId:r.owner,agentName:r.title,reportKind:r.kind,tool:r.tool,...(r.exact===false?{exact:false}:{}),...(['digest','cap','scan','hooks'].includes(r.kind)?{count:r.count}:{})};}
// Several reports of one agent in one push: how many, and the newest to open.
function batchNotification(list){const newest=list.reduce((a,b)=>(Date.parse(b.at)>Date.parse(a.at)?b:a));const tries=Math.max(0,...list.map(r=>r.pushAttempts||0));return {kind:'access_report',conversationId:newest.conversationId,replyId:'access-report-batch:'+newest.conversationId+':'+newest.id+(tries?'#'+tries:''),reportId:newest.id,ownerUserId:newest.owner,agentName:newest.title,reportKind:'batch',count:list.length};}
// A schedule an agent proposed, to the admins, who approve it on the Schedules page, where it
// waits; the agent tells them in its chat. This push stays the admins': its gate
// sends to admins only. Built from what was stored when it was proposed, so a
// retry builds the same notification even if the agent has been renamed since.
function scheduleNotification(x){return {kind:'schedule_proposal',conversationId:x.conversationId,replyId:'schedule:'+x.id,scheduleId:x.id,ownerUserId:x.owner,agentName:x.agentTitle||'Agent',scheduleName:x.name};}
// What a background script found, to the agent's owner, like a reply.
function scheduleResultNotification(x){const r=x.resultPending||{};return {kind:'schedule_result',conversationId:x.conversationId,replyId:'schedule-result:'+x.id+':'+(r.at||''),scheduleId:x.id,ownerUserId:x.owner,agentName:x.agentTitle||'Agent',title:String(r.title||x.name),body:String(r.body||'')};}
// A schedule that failed twice in a row, once, until a run succeeds again. Keyed on
// the failed run's time, so the next streak is a push of its own.
function scheduleFailureNotification(x){return {kind:'schedule_failed',conversationId:x.conversationId,replyId:'schedule-failed:'+x.id+':'+(x.lastRun?.at||''),scheduleId:x.id,ownerUserId:x.owner,agentName:x.agentTitle||'Agent',scheduleName:x.name,detail:String(x.lastRun?.detail||'')};}
// A diagnostics report someone sent from Agent Profile, to the
// admins as a scope report goes: the agent's name and that it waits, never the text.
function diagnosticNotification(r){return {kind:'diagnostic_report',conversationId:r.conversationId,replyId:'diagnostic-report:'+r.id,reportId:r.id,ownerUserId:r.from,agentName:r.agentTitle};}
function activeAdmins(){
 const {usersDB}=require('./stores');const {isActiveUser}=require('./services/userLifecycle');
 return new Promise((resolve,reject)=>usersDB.find({role:'admin'},(error,users)=>error?reject(error):resolve(users.filter(isActiveUser).map(u=>String(u._id)))));
}
// An agent can file several reports in a row (up to five a turn, and one per
// refused request), and each would ring every admin's phone. One push per agent per
// quiet period; the others are marked all the same and wait in the review queue
// with the badge on the Admin tab's scope-reports row.
const REPORT_QUIET_MS=10*60_000;
// A report whose push keeps failing waits longer each time and is then given up, so
// it neither holds back the reports behind it nor retries every tick for ever.
const REPORT_MAX_ATTEMPTS=5;
// A scope report's push that keeps failing is then tried hourly, never given up.
const REPORT_SLOW_RETRY_MS=3600_000;
function startNotifications(agents,service=getDefaultPushService(),admins=activeAdmins,{now=Date.now,quietMs=REPORT_QUIET_MS}={}){
 let current=null;const lastPush=new Map(),failures=new Map();
 async function flushReplies(){
  for(const {conversation:c,message:m} of agents.pendingNotifications()){
   // The owner is looking at this conversation: the reply is already in front of them.
   if(!agents.isViewing?.(c.owner,c.id))await service.notifyAgentReply(replyNotification(c,m));
   m.notifyPending=false;agents.save();
  }
 }
 // As reports are: one push per agent per quiet period, and one that keeps failing
 // is retried less often and then given up, never holding back the others.
 const schedulePush=new Map(),scheduleFailures=new Map();
 async function flushSchedules(){
  for(const {schedule:x,kind='proposal'} of agents.pendingScheduleNotifications?.()||[]){
   const key=kind+':'+x.id,failed=scheduleFailures.get(key);if(failed&&now()<failed.retryAt)continue;
   try{
    if(kind==='failure')await service.notifyAccessReport(scheduleFailureNotification(x),await admins());
    else if(kind==='result')await service.notifyAgentReply(scheduleResultNotification(x));
    else{
     const quiet=now()-(schedulePush.get(x.conversationId)??-Infinity)<quietMs;
     if(x.status==='pending'&&!quiet){await service.notifyAccessReport(scheduleNotification(x),await admins());schedulePush.set(x.conversationId,now());}
    }
    scheduleFailures.delete(key);agents.markScheduleNotified(x.id,kind);
   }catch{
    const attempts=(failed?.attempts||0)+1;
    if(attempts>=REPORT_MAX_ATTEMPTS){scheduleFailures.delete(key);try{agents.markScheduleNotified(x.id,kind);}catch{}console.error(`Schedule notification ${key} given up after ${attempts} attempts`);}
    else{scheduleFailures.set(key,{attempts,retryAt:now()+Math.min(60_000*attempts,10*60_000)});console.error(`Schedule notification ${key} failed, attempt ${attempts}`);}
   }
  }
 }
 // Diagnostics reports, as scope reports: one push per sender per quiet period, the rest marked.
 const diagnosticPush=new Map(),diagnosticFailures=new Map();
 async function flushDiagnostics(){
  const done=[];
  for(const r of agents.pendingDiagnosticNotifications?.()||[]){
   const failed=diagnosticFailures.get(r.id);if(failed&&now()<failed.retryAt)continue;
   try{
    const quiet=now()-(diagnosticPush.get(r.from)??-Infinity)<quietMs;
    if(r.status==='open'&&!quiet){await service.notifyAccessReport(diagnosticNotification(r),await admins());diagnosticPush.set(r.from,now());}
    diagnosticFailures.delete(r.id);done.push(r.id);
   }catch{
    const attempts=(failed?.attempts||0)+1;
    if(attempts>=REPORT_MAX_ATTEMPTS){diagnosticFailures.delete(r.id);done.push(r.id);console.error(`Diagnostic notification ${r.id} given up after ${attempts} attempts`);}
    else{diagnosticFailures.set(r.id,{attempts,retryAt:now()+Math.min(60_000*attempts,10*60_000)});console.error(`Diagnostic notification ${r.id} failed, attempt ${attempts}`);}
   }
  }
  if(done.length)agents.markDiagnosticsNotified(done);
 }
 // Scope reports, batched per agent: the first goes out at once; while that agent's quiet
 // period (quietMs) runs, the ones after it wait, and when it is over one push says how many
 // more there were. Nothing is marked as pushed unless a push really went out for it, and every
 // open report is in one: CC Agent's cap notice too. One already handled before its push needs
 // none. A push that keeps failing is retried less often, then hourly, never given up, and
 // never holding back the other agents'.
 async function flushReports(){
  const done=[],groups=new Map();
  for(const r of agents.pendingReportNotifications()){
   if(r.status!=='open'){done.push(r.id);continue;}
   const k=r.conversationId||r.id;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);
  }
  for(const [k,list] of groups){
   const failed=failures.get(k);if(failed&&now()<failed.retryAt)continue;
   if(now()-(lastPush.get(k)??-Infinity)<quietMs)continue;
   try{
    const n=list.length===1?reportNotification(list[0]):batchNotification(list);
    agents.markReportsQueuing?.(list.map(r=>r.id),n.replyId);
    const sent=await service.notifyAccessReport(n,await admins());
    // Queued for delivery: pushedAt waits for a device to take it (markReportsDelivered). None
    // queued (no admin device, or every one's pushes off): not queued again, it stays 已記錄.
    const ids=list.map(r=>r.id),none=sent&&typeof sent==='object'&&sent.pending===0;
    lastPush.set(k,now());failures.delete(k);agents.markReportsNotified(ids,none?[]:ids,n.replyId);
   }catch{
    // Never given up: past REPORT_MAX_ATTEMPTS it is tried hourly, so a report stays queued
    // (and one that joined the group late is in the next push) until a push goes out.
    const attempts=(failed?.attempts||0)+1;
    failures.set(k,{attempts,retryAt:now()+(attempts>=REPORT_MAX_ATTEMPTS?REPORT_SLOW_RETRY_MS:Math.min(60_000*attempts,10*60_000))});
    console.error(`Report notification for ${k} failed, attempt ${attempts}`);
   }
  }
  if(done.length)agents.markReportsNotified(done,[]);
 }
 // Separately, so a reply that cannot be sent does not hold back the reports. A
 // flush already running is joined, not started twice.
 function flush(){
  if(current)return current;
  if(!getPushConfig().available)return Promise.resolve();
  current=(async()=>{
   try{await flushReplies();}catch{console.error('Notification queue temporarily unavailable');}
   try{await flushReports();}catch{console.error('Report notification queue temporarily unavailable');}
   try{await flushSchedules();}catch{console.error('Schedule notification queue temporarily unavailable');}
   try{await flushDiagnostics();}catch{console.error('Diagnostic notification queue temporarily unavailable');}
  })().finally(()=>{current=null;});
  return current;
 }
 // A scope report counts as pushed once a push service accepted one delivery of it.
 const offSent=service.onSent?.((d)=>{const id=String(d?.replyId||'');if(id.startsWith('access-report'))try{agents.markReportsDelivered?.(id);}catch(e){console.error('report delivery mark:',e.message);}});
 service.start();void flush();const timer=setInterval(flush,1500);timer.unref();
 // The returned stop function also carries flush, to step the queue by hand.
 return Object.assign(()=>{clearInterval(timer);offSent?.();service.stop();},{flush});
}
module.exports={startNotifications,replyNotification,reportNotification,diagnosticNotification,scheduleNotification,scheduleFailureNotification,scheduleResultNotification,REPORT_QUIET_MS,REPORT_MAX_ATTEMPTS};
