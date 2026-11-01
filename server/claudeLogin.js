const {spawn:realSpawn}=require('node:child_process');
const os=require('node:os');
const agentEnv=require('../channel/agentEnv.cjs');
// Signing Claude Code in again from the chat: the
// page shows the sign-in address and takes the code it gives, so a phone can do it with
// no terminal. It runs Claude Code's own `auth login`, which stores the login as /login
// does, as a process of its own: an agent's terminal is not touched, busy or not.
//
// The code is written to that process and kept nowhere: not stored, logged or returned.
// One sign-in at a time for the whole machine, since all its agents share the login.
const WAIT_MS=10*60_000,CHECK_MS=60_000,KILL_AFTER_MS=3000,MAX_OUTPUT=64*1024,MAX_CODE_TRIES=5;
// The address the page will open comes from a program's output, so only these hosts.
const HOSTS=/^(?:[a-z0-9-]+\.)*(?:claude\.ai|claude\.com|anthropic\.com)$/i;
// As Claude Code prints it: "<code>#<state>", one line.
const CODE=/^[^\s#]{1,1000}#[^\s#]{1,1000}$/;
const clean=text=>String(text).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g,'');
// Only one the output has finished printing: a pipe can cut it in two, and half an
// address on the right host still looks like one.
function addressIn(output){
 for(const match of clean(output).matchAll(/https?:\/\/\S+(?=\s)/g)){
  try{const url=new URL(match[0]);if(url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&HOSTS.test(url.hostname))return url.href;}catch{}
 }
 return null;
}
// What the process gets of the server's environment: what an agent gets (agentEnv.cjs),
// none of the server's secrets or a stray login setting.
const loginEnv=(env=process.env)=>({...agentEnv(env),TERM:'dumb',NO_COLOR:'1'});
function create({program,spawn=realSpawn,onSuccess=()=>{},env=loginEnv,waitMs=WAIT_MS,checkMs=CHECK_MS,killAfterMs=KILL_AFTER_MS}={}){
 let flow=null,last={status:'idle',url:null,error:''},alive=null;
 const view=()=>flow?{status:flow.status,url:flow.url,error:flow.error}:{...last};
 function end(current,status,error=''){
  if(flow!==current)return;
  clearTimeout(current.timer);flow=null;last={status,url:null,error};
  if(status==='done'){try{onSuccess();}catch(e){console.error('claude login success:',e.message);}}
 }
 function stop(current){
  try{current.child.kill('SIGTERM');}catch{}
  const hard=setTimeout(()=>{if(current.child.exitCode===null&&current.child.signalCode===null){try{current.child.kill('SIGKILL');}catch{}}},killAfterMs);hard.unref?.();
 }
 function limit(current,ms){
  clearTimeout(current.timer);
  current.timer=setTimeout(()=>{const f=current;end(f,'failed','登入等太久，已取消。請再試一次。');stop(f);},ms);current.timer.unref?.();
 }
 function start(){
  if(flow)return view();
  let child;
  const current={status:'starting',url:null,error:'',output:'',tries:0,child:null,timer:null};
  try{child=spawn(program(),['auth','login','--claudeai'],{cwd:os.homedir(),env:env(),stdio:['pipe','pipe','pipe']});}
  catch(e){last={status:'failed',url:null,error:e.status?e.message:'無法啟動 Claude Code 的登入。'};return view();}
  current.child=child;flow=current;alive=child;limit(current,waitMs);
  const take=chunk=>{
   if(current.output.length<MAX_OUTPUT)current.output+=String(chunk);
   refused(chunk);
   if(!current.url){const url=addressIn(current.output);if(url){current.url=url;if(current.status==='starting')current.status='waiting';}}
  };
  // A code it refused leaves it waiting for another.
  const refused=chunk=>{if(/Invalid code/i.test(clean(chunk))&&flow===current&&current.status==='checking'){current.status='waiting';current.error='代碼不完整，請重新複製後再貼一次。';limit(current,waitMs);}};
  child.stdout.on('data',take);
  child.stderr.on('data',refused);
  child.stdin.on('error',()=>{});
  child.on('error',()=>end(current,'failed','無法啟動 Claude Code 的登入。'));
  child.on('close',code=>{
   if(alive===child)alive=null;
   if(code===0&&/Login successful/i.test(clean(current.output)))return end(current,'done');
   end(current,'failed','登入沒有完成，請再試一次。');
  });
  return view();
 }
 function code(text){
  const value=typeof text==='string'?text.trim():'';
  if(!flow||flow.status==='starting')throw Object.assign(new Error('目前沒有等待代碼的登入，請重新開始。'),{status:409});
  if(!CODE.test(value))throw Object.assign(new Error('代碼不完整，請重新複製後再貼一次。'),{status:400});
  if(flow.status==='checking')throw Object.assign(new Error('正在確認代碼，請稍候。'),{status:409});
  if(++flow.tries>MAX_CODE_TRIES){const f=flow;end(f,'failed','代碼錯誤太多次，已取消。請再試一次。');stop(f);return view();}
  flow.status='checking';flow.error='';limit(flow,checkMs);
  flow.child.stdin.write(value+'\n');
  return view();
 }
 function cancel(){
  if(!flow)return view();
  const f=flow;end(f,'idle');stop(f);
  return view();
 }
 // A new failure is a new question: the last outcome is not its answer.
 // The server going down: a sign-in is not left running with nobody to finish it.
 const shutdown=(signal='SIGTERM')=>{if(flow){const f=flow;end(f,'idle');}try{alive?.kill(signal);}catch{}};
 return {start,code,cancel,view,shutdown,running:()=>!!flow,forget(){if(!flow)last={status:'idle',url:null,error:''};}};
}
module.exports={create,addressIn,loginEnv};
