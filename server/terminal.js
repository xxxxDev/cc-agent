const {WebSocketServer}=require('ws');
const jwt=require('jsonwebtoken');
const {resolveLivePrincipal}=require('./services/livePrincipal');
const agents=require('./agentStore');
const agentEnv=require('../channel/agentEnv.cjs');
const platform=require('../channel/platform.cjs');
const runtimeTools=require('../channel/runtimeTools.cjs');
const {audit}=require('./services/audit');
const {resolveClientIp}=require('./services/clientIp');
// One PTY per browser attachment. It runs only `tmux attach-session`, never Claude.
//
// The attachment is confined to its own agent. With
// tmux's defaults the web terminal could reach a raw shell or any other user's
// agent session: C-b : opens the command prompt, and even with no prefix, mouse on
// brings the root table's right-click menus: split a pane, new window, next
// session. So the session gets no prefix, no status line, and an empty key table
// of its own, in which only the harmless mouse bindings are put back: clicks and
// the wheel go to Claude's full-screen UI, or scroll in copy mode.
// Every attach and every refusal is audited; these upgrades never pass through
// Express, so the API audit could not see them.
const LOCKED='cc-agent-locked';
const {execFileSync}=require('node:child_process');
// The tmux to attach with: the very program the agents' tmux server runs. A server
// started by an older tmux outlives an upgrade, and a newer client cannot open a
// terminal on it ("open terminal failed: not a terminal", seen with a 3.5a server and a
// 3.8 client), while starting sessions still works. Any other
// answer (no server, its program gone, not named tmux) leaves the one on PATH.
// A tmux server by name (-L) or, a path, by its socket file (-S: the shell tabs' one).
const socketArgs=socket=>String(socket).startsWith('/')?['-S',socket]:['-L',socket];
function serverTmux(socket){
 if(platform.isWin)return runtimeTools.resolveOnPath('tmux')?.path||'tmux.exe';
 try{
  socket=socket||require('./agentStore').tmuxSocket;
  const pid=execFileSync('tmux',[...socketArgs(socket),'list-sessions','-F','#{pid}'],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']}).trim().split('\n')[0];
  if(!/^\d+$/.test(pid))return 'tmux';
  const bin=execFileSync('ps',['-o','comm=','-p',pid],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']}).trim();
  const p=require('node:path'),fs=require('node:fs');
  return p.isAbsolute(bin)&&p.basename(bin)==='tmux'&&fs.statSync(bin).isFile()?bin:'tmux';
 }catch{return 'tmux';}
}
function sessionAlive(session){if(!session)return false;try{execFileSync('tmux',['-L',require('./agentStore').tmuxSocket,'has-session','-t',String(session).split(':')[0]],{stdio:'ignore',timeout:2000});return true;}catch{return false;}}
const attachArgs=(session,socket=require('./agentStore').tmuxSocket)=>[...socketArgs(socket),
 'set-option','-t',session,'mouse','on',';',
 'set-option','-t',session,'prefix','None',';','set-option','-t',session,'prefix2','None',';',
 'set-option','-t',session,'key-table',LOCKED,';','set-option','-t',session,'status','off',';',
 'bind-key','-T',LOCKED,'MouseDown1Pane','send-keys','-M',';',
 'bind-key','-T',LOCKED,'MouseDrag1Pane','if-shell','-F','#{||:#{pane_in_mode},#{mouse_any_flag}}','send-keys -M','copy-mode -M',';',
 'bind-key','-T',LOCKED,'WheelUpPane','if-shell','-F','#{||:#{alternate_on},#{pane_in_mode},#{mouse_any_flag}}','send-keys -M','copy-mode -e',';',
 'attach-session','-t',session];
function installTerminal(server,{tmuxClient=serverTmux,ptyModule=require('node-pty'),tickMs=3000,sessionAlive:alive=sessionAlive,shells=agents.shells,hosts=require('./hostTerminal').shared()}={}){
 const wss=new WebSocketServer({noServer:true,maxPayload:65536});
 // A connection refused before anyone is known takes no sign-in to make: at most
 // thirty lines a minute of those in the audit log.
 let auditMinute=0,audited=0;const mayAudit=()=>{const m=Math.floor(Date.now()/60000);if(m!==auditMinute){if(audited>30)audit({source:'terminal',action:'refusals-not-logged',count:audited-30});auditMinute=m;audited=0;}return ++audited<=30;};
 // A Terminal tab's terminal: the admin's own, attached as a shell tab is (no prefix, no menus).
 async function attachHost(req,socket,head,hostId,n,reject,known){
  if(require('../channel/platform.cjs').isWin)return reject(socket,409);
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));const token=cookies.session_id;
  if(!token)return reject(socket,401);
  let decoded;try{decoded=jwt.verify(token,process.env.JWT_SECRET);}catch{return reject(socket,401);}
  const principal=await resolveLivePrincipal(token,decoded.id);if(!principal)return reject(socket,401);known(principal);
  if(principal.role!=='admin'||!agents.ownerIsActiveAdmin(principal.id))return reject(socket,403);
  // This computer's own shell follows the admin page's shell-tab switch, as the agents' shell tabs do.
  if(hostId==='local'&&!agents.shellTabsOn())return reject(socket,403);
  if(!hosts.alive(principal.id,hostId,n))return reject(socket,404);
  const target='host/'+principal.id+'/'+hostId+'/'+n;
  if([...wss.clients].filter(ws=>ws.target===target).length>=2)return reject(socket,429);
  if(socket.destroyed)return;
  wss.handleUpgrade(req,socket,head,ws=>{
   ws.target=target;let terminal,timer,closed=false,outBuf='',outTimer=null;
   const sendRaw=data=>{if(ws.readyState===1){if(ws.bufferedAmount>2*1024*1024)return close();ws.send(JSON.stringify(data));}};
   const flushData=()=>{if(outTimer!==null){clearTimeout(outTimer);outTimer=null;}if(!outBuf)return;const data=outBuf;outBuf='';sendRaw({type:'data',data});};
   const send=data=>{flushData();sendRaw(data);};
   const close=(dead=false)=>{if(closed)return;closed=true;flushData();clearInterval(timer);try{terminal?.kill();}catch{}if(dead)ws.terminate();else ws.close();};
   ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});let ticks=0;
   audit({source:'terminal',path:req.url,status:101,username:principal.username,role:principal.role,host:hostId,ip:resolveClientIp(req)});
   try{terminal=ptyModule.spawn(tmuxClient(hosts.socket),attachArgs(hosts.nameOf(principal.id,hostId,n),hosts.socket),{name:'xterm-256color',cols:100,rows:30,cwd:agents.stateRoot,env:{...agentEnv(),TERM:'xterm-256color',LC_CTYPE:'en_US.UTF-8'}});}catch(e){send({type:'error',message:'無法附接終端'});return close();}
   terminal.onData(data=>{outBuf+=data;if(outBuf.length>=65536)flushData();else if(outTimer===null)outTimer=setTimeout(flushData,12);});
   terminal.onExit(()=>{send({type:'closed'});close();});
   let windowStart=Date.now(),bytes=0;
   ws.on('message',raw=>{try{if(Date.now()-windowStart>1000){windowStart=Date.now();bytes=0;}bytes+=raw.length;if(bytes>131072)return close();
    const msg=JSON.parse(raw.toString());
    if(msg.type==='input'&&typeof msg.data==='string'&&msg.data.length<=16000)terminal.write(msg.data);
    else if(msg.type==='resize'&&Number.isInteger(msg.cols)&&Number.isInteger(msg.rows)&&msg.cols>=20&&msg.cols<=400&&msg.rows>=5&&msg.rows<=200)terminal.resize(msg.cols,msg.rows);
    else close();}catch{close();}});
   ws.on('close',()=>close());ws.on('error',()=>close(true));
   let checking=false;timer=setInterval(async()=>{
    if(++ticks%5===0){if(!ws.isAlive)return close(true);ws.isAlive=false;try{ws.ping();}catch{}send({type:'ping'});}
    if(checking)return;checking=true;try{const current=await resolveLivePrincipal(token,principal.id);if(!current)close();else if(current.role!=='admin'){close();try{hosts.closeUser(principal.id);}catch{}}}catch{close();}finally{checking=false;}},tickMs);
   send({type:'connected',host:hostId,n});
  });
 }
 server.on('upgrade',async(req,socket,head)=>{
  // The page's live-update socket has its own handler (liveUpdates.js).
  if((req.url||'').split('?')[0]==='/live')return;
  socket.on('error',()=>{});
  let who;
  const reject=(socket,status)=>{if(who||mayAudit())audit({source:'terminal',path:req.url,status,username:who?.username,role:who?.role});socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);};
  try{
   if(!require('./siteConfig').isAllowedSocket(req))return reject(socket,403);
   // /terminal/<agent> is its Claude session; /terminal/<agent>/sh/<n> one of the shells its
   // terminal page opened in tabs (server/terminalShells.js).
   // /terminal/host/<machine>/<n>: one of the Terminal tab's terminals (server/hostTerminal.js).
   const hostMatch=/^\/terminal\/host\/(local|s-[a-f0-9]{12}|c-[a-f0-9]{2,128})\/([1-9]\d{0,5})$/.exec(req.url||'');
   if(hostMatch)return attachHost(req,socket,head,hostMatch[1],Number(hostMatch[2]),reject,w=>{who=w;});
   const match=/^\/terminal\/([a-f0-9-]{36})(?:\/sh\/([1-9]\d{0,5}))?$/.exec(req.url||'');if(!match)return reject(socket,404);const shellN=match[2]?Number(match[2]):null;
   const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));const token=cookies.session_id;
   if(!token)return reject(socket,401);
   let decoded;try{decoded=jwt.verify(token,process.env.JWT_SECRET);}catch{return reject(socket,401);}
   const principal=await resolveLivePrincipal(token,decoded.id);if(!principal)return reject(socket,401);who=principal;
   if(principal.role!=='admin')return reject(socket,403);
   const c=agents.get(match[1],principal.id),g=agents.active(c);
   // An agent marked failed may still be running in its tmux session, a start that
   // never finished its handshake for one: its terminal is what shows why, so it can
   // be attached while that session lives.
   // A shell lives on whatever the agent does; its own session has to be there.
   if(shellN!==null){if(!agents.shellTabsOn())return reject(socket,403);if(c.mode!=='claude')return reject(socket,409);if(!shells.alive(c,shellN))return reject(socket,404);}
   else if(c.mode!=='claude'||g.phase==='stopped'||g.phase==='error'&&!alive(g.tmux))return reject(socket,409);
   const target=shellN===null?c.id:c.id+'/sh/'+shellN;
   if([...wss.clients].filter(ws=>ws.target===target).length>=2)return reject(socket,429);
   const generationToken=g.token;
   if(socket.destroyed)return;
   wss.handleUpgrade(req,socket,head,ws=>{
    ws.conversationId=c.id;ws.target=target;
    let terminal,timer,closed=false;
    // A shell is let go when it is closed or its agent deleted (its session ends, and the
    // attachment with it), not when the agent stops or starts a new session.
    const valid=()=>shellN!==null?!c.archived&&agents.shellTabsOn():agents.active(c)===g&&g.token===generationToken&&g.phase!=='stopped';
    // A tmux redraw burst is dozens of PTY chunks a second, each paying stringify
    // + a ws frame + a client parse when sent alone. Concatenated here and flushed
    // as one frame: on a 12 ms timer (xterm's write parser yields at the same
    // pace, and it stays inside one 60 fps frame), past 64 KB, and ahead of any
    // other frame so nothing overtakes the output.
    let outBuf='',outTimer=null;
    // A backlog this size means the client cannot keep up; closing lets it
    // reattach clean instead of lagging further behind forever.
    const sendRaw=data=>{if(ws.readyState===1){if(ws.bufferedAmount>2*1024*1024)return close();ws.send(JSON.stringify(data));}};
    const flushData=()=>{if(outTimer!==null){clearTimeout(outTimer);outTimer=null;}if(!outBuf)return;const data=outBuf;outBuf='';sendRaw({type:'data',data});};
    const send=data=>{flushData();sendRaw(data);};
    const close=(dead=false)=>{if(closed)return;closed=true;flushData();clearInterval(timer);try{terminal?.kill();}catch{}if(dead)ws.terminate();else ws.close();};
    // A connection can die without a word: a phone puts the app away, a computer
    // sleeps, a network changes. The page kept the last screen as if still attached
    // (the terminal sometimes stops updating), and a
    // dead one also held one of the two places an agent's terminal has. Every fifth
    // tick (15 s) the page is told the line is alive, and one that has not answered
    // the last ping is let go.
    ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});
    let ticks=0;
    // From where, too: the same address the sign-in records keep.
    audit({source:'terminal',path:req.url,status:101,username:principal.username,role:principal.role,conversation:c.id,ip:resolveClientIp(req)});
    try{terminal=ptyModule.spawn(shellN===null?tmuxClient():tmuxClient(shells.socket),shellN===null?attachArgs(g.tmux):attachArgs(shells.nameOf(c,shellN),shells.socket),{name:'xterm-256color',cols:100,rows:30,cwd:agents.stateRoot,env:{...agentEnv(),TERM:'xterm-256color'}});}catch{send({type:'error',message:'無法附接終端，請確認此對話仍在執行。'});return close();}
    terminal.onData(data=>{if(!valid())return close();outBuf+=data;if(outBuf.length>=65536)flushData();else if(outTimer===null)outTimer=setTimeout(flushData,12);});
    terminal.onExit(()=>{send({type:'closed'});close();});
    let windowStart=Date.now(),bytes=0;
    ws.on('message',raw=>{
     if(!valid())return close();
     try{if(Date.now()-windowStart>1000){windowStart=Date.now();bytes=0;}bytes+=raw.length;if(bytes>131072)return close();
      const msg=JSON.parse(raw.toString());
      if(msg.type==='input'&&typeof msg.data==='string'&&msg.data.length<=16000)terminal.write(msg.data);
      else if(msg.type==='resize'&&Number.isInteger(msg.cols)&&Number.isInteger(msg.rows)&&msg.cols>=20&&msg.cols<=400&&msg.rows>=5&&msg.rows<=200)terminal.resize(msg.cols,msg.rows);
      else close();
     }catch{close();}
    });
    ws.on('close',()=>close());ws.on('error',()=>close(true));
    let checking=false;timer=setInterval(async()=>{
     if(++ticks%5===0){if(!ws.isAlive)return close(true);ws.isAlive=false;try{ws.ping();}catch{}send({type:'ping'});}
     if(checking)return;checking=true;try{const current=await resolveLivePrincipal(token,principal.id);if(!valid()||current?.role!=='admin')close();}catch{close();}finally{checking=false;}},tickMs);
    send(shellN===null?{type:'connected',sessionId:g.sessionId}:{type:'connected',shell:shellN});
   });
  }catch(e){reject(socket,e.status||500);}
 });
 const close=()=>{for(const ws of wss.clients)ws.close();wss.close();};
 return {close,wss};
}
module.exports={installTerminal,attachArgs,serverTmux};
