const {getDefaultPushService}=require('./services/pushService');
const {getPushConfig}=require('./services/pushCrypto');
// One agent reply, as the push layer takes it.
function replyNotification(c,m){return {conversationId:c.id,replyId:m.id,ownerUserId:c.owner,agentName:c.title,replyText:m.notifyText||m.text,...(c.groupId?{groupId:c.groupId}:{})};}
// One new scope report, from what was stored when it was filed, so a retry builds
// the same notification even if the agent has been renamed since.
function reportNotification(r){return {kind:'access_report',conversationId:r.conversationId,replyId:'access-report:'+r.id,reportId:r.id,ownerUserId:r.owner,agentName:r.title,reportKind:r.kind,tool:r.tool};}
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
// An agent can file several reports in a row — up to five a turn, and one per
// refused request — and each would ring every admin's phone. One push per agent per
// quiet period; the others are marked all the same and wait in the review queue
// with the badge on the Admin tab's scope-reports row.
const REPORT_QUIET_MS=10*60_000;
// A report whose push keeps failing waits longer each time and is then given up, so
// it neither holds back the reports behind it nor retries every tick for ever.
const REPORT_MAX_ATTEMPTS=5;
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
 async function flushReports(){
  const done=[];
  for(const r of agents.pendingReportNotifications()){
   const failed=failures.get(r.id);if(failed&&now()<failed.retryAt)continue;
   try{
    // A report already handled before it went out needs no notification.
    const quiet=now()-(lastPush.get(r.conversationId)??-Infinity)<quietMs;
    if(r.status==='open'&&!quiet){await service.notifyAccessReport(reportNotification(r),await admins());lastPush.set(r.conversationId,now());}
    failures.delete(r.id);done.push(r.id);
   }catch{
    const attempts=(failed?.attempts||0)+1;
    if(attempts>=REPORT_MAX_ATTEMPTS){failures.delete(r.id);done.push(r.id);console.error(`Report notification ${r.id} given up after ${attempts} attempts`);}
    else{failures.set(r.id,{attempts,retryAt:now()+Math.min(60_000*attempts,10*60_000)});console.error(`Report notification ${r.id} failed, attempt ${attempts}`);}
   }
  }
  if(done.length)agents.markReportsNotified(done);
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
 service.start();void flush();const timer=setInterval(flush,1500);timer.unref();
 // The returned stop function also carries flush, for tests that step the queue.
 return Object.assign(()=>{clearInterval(timer);service.stop();},{flush});
}
module.exports={startNotifications,replyNotification,reportNotification,diagnosticNotification,scheduleNotification,scheduleFailureNotification,scheduleResultNotification,REPORT_QUIET_MS,REPORT_MAX_ATTEMPTS};
