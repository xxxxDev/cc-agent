// Peer link: two CC Agent installs on different machines pair up, and agents an admin
// opened on both sides exchange messages (docs/PEER-LINK.md). Trust is per machine: the SSH key and its forced
// command, the pinned host key and the receiving side's own allow lists are the gates;
// which agent the other machine says sent a message is only what it says.
//
// The caller (the machine with CC_AGENT_PEER_SSH_CONFIG and CC_AGENT_PEER_SSH_HOST set)
// runs one exchange every 15-20 s over SSH; the other side answers it on
// /bridge/peer/exchange through scripts/peer-exchange.mjs. This file keeps the pairing
// state, the seen ids and the exchange; the messages themselves live in the agents'
// conversations (agentStore: peerCollect, peerDeliver, peerSettle).
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

const V=3;
const INVITE_MS=10*60_000,INVITE_TRIES=5,INVITES_HOURLY=10;
const SEEN_MS=7*24*3600_000,FUTURE_MS=5*60_000,OLD_MS=24*3600_000;
const ICON_BYTES=10*1024,BATCH_BYTES=190*1024,ITEM_BYTES=16*1024,BODY_BYTES=256*1024;
const POLL_MS=[15_000,20_000],BACKOFF_MAX_MS=5*60_000,SSH_TIMEOUT_MS=30_000;
const NAME=/^[^<>"'&\p{C}]{1,40}$/u;
const GONE='另一台已經沒有這個配對了：請在那台重新產生配對碼，再到這裡加入';
const ID=/^[A-Za-z0-9-]{8,80}$/;

const error=(message,status=400,code)=>Object.assign(new Error(message),{status,...(code?{code}:{})});
const now=()=>Date.now();
const iso=t=>new Date(t).toISOString();
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
// A code is shown in groups of four and typed back with or without the dashes, in
// either case; only its letters count.
const codeKey=code=>sha('cc-agent-peer-invite:'+String(code||'').toUpperCase().replace(/[^A-Z2-7]/g,''));
function newCode(){
 const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',b=crypto.randomBytes(20);
 return Array.from(b,x=>a[x&31]).join('').match(/.{4}/g).join('-');
}
const cleanName=v=>{const s=typeof v==='string'?v.trim():'';if(!NAME.test(s))throw error('名稱：1 到 40 個字，不能有 < > " \' &');return s;};

function create({stateRoot,audit=()=>{},store,env=process.env,spawnSsh}){
 const file=path.join(stateRoot,'peer-link.json');
 const blank=()=>({machineId:crypto.randomUUID(),invites:[],inviteLog:[],peers:[],seen:{}});
 let state;
 function load(){
  let raw=null;try{raw=fs.readFileSync(file,'utf8');}catch{}
  try{state=raw===null?null:JSON.parse(raw);}catch{state=null;}
  // A file that cannot be read is kept aside, not overwritten: the pairing then has to
  // be made again, which the page says.
  if(raw!==null&&(!state||typeof state!=='object')){try{fs.renameSync(file,file+'.unreadable-'+Date.now());}catch{}console.error('peer link: peer-link.json could not be read; kept aside, pairing starts afresh');}
  if(!state||typeof state!=='object'||typeof state.machineId!=='string')state=blank();
  for(const k of ['invites','inviteLog','peers'])if(!Array.isArray(state[k]))state[k]=[];
  if(!state.seen||typeof state.seen!=='object')state.seen={};
  return state;
 }
 function save(){
  const tmp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,file);
 }
 load();
 const caller=()=>!!(env.CC_AGENT_PEER_SSH_CONFIG&&env.CC_AGENT_PEER_SSH_HOST);
 const peer=pairId=>state.peers.find(p=>p.pairId===pairId&&p.state!=='removed');
 const live=()=>state.peers.filter(p=>p.state!=='removed');
 // Messages flow only when this side has it on and the other side said so last time.
 const flowing=p=>!!p&&p.state==='active'&&p.remote?.enabled===true&&p.remote?.paused!==true;
 const view=p=>({pairId:p.pairId,name:p.name,role:p.role,state:p.state,remoteMachineId:p.remoteMachineId,remote:{enabled:!!p.remote?.enabled,paused:!!p.remote?.paused},flowing:flowing(p),linkedAt:p.linkedAt,lastContact:p.lastContact||null,lastError:p.lastError||null,directory:p.directory||[],icon:p.icon||null});

 // ── Pairing ──
 // The answering side shows a code; one open at a time, ten an hour.
 function invite(by){
  if(caller())throw error('這台是主動連線的一方：請在另一台產生配對碼，再到這裡輸入',409);
  const t=now();
  state.inviteLog=state.inviteLog.filter(x=>x>t-3600_000);
  if(state.inviteLog.length>=INVITES_HOURLY)throw error('這一小時產生的配對碼太多了，請稍後再試',429);
  const code=newCode();
  state.invites=[{key:codeKey(code),expires:t+INVITE_MS,tries:0,by}];
  state.inviteLog.push(t);save();
  audit({source:'peer-link',action:'invite',by});
  return {code,expiresAt:iso(t+INVITE_MS)};
 }
 // The answering side, on a pair request in an exchange. A wrong code spends a try of
 // the open invite; five and it is gone (a new one can be made).
 function redeem(req){
  const t=now();
  state.invites=state.invites.filter(x=>x.expires>t&&x.tries<INVITE_TRIES);
  const inv=state.invites[0];
  if(!inv){save();return {ok:false,reason:'no-open-code'};}
  if(typeof req?.code!=='string'||req.code.length>64||!crypto.timingSafeEqual(Buffer.from(codeKey(req.code)),Buffer.from(inv.key))){inv.tries++;save();audit({source:'peer-link',action:'pair-refused',reason:'wrong-code'});return {ok:false,reason:'wrong-code'};}
  if(typeof req.machineId!=='string'||!ID.test(req.machineId)||req.machineId===state.machineId)return {ok:false,reason:'bad-machine'};
  state.invites=[];
  // A machine paired again starts a new pairing: the old one and what it queued are gone.
  for(const p of live().filter(p=>p.remoteMachineId===req.machineId))drop(p,'paired again');
  const p={pairId:crypto.randomUUID(),name:typeof req.name==='string'&&NAME.test(req.name.trim())?req.name.trim():'(unnamed)',role:'answerer',state:'linked',remoteMachineId:req.machineId,remote:{enabled:false,paused:false},linkedAt:iso(t),directory:[]};
  state.peers.push(p);save();
  audit({source:'peer-link',action:'linked',pairId:p.pairId,role:'answerer',by:inv.by});
  return {ok:true,pairId:p.pairId,machineId:state.machineId};
 }
 // The calling side: the admin typed the other machine's code.
 async function join({code,name,by}){
  if(!caller())throw error('這台沒有設定連到另一台的方式，請到另一台按「加入配對」',409);
  const label=cleanName(name);
  if(typeof code!=='string'||!code.trim())throw error('請輸入另一台畫面上的配對碼');
  let r;
  try{r=await call({v:V,from:{machineId:state.machineId},pair:{code:code.trim(),machineId:state.machineId,name:'(the other machine)'}});}
  catch(e){throw error('連不到另一台：'+e.message,502);}
  if(!r?.pair?.ok){audit({source:'peer-link',action:'join-refused',reason:r?.pair?.reason||'no answer',by});throw error(r?.pair?.reason==='wrong-code'?'配對碼不對，或已經過期':r?.pair?.reason==='no-open-code'?'另一台目前沒有可用的配對碼，請在那台重新產生':'對方拒絕配對',400);}
  if(typeof r.pair.pairId!=='string'||!ID.test(r.pair.pairId)||typeof r.pair.machineId!=='string'||!ID.test(r.pair.machineId))throw error('另一台的回應格式不對',502);
  // A pairing id this machine has seen before is not taken again: it would bring back
  // the ticks of the one removed.
  if(state.peers.some(x=>x.pairId===r.pair.pairId)){audit({source:'peer-link',action:'join-refused',reason:'known pairId',by});throw error('另一台的回應格式不對',502);}
  for(const p of live().filter(p=>p.remoteMachineId===r.pair.machineId))drop(p,'paired again');
  const p={pairId:r.pair.pairId,name:label,role:'caller',state:'linked',remoteMachineId:r.pair.machineId,remote:{enabled:false,paused:false},linkedAt:iso(now()),directory:[]};
  state.peers.push(p);save();
  audit({source:'peer-link',action:'linked',pairId:p.pairId,role:'caller',by});
  kick();
  return view(p);
 }
 // On, off, renamed, gone: each by an admin (the routes ask for the password where
 // it widens anything).
 function setState(pairId,to,by){
  const p=peer(pairId);if(!p)throw error('Not found',404);
  if(to==='active'){if(!['linked','paused','active'].includes(p.state))throw error('Not possible now',409);p.state='active';}
  else if(to==='paused'){if(p.state==='linked')throw error('Not on yet',409);p.state='paused';store.close(p.pairId,'the pairing was paused');}
  else throw error('Unknown state');
  save();audit({source:'peer-link',action:to==='active'?'enabled':'paused',pairId,by});kick();
  return view(p);
 }
 function rename(pairId,name,by){const p=peer(pairId);if(!p)throw error('Not found',404);p.name=cleanName(name);save();audit({source:'peer-link',action:'renamed',pairId,by});return view(p);}
 function drop(p,why){p.state='removed';p.removedAt=iso(now());p.directory=[];store.close(p.pairId,why);try{store.forget?.(p.pairId);}catch(e){console.error('peer ticks not cleared: '+e.message);}}
 function remove(pairId,by){const p=peer(pairId);if(!p)throw error('Not found',404);drop(p,'the pairing was removed');save();audit({source:'peer-link',action:'removed',pairId,by});return {ok:true};}

 // ── Exchange ──
 const ourState=p=>({enabled:p.state==='active',paused:p.state==='paused'});
 function forget(t){for(const [k,at] of Object.entries(state.seen))if(at<t-SEEN_MS)delete state.seen[k];}
 // What one side receives: settle what it sent (acks, refused), take the other side's
 // state and directory, deliver the items. Returns its acks and refusals.
 function receive(p,body){
  const t=now();
  if(body.state&&typeof body.state==='object')p.remote={enabled:body.state.enabled===true,paused:body.state.paused===true};
  const plain=(v,n)=>String(v||'').replace(/[\p{C}<>"'&\[\]\/]/gu,' ').trim().slice(0,n);
  // The other machine's own picture, for its agents in @ and on their messages: a small
  // PNG only.
  if(typeof body.icon==='string'){const m=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.icon);const b=m&&Buffer.from(m[1],'base64');p.icon=b&&b.length<=ICON_BYTES&&b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))?body.icon:null;}
  if(Array.isArray(body.directory))p.directory=body.directory.slice(0,200).filter(x=>x&&typeof x.agentId==='string'&&ID.test(x.agentId)).map(x=>({agentId:x.agentId,title:plain(x.title,80),owner:plain(x.owner,64)}));
  const settled=[...(Array.isArray(body.acks)?body.acks:[]).filter(x=>typeof x==='string').slice(0,200).map(id=>({id,ok:true})),
   ...(Array.isArray(body.refused)?body.refused:[]).filter(x=>x&&typeof x.id==='string').slice(0,200).map(x=>({id:x.id,ok:false,retry:x.retry===true,reason:String(x.reason||'refused').slice(0,200)}))];
  if(settled.length)store.settle(p.pairId,settled);
  const acks=[],refused=[];
  const items=Array.isArray(body.items)?body.items.slice(0,100):[];
  forget(t);
  for(const it of items){
   const id=typeof it?.id==='string'&&ID.test(it.id)?it.id:null;
   if(!id)continue;
   const key=p.pairId+':'+id;
   if(state.seen[key]){acks.push(id);continue;}
   const no=(reason,retry=false)=>{refused.push({id,reason,...(retry?{retry:true}:{})});};
   if(it.pairId!==p.pairId){no('wrong pairing');continue;}
   if(!flowing(p)){no('the pairing is not on at this end',true);continue;}
   const at=Date.parse(it.at);
   if(!Number.isFinite(at)||at>t+FUTURE_MS||at<t-OLD_MS){no('too old or from the future');continue;}
   if(Buffer.byteLength(JSON.stringify(it))>ITEM_BYTES){no('too large');continue;}
   const r=store.deliver(p,it);
   if(r.ok){state.seen[key]=t;acks.push(id);}
   else no(r.reason,r.retry===true);
  }
  p.lastContact=iso(t);p.lastError=null;
  save();
  return {acks,refused};
 }
 function outgoing(p){return flowing(p)?store.collect(p.pairId,BATCH_BYTES):[];}
 const envelope=(p,extra)=>({v:V,pairId:p.pairId,from:{machineId:state.machineId},state:ourState(p),directory:store.directory(p.pairId),...(store.icon?.()?{icon:store.icon()}:{}),...extra});
 // The answering side: one call from the caller.
 function answer(body){
  if(caller())throw error('Not found',404);
  if(!body||body.v!==V)throw error('Unknown version',400);
  if(body.pair)return {v:V,pair:redeem(body.pair)};
  const p=peer(body.pairId);
  if(!p||p.remoteMachineId!==body.from?.machineId)return {v:V,unknownPair:true};
  const {acks,refused}=receive(p,body);
  return envelope(p,{items:outgoing(p),acks,refused});
 }
 // ── The caller ──
 function sshCall(payload){
  return new Promise((resolve,reject)=>{
   // The host key pinned whatever the config file says.
   const args=['-F',env.CC_AGENT_PEER_SSH_CONFIG,'-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ClearAllForwardings=yes',env.CC_AGENT_PEER_SSH_HOST];
   const child=spawn('ssh',args,{shell:false,stdio:['pipe','pipe','pipe']});
   let out=Buffer.alloc(0),done=false;
   const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);try{child.kill('SIGKILL');}catch{}e?reject(e):resolve(v);};
   const timer=setTimeout(()=>finish(new Error('timed out')),SSH_TIMEOUT_MS);
   child.stdout.on('data',d=>{out=Buffer.concat([out,d]);if(out.length>BODY_BYTES)finish(new Error('answer too large'));});
   child.stderr.on('data',()=>{});
   child.on('error',e=>finish(new Error('ssh: '+e.code)));
   child.on('close',code=>{if(done)return;let v;try{v=JSON.parse(out.toString('utf8'));}catch{return finish(new Error(code?'ssh exited '+code:'unreadable answer'));}if(v?.error)return finish(new Error(String(v.error).slice(0,100)));finish(null,v);});
   child.stdin.on('error',()=>{});
   child.stdin.end(JSON.stringify(payload));
  });
 }
 const call=payload=>(spawnSsh||sshCall)(payload);
 let timer=null,running=false,failures=0,again=false;
 async function exchangeOnce(){
  const ps=live().filter(p=>p.role==='caller');
  for(const p of ps){
   const items=outgoing(p),sent=new Set(items.map(x=>x.id));
   try{
    const r=await call(envelope(p,{items,acks:p.pendingAcks||[],refused:p.pendingRefused||[]}));
    if(r?.unknownPair){
     // Gone at the other end: what waits for it will not go.
     if(p.lastError!==GONE)store.close(p.pairId,'the other machine no longer has this pairing');
     p.lastError=GONE;p.remote={enabled:false,paused:false};save();continue;
    }
    if(r?.v!==V||r.pairId!==p.pairId||r.from?.machineId!==p.remoteMachineId)throw new Error('unexpected answer');
    // Its acks for what we sent come back now; ours for what it sent go out next time.
    const {acks,refused}=receive(p,r);
    p.pendingAcks=acks;p.pendingRefused=refused;save();
    failures=0;
   }catch(e){
    store.release(p.pairId,[...sent]);
    p.lastError=String(e.message||e).slice(0,200);save();failures++;
    audit({source:'peer-link',action:'exchange-failed',pairId:p.pairId,error:p.lastError});
   }
  }
 }
 function schedule(ms){
  clearTimeout(timer);
  timer=setTimeout(async()=>{
   if(running){again=true;return;}
   running=true;
   try{await exchangeOnce();}catch(e){console.error('peer link:',e.message);}
   running=false;
   const base=POLL_MS[0]+Math.floor(Math.random()*(POLL_MS[1]-POLL_MS[0]));
   schedule(again?2000:failures?Math.min(BACKOFF_MAX_MS,base*2**Math.min(failures,4)):base);again=false;
  },ms);
  timer.unref?.();
 }
 // Something to send: sooner than the next round, two seconds to gather it.
 function kick(){if(caller()&&live().some(p=>p.role==='caller'))schedule(running?0:2000);}
 function start(){if(caller()&&live().some(p=>p.role==='caller'))schedule(3000);}
 function stopTimer(){clearTimeout(timer);timer=null;}

 return {
  machineId:()=>state.machineId,caller,
  list:()=>({machineId:state.machineId,role:caller()?'caller':'answerer',invite:state.invites.find(x=>x.expires>now()&&x.tries<INVITE_TRIES)?{expiresAt:iso(state.invites[0].expires)}:null,peers:live().map(view)}),
  peer:pairId=>{const p=peer(pairId);return p?view(p):null;},
  flowing:pairId=>flowing(peer(pairId)),
  liveIds:()=>live().map(p=>p.pairId),
  pairs:()=>live().filter(flowing).map(p=>({pairId:p.pairId,name:p.name,directory:p.directory||[],icon:p.icon||null})),
  linked:()=>live().map(p=>({pairId:p.pairId,name:p.name,directory:p.directory||[]})),
  invite,join,setState,rename,remove,answer,kick,start,stop:stopTimer,exchangeOnce,
  _state:()=>state,
 };
}
module.exports={create,V,BODY_BYTES,ITEM_BYTES,BATCH_BYTES,codeKey};
