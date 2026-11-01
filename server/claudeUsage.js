const {execFile}=require('node:child_process');
const fs=require('node:fs');
// How much of the owner's Claude subscription is used: the 5-hour and weekly
// windows /usage shows, for the admin's sidebar. It asks Anthropic with the login
// Claude Code keeps in this Mac's Keychain, the way /usage does.
//
// The token is read for each question and dropped: never cached, logged, returned
// or written anywhere, and never refreshed here. The token lasts hours and Claude Code
// renews it the next time it runs, so one past its time only means no agent has run
// lately; the login is called gone when a turn failed on it or a token still in date is
// refused. Answers are kept for five minutes, so however many pages ask, Anthropic is
// asked at most that often.
const ENDPOINT='https://api.anthropic.com/api/oauth/usage';
const KEEP_MS=5*60*1000,FAILED_KEEP_MS=60*1000,FRESH_MIN_MS=15*1000;
// Claude Code keeps its login under this computer's user name. Another item of the
// same service can appear (one under "unknown" holding only an MCP
// server's login), and the Keychain hands back whichever it finds first: the owner's
// account first, then any (需要重新登入 while logged in).
const tokenIn=text=>{try{const {accessToken:token,expiresAt}=JSON.parse(text).claudeAiOauth||{};return typeof token==='string'&&token?{value:token,expiresAt}:null;}catch{return null;}};
function readItem(args){
 return new Promise(resolve=>execFile('/usr/bin/security',['find-generic-password','-s','Claude Code-credentials',...args,'-w'],{timeout:10000,maxBuffer:65536},(error,stdout)=>{
  // The Keychain refusing (or a prompt left unanswered until the timeout) is told
  // apart from there being no Claude Code login in it.
  if(error)return resolve(error.code===44?null:{error:'keychain'});
  resolve(tokenIn(stdout));
 }));
}
// Windows has no Keychain: Claude Code keeps the same login in ~/.claude/.credentials.json.
function readCredentialsFile(){
 try{return tokenIn(fs.readFileSync(require('node:path').join(require('node:os').homedir(),'.claude','.credentials.json'),'utf8'));}catch{return null;}
}
async function readToken(){
 if(require('../channel/platform.cjs').isWin)return readCredentialsFile();
 let user='';try{user=require('node:os').userInfo().username;}catch{}
 const own=user?await readItem(['-a',user]):null;
 return own&&!own.error?own:readItem([]);
}
// How much of the week one 5-hour window is worth has no published figure
// (not in Anthropic's help pages), so it is measured: within one 5-hour
// window, how far the weekly figure rose against the 5-hour one. With enough of
// that the current window is drawn as its share of the week, a brighter end of the
// weekly bar. Only these percentages are kept.
const MIN_FIVE_HOUR_RISE=5,MAX_STEPS=200;
function ratioKeeper(file){
 let state={steps:[],last:null};
 if(file){try{const s=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(s.steps))state={steps:s.steps.slice(-MAX_STEPS),last:s.last||null};}catch{}}
 const save=()=>{if(!file)return;try{const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});fs.renameSync(tmp,file);}catch{}};
 return {
  note(five,week,resetsAt){
   if(!Number.isFinite(five)||!Number.isFinite(week))return;
   const last=state.last;
   if(last&&last.resetsAt===resetsAt&&five>last.five&&week>=last.week)state.steps=[...state.steps,{five:five-last.five,week:week-last.week}].slice(-MAX_STEPS);
   state.last={five,week,resetsAt};save();
  },
  ratio(){
   const five=state.steps.reduce((n,s)=>n+s.five,0),week=state.steps.reduce((n,s)=>n+s.week,0);
   return five>=MIN_FIVE_HOUR_RISE&&week>0?week/five:null;
  },
 };
}
const windowOf=w=>w&&Number.isFinite(w.utilization)?{percent:Math.max(0,Math.min(100,Math.round(w.utilization))),resetsAt:typeof w.resets_at==='string'?w.resets_at:null}:null;
function create({token=readToken,fetchImpl=globalThis.fetch,now=Date.now,ratioFile=null,loginFailed=()=>false}={}){
 let kept=null,pending=null,good=null,blockedUntil=0;const ratios=ratioKeeper(ratioFile);
 async function ask(){try{return await question();}catch{return {error:'unavailable'};}}
 async function question(){
  const secret=await token();
  if(secret?.error)return {error:secret.error};
  const value=typeof secret==='string'?secret:secret?.value;
  if(typeof value!=='string'||!value)return {error:'no-login'};
  if(Number.isFinite(secret?.expiresAt)&&secret.expiresAt<=now())return {error:loginFailed()?'login-expired':'login-idle'};
  let response;
  try{response=await fetchImpl(ENDPOINT,{headers:{Authorization:'Bearer '+value,'anthropic-beta':'oauth-2025-04-20'},signal:AbortSignal.timeout(15000)});}
  catch{return {error:'unreachable'};}
  if(response.status===401||response.status===403)return {error:'login-expired'};
  // Asked too often (Anthropic's 429): wait as long
  // as it says, ten minutes when it does not, two hours at most.
  if(response.status===429){const after=Number(response.headers?.get?.('retry-after'));return {error:'rate-limited',waitMs:Math.min(2*3600_000,Number.isFinite(after)&&after>0?after*1000:600_000)};}
  if(!response.ok)return {error:'unavailable'};
  let body;try{body=await response.json();}catch{return {error:'unavailable'};}
  if(!body||typeof body!=='object')return {error:'unavailable'};
  // The weekly window is what is shown; the 5-hour one
  // only measures, and adds the current window's share of the week once known.
  const sevenDay=windowOf(body.seven_day);
  if(!sevenDay)return {error:'unavailable'};
  // The 5-hour window itself, for the Admin page.
  const fiveHour=windowOf(body.five_hour),also=fiveHour?{fiveHour}:{};
  const five=body.five_hour?.utilization,week=body.seven_day?.utilization;
  ratios.note(five,week,body.five_hour?.resets_at??null);
  const ratio=ratios.ratio();
  if(ratio===null||!Number.isFinite(five))return {sevenDay,...also};
  const share=Math.min(week,Math.max(0,five*ratio));
  return {sevenDay,...also,session:{share:Math.round(share*10)/10}};
 }
 // fresh: the owner pulled the Admin page down to refresh; asked again
 // unless the kept answer is only seconds old.
 return async function usage({fresh=false}={}){
  // While Anthropic asks us to wait, nobody asks, not even a pull to refresh.
  if(blockedUntil>now())return kept.value;
  const keep=fresh?FRESH_MIN_MS:kept?.value.error?FAILED_KEEP_MS:KEEP_MS;
  if(kept&&now()-kept.at<keep)return kept.value;
  // When it was asked, not answered: an answer proves the login only as of then.
  const askedAt=now();
  pending??=ask().then(({waitMs,...value})=>{
   if(value.error==='rate-limited'){
    blockedUntil=now()+waitMs;const retryAt=new Date(blockedUntil).toISOString();
    // The last numbers read stay up, marked with when they were read.
    kept={at:now(),value:good?{...good,stale:true,retryAt}:{...value,retryAt,checkedAt:new Date(now()).toISOString()}};
    return kept.value;
   }
   kept={at:now(),value:{...value,checkedAt:new Date(askedAt).toISOString()}};
   if(!value.error)good=kept.value;
   return kept.value;
  }).finally(()=>{pending=null;});
  return pending;
 };
}
module.exports={create,ENDPOINT};
