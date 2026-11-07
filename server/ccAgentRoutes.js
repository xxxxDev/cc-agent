const agents=require('./agentStore');
const attachments=require('./attachments');
const express=require('express');
const {verifyToken}=require('./middlewares/authMiddleware');
exports.installBridge=app=>{
app.use('/bridge',(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.headers.origin)return res.status(403).end();next();});
// The answering side's key for the other machine's forced command (peer link).
try{agents.peerKey();}catch(e){console.error('peer key:',e.message);}
// The other machine's exchange (peer link), before the per-agent route would take it.
app.post('/bridge/peer/exchange',(req,res,next)=>{try{res.json(agents.peerExchange((req.headers.authorization||'').replace(/^Bearer /,''),req.body||{}));}catch(e){next(e);}});
app.all('/bridge/peer/:any',(req,res)=>res.status(404).json({message:'Not found'}));
app.all('/bridge/:id/:action',(req,res,next)=>{try{
 const c=agents.byToken(req.params.id,(req.headers.authorization||'').replace(/^Bearer /,''));
 res.json(agents.bridge(c,req.params.action,req.method==='GET'?req.query:req.body));
}catch(e){next(e);}});

};
exports.installAgentRoutes=app=>{app.use('/api/conversations',verifyToken);app.use('/api/groups',verifyToken);app.use('/api/preferences',verifyToken);
const adminOnly=(req,res,next)=>req.role==='admin'?next():res.status(403).json({message:'Admin only'});
// The peer link (docs/PEER-LINK.md): pairing this machine with another, and an
// agent opened to it. Whatever widens it asks for the admin's password and code again;
// pausing does not.
{
const auth=require('./controllers/authController');
const again=how=>async(req,res,next)=>{try{if(await auth.adminAgain(req,res,how,'peer-link'))next();}catch(e){next(e);}};
const done=(req,res,v)=>{auth.adminGranted(req,'peer-link');res.json(v);};
const kept=(req,next)=>e=>{auth.adminKept(req);next(e);};
const peerRoutes=[verifyToken,adminOnly,(req,res,next)=>{res.set('Cache-Control','private, no-store');next();}];
app.get('/api/peer-link',...peerRoutes,(req,res)=>res.json(agents.peerLink.list()));
app.post('/api/peer-link/invite',...peerRoutes,again('peer-invite'),(req,res,next)=>{try{done(req,res,agents.peerLink.invite(req.username));}catch(e){kept(req,next)(e);}});
app.post('/api/peer-link/join',...peerRoutes,again('peer-join'),(req,res,next)=>{agents.peerLink.join({code:req.body?.code,name:req.body?.name,by:req.username}).then(v=>done(req,res,v),kept(req,next));});
app.post('/api/peer-link/:pairId/enable',...peerRoutes,again('peer-enable'),(req,res,next)=>{try{done(req,res,agents.peerLink.setState(req.params.pairId,'active',req.username));}catch(e){kept(req,next)(e);}});
app.post('/api/peer-link/:pairId/pause',...peerRoutes,(req,res,next)=>{try{res.json(agents.peerLink.setState(req.params.pairId,'paused',req.username));}catch(e){next(e);}});
app.post('/api/peer-link/:pairId/rename',...peerRoutes,(req,res,next)=>{try{res.json(agents.peerLink.rename(req.params.pairId,req.body?.name,req.username));}catch(e){next(e);}});
// A POST, since a DELETE carries no body here for the password.
app.post('/api/peer-link/:pairId/remove',...peerRoutes,again('peer-remove'),(req,res,next)=>{try{done(req,res,agents.peerLink.remove(req.params.pairId,req.username));}catch(e){kept(req,next)(e);}});
// An agent: on or off, which agents of paired machines, replies sent back at once.
app.post('/api/conversations/:id/peer-link',adminOnly,async(req,res,next)=>{try{
 const c=agents.get(req.params.id,req.userId);
 const next_=agents.peerConfig(c,req.body||{});
 if(agents.peerWidens(c,next_)){if(!(await auth.adminAgain(req,res,'peer-agent',c.id)))return;}
 try{agents.setPeerConfig(c,next_);}catch(e){auth.adminKept(req);throw e;}
 auth.adminGranted(req,c.id);
 require('./services/audit').audit({source:'peer-link',action:'agent',agentId:c.id,on:next_.on,allow:next_.allow.length,autoReply:next_.autoReply,by:req.username});
 res.json(agents.publicView(c,true));
}catch(e){next(e);}});
// The owner sends a reply draft on to the other machine, or drops it.
app.post('/api/conversations/:id/peer-draft/:messageId',adminOnly,(req,res,next)=>{try{
 const c=agents.get(req.params.id,req.userId);
 res.json(agents.peerDraft(c,req.params.messageId,req.body?.send===true));
}catch(e){next(e);}});
}
// Group chats are an admin's.
app.use('/api/groups',adminOnly);
app.use('/api/preferences',adminOnly);
app.get('/api/preferences',(req,res)=>res.json(agents.getPreferences(req.userId)));
// How one's own Agents list is ordered: everyone's own choice, not an admin setting.
app.use('/api/agent-list',verifyToken);
// The host's Claude subscription usage, for an admin (claudeUsage.js).
const claudeUsage=require('./claudeUsage').create({ratioFile:require('node:path').join(agents.stateRoot,'claude-usage-ratio.json'),loginFailed:()=>agents.loginFailed()});
app.get('/api/claude-usage',verifyToken,adminOnly,async(req,res,next)=>{try{
 res.set('Cache-Control','private, no-store');const answer=await claudeUsage({fresh:req.query.fresh==='1'});
 if(!answer.error&&!answer.stale)agents.loginProven(answer.checkedAt);
 res.json(answer);
}catch(e){next(e);}});
// Signing Claude in again from the chat (claudeLogin.js): the machine's login, so an
// admin's. The code goes to Claude Code and is kept nowhere here.
// A card on screen also asks whether the login works again by now.
// Not waited for: the sign-in's state should not lag behind the Keychain or Anthropic.
app.get('/api/claude-login',verifyToken,adminOnly,(req,res)=>{
 res.set('Cache-Control','private, no-store');
 const view=agents.loginView();
 if(agents.loginFailed()&&!['starting','waiting','checking'].includes(view.status))claudeUsage().then(answer=>{if(!answer.error&&!answer.stale)agents.loginProven(answer.checkedAt);}).catch(()=>{});
 res.json(view);
});
app.post('/api/claude-login/start',verifyToken,adminOnly,(req,res,next)=>{try{res.set('Cache-Control','private, no-store');res.json(agents.loginStart());}catch(e){next(e);}});
app.post('/api/claude-login/code',verifyToken,adminOnly,(req,res,next)=>{try{res.set('Cache-Control','private, no-store');res.json(agents.loginCode(req.body?.code));}catch(e){next(e);}});
app.post('/api/claude-login/cancel',verifyToken,adminOnly,(req,res,next)=>{try{res.set('Cache-Control','private, no-store');res.json(agents.loginCancel());}catch(e){next(e);}});
app.get('/api/agent-list',(req,res)=>res.json(agents.listPreferences(req.userId)));
// Schedules: everyone sees their own agents'
// schedules, an admin every agent's; only an admin adds, approves or changes one.
const scheduleRoutes=[verifyToken,(req,res,next)=>{res.set('Cache-Control','private, no-store');next();}];
app.get('/api/schedules',...scheduleRoutes,(req,res)=>res.json(agents.schedulesFor(req.userId,req.role)));
app.post('/api/schedules',...scheduleRoutes,adminOnly,(req,res,next)=>{try{res.status(201).json({schedule:agents.addSchedule(req.body||{})});}catch(e){next(e);}});
app.patch('/api/schedules/:id',...scheduleRoutes,adminOnly,(req,res,next)=>{try{res.json({schedule:agents.updateSchedule(req.params.id,req.body||{})});}catch(e){next(e);}});
app.post('/api/schedules/:id/approve',...scheduleRoutes,adminOnly,(req,res,next)=>{try{res.json({schedule:agents.approveSchedule(req.params.id,req.body||{})});}catch(e){next(e);}});
app.post('/api/schedules/:id/reject',...scheduleRoutes,adminOnly,(req,res,next)=>{try{agents.rejectSchedule(req.params.id);res.json({ok:true});}catch(e){next(e);}});
app.post('/api/schedules/:id/run',...scheduleRoutes,adminOnly,async(req,res,next)=>{try{res.json({schedule:agents.runScheduleNow(req.params.id,{ownerActive:await require('./scheduleOwners').activeOwners()})});}catch(e){next(e);}});
app.get('/api/schedule-checks',...scheduleRoutes,adminOnly,(req,res)=>res.json({checks:agents.scheduleCheckList()}));
app.post('/api/schedules/:id/test',...scheduleRoutes,adminOnly,async(req,res,next)=>{try{res.json({result:await agents.testSchedule(req.params.id)});}catch(e){next(e);}});
app.delete('/api/schedules/:id',...scheduleRoutes,adminOnly,(req,res,next)=>{try{agents.removeSchedule(req.params.id);res.json({ok:true});}catch(e){next(e);}});
app.patch('/api/agent-list',(req,res,next)=>{try{res.json(agents.setListPreferences(req.userId,req.body));}catch(e){next(e);}});
app.patch('/api/preferences',(req,res,next)=>{try{res.json(agents.setPreferences(req.userId,req.body));}catch(e){next(e);}});
// The admin page's subagent setting put into effect now on the agents it lists (still pending only).
app.post('/api/preferences/subagents-apply',(req,res,next)=>{try{res.json(agents.applySubagentDefault(req.body?.ids));}catch(e){next(e);}});
// The same for the admin page's auto-compact timing (issue #12): the admin's own agents only.
app.post('/api/preferences/auto-compact-apply',(req,res,next)=>{try{res.json(agents.applyAutoCompactDefault(req.body?.ids,req.userId));}catch(e){next(e);}});
// Out-of-scope attempts by every agent, for the admin's review: the list, one
// report, dismissing it, or widening that agent's scope from it. Admin only,
// every route.
const reviewer=[verifyToken,(req,res,next)=>req.role==='admin'?next():res.status(403).json({message:'Admin only'}),(req,res,next)=>{res.set('Cache-Control','private, no-store');next();}];
const ownerNames=()=>new Promise((ok,no)=>require('./stores').usersDB.find({},(e,users)=>e?no(e):ok(new Map((users||[]).map(u=>[u._id,u.name||u.username])))));
const named=async list=>{const names=await ownerNames();return list.map(r=>({...r,ownerName:names.get(r.owner)||''}));};
app.get('/api/access-reports',...reviewer,async(req,res,next)=>{try{res.json({reports:await named(agents.accessReports())});}catch(e){next(e);}});
app.get('/api/access-reports/:id',...reviewer,async(req,res,next)=>{try{res.json((await named([agents.accessReport(req.params.id)]))[0]);}catch(e){next(e);}});
app.post('/api/access-reports/:id/resolve',...reviewer,async(req,res,next)=>{try{
 const resolution=req.body?.resolution;if(!['dismissed','reopen'].includes(resolution))throw agents.error('Unknown resolution');
 agents.accessReport(req.params.id);
 const patch=resolution==='reopen'?{status:'open',resolution:null,resolvedAt:null,resolvedBy:null}:{status:'resolved',resolution:'dismissed',resolvedAt:new Date().toISOString(),resolvedBy:req.username};
 res.json((await named([agents.resolveAccessReport(req.params.id,patch)]))[0]);
}catch(e){next(e);}});
app.post('/api/access-reports/:id/grant',...reviewer,async(req,res,next)=>{try{
 const {folder,website}=req.body||{};
 if((typeof folder==='string')===(typeof website==='string'))throw agents.error('Grant exactly one folder or one website');
 const report=agents.accessReport(req.params.id);
 const {access,granted}=agents.grantAccess(report.conversationId,typeof folder==='string'?{folder}:{website},req.role);
 res.json((await named([agents.resolveAccessReport(req.params.id,{status:'resolved',resolution:'granted',granted,accessAfter:access,resolvedAt:new Date().toISOString(),resolvedBy:req.username})]))[0]);
}catch(e){next(e);}});
app.get('/api/conversations',(req,res)=>res.json({conversations:agents.list(req.userId)}));
// Deleted agents, which only an admin can delete:
// the list with when each is purged, restoring one to the Agents list, and
// keeping one past the retention setting.
app.use('/api/archived-agents',verifyToken,adminOnly);
const deletedAgents=async()=>({retentionDays:agents.archiveRetentionDays(),agents:await named(agents.archivedList())});
app.get('/api/archived-agents',async(req,res,next)=>{try{res.json(await deletedAgents());}catch(e){next(e);}});
app.post('/api/archived-agents/:id/restore',(req,res,next)=>{try{const c=agents.restoreArchived(req.params.id);res.json(agents.publicView(c));}catch(e){next(e);}});
app.post('/api/archived-agents/:id/purge',async(req,res,next)=>{try{agents.purgeArchived(req.params.id);res.json(await deletedAgents());}catch(e){next(e);}});
app.post('/api/archived-agents/:id/keep',async(req,res,next)=>{try{agents.keepArchived(req.params.id,req.body?.keep);res.json(await deletedAgents());}catch(e){next(e);}});
// Agents are an admin's to create and delete: an account's agents listed,
// archived and scoped from Manage Users.
const adminOnlyChain=[verifyToken,(req,res,next)=>req.role==='admin'?next():res.status(403).json({message:'Admin only'})];
// The MCP servers an admin can pick for a scoped agent, from this computer's Claude
// setup: the local ones, and the claude.ai
// connectors the account has used. Names only.
app.get('/api/agent-mcp-options',...adminOnlyChain,(req,res)=>{
 let conf={};try{conf=JSON.parse(require('node:fs').readFileSync(require('node:path').join(require('node:os').homedir(),'.claude.json'),'utf8'));}catch{}
 const ok=n=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(n)&&n!=='executive';
 const local=Object.keys(conf.mcpServers||{}).filter(ok).map(name=>({name,label:name,kind:'local'}));
 const cloud=(Array.isArray(conf.claudeAiMcpEverConnected)?conf.claudeAiMcpEverConnected:[]).filter(x=>typeof x==='string'&&x.startsWith('claude.ai ')).map(x=>x.slice(10)).map(label=>({name:'claude_ai_'+label.replace(/[^A-Za-z0-9_-]/g,'_'),label,kind:'claude.ai'})).filter(x=>ok(x.name));
 res.json({options:[...cloud,...local]});
});
// :uid names a real account, or nothing happens: it becomes a directory name.
const account=(needActive)=>(req,res,next)=>{
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(req.params.uid))return res.status(404).json({message:'User not found'});
 require('./stores').usersDB.findOne({_id:req.params.uid},(e,u)=>{
  if(e)return next(e);
  const status=u?.lifecycleStatus||'active';
  if(!u||status==='deleted_tombstone')return res.status(404).json({message:'User not found'});
  if(needActive&&status!=='active')return res.status(409).json({message:'這個帳號不是啟用狀態'});
  req.account=u;
  next();
 });
};
app.get('/api/agent-admin/users/:uid/agents',...adminOnlyChain,account(false),(req,res)=>res.json({conversations:agents.list(req.params.uid)}));
app.post('/api/agent-admin/users/:uid/agents/:cid/archive',...adminOnlyChain,account(false),(req,res,next)=>{try{agents.archiveFor(req.params.uid,req.params.cid);res.json({conversations:agents.list(req.params.uid)});}catch(e){next(e);}});
// Setting any agent's scope outright: how a grant is narrowed or taken back.
app.put('/api/agent-admin/users/:uid/agents/:cid/access',...adminOnlyChain,account(false),(req,res,next)=>{try{agents.setAccessFor(req.params.uid,req.params.cid,req.body?.access,req.role);res.json({conversations:agents.list(req.params.uid)});}catch(e){next(e);}});
app.post('/api/conversations',(req,res,next)=>{try{if(req.role!=='admin')throw agents.error('Agent 由管理員建立。',403);if(req.body.threshold!==undefined&&req.role!=='admin')throw agents.error('Admin only',403);if(req.body.resumeSessionId&&req.role!=='admin')throw agents.error('只有管理者可匯入本機 Claude session。',403);const c=agents.create(req.userId,req.body,req.role);
 // start:false makes the agent without running it: a session carried over can be created while it is still open
 // elsewhere and started later, from the profile.
 if(req.body.start!==false)agents.launch(c);
 res.status(201).json(agents.publicView(c,true));}catch(e){next(e);}});
// Group chats: the owner's own agents in one room.
app.get('/api/groups',(req,res,next)=>{try{res.json({groups:agents.groupList(req.userId)});}catch(e){next(e);}});
app.post('/api/groups/reorder',(req,res,next)=>{try{res.json({groups:agents.reorderGroups(req.userId,req.body?.ids)});}catch(e){next(e);}});
app.post('/api/groups',(req,res,next)=>{try{res.status(201).json(agents.createGroup(req.userId,req.body||{}));}catch(e){next(e);}});
app.get('/api/groups/:id',(req,res,next)=>{try{const x=agents.groupFor(req.params.id,req.userId);if(req.query.viewing==='1')agents.markViewing(req.userId,x.id);const limit=Number.parseInt(req.query.limit,10);res.json(agents.groupView(x,true,{limit:Number.isInteger(limit)?limit:undefined}));}catch(e){next(e);}});
app.patch('/api/groups/:id',(req,res,next)=>{try{res.json(agents.updateGroup(req.userId,req.params.id,req.body||{}));}catch(e){next(e);}});
app.delete('/api/groups/:id',(req,res,next)=>{try{agents.removeGroup(req.userId,req.params.id);res.json({ok:true});}catch(e){next(e);}});
app.post('/api/groups/:id/messages',(req,res,next)=>{try{agents.sendToGroup(req.userId,req.params.id,req.body?.text,req.body?.requestId,req.body?.mentions);res.json(agents.groupView(agents.groupFor(req.params.id,req.userId),true));}catch(e){next(e);}});
app.post('/api/groups/:id/checklist',(req,res,next)=>{try{res.json(agents.updateGroupChecklist(req.userId,req.params.id,req.body||{}));}catch(e){next(e);}});
// A member's terminal command, from the group: the terminal is an admin's.
app.post('/api/groups/:id/command',(req,res,next)=>{try{if(req.role!=='admin')throw agents.error('Admin only',403);res.json(agents.commandInGroup(req.userId,req.params.id,req.body?.agentId,req.body?.command));}catch(e){next(e);}});
app.post('/api/groups/:id/search',(req,res,next)=>{try{res.json(agents.searchGroup(req.userId,req.params.id,req.body?.q));}catch(e){next(e);}});
// Searching one's own conversations, or one of them. A POST, so what was searched
// for stays out of the audit log, which records each request's address.
app.post('/api/conversations/search',(req,res,next)=>{try{
 const conversationId=typeof req.body?.conversationId==='string'&&req.body.conversationId?req.body.conversationId:undefined;
 res.json(agents.searchMessages(req.userId,req.body?.q,{conversationId}));
}catch(e){next(e);}});
app.post('/api/conversations/reorder',(req,res,next)=>{try{res.json({conversations:agents.reorder(req.userId,req.body.ids,req.body.groups)});}catch(e){next(e);}});
// ?limit= and ?before= page the bubbles: the newest ones on open, older ones when
// the reader scrolls back.
app.get('/api/conversations/:id',(req,res,next)=>{try{
 const limit=req.query.limit===undefined?undefined:Number(req.query.limit);
 if(limit!==undefined&&!Number.isInteger(limit))throw agents.error('limit 必須是整數',400);
 const before=typeof req.query.before==='string'&&req.query.before?req.query.before:undefined;
 const c=agents.get(req.params.id,req.userId);
 if(req.query.viewing==='1')agents.markViewing(req.userId,c.id);
 res.json(agents.publicView(c,true,{limit,before}));
}catch(e){next(e);}});
// The raw model input and output behind one bubble. Two gates, both server-side:
// the role comes from the verified live principal, and get() still requires the
// caller to own the conversation.
app.get('/api/conversations/:id/commands',(req,res,next)=>{try{res.json(agents.commandsFor(agents.get(req.params.id,req.userId),req.role));}catch(e){next(e);}});
app.get('/api/conversations/:id/messages/:messageId/transcript',(req,res,next)=>{try{
 if(req.role!=='admin')throw agents.error('Admin only',403);
 res.set('Cache-Control','private, no-store');
 res.json(agents.messageTranscript(agents.get(req.params.id,req.userId),req.params.messageId));
}catch(e){next(e);}});
// The subagents an agent started, for the Transcript column (admin, its owner).
app.get('/api/conversations/:id/subagents',(req,res,next)=>{try{
 if(req.role!=='admin')throw agents.error('Admin only',403);
 res.set('Cache-Control','private, no-store');
 res.json(agents.subagentList(agents.get(req.params.id,req.userId)));
}catch(e){next(e);}});
const own=(req,res,next)=>{try{req.conversation=agents.get(req.params.id,req.userId);next();}catch(e){next(e);}};
app.post('/api/conversations/:id/attachments',own,express.raw({type:()=>true,limit:attachments.MAX_BYTES}),(req,res,next)=>{try{res.status(201).json(attachments.put(agents.stateRoot,req.conversation,req.query.name,req.body));}catch(e){next(e);}});
app.get('/api/conversations/:id/attachments/:fileId',own,(req,res,next)=>{try{const file=attachments.location(agents.stateRoot,req.conversation,req.params.fileId);res.set('Cache-Control','private, no-store');res.set('Content-Type','application/octet-stream');res.download(file.path,file.meta.name);}catch(e){next(e);}});
// An .html attachment shown as the page it is, inside the preview's frame (one self-contained file). The page is
// someone's or an agent's own HTML, so it is served as a document with no origin: the
// sandbox header (no allow-same-origin) takes away this site's cookies, storage and
// API whether it is framed or opened by its address, its scripts may run but nothing
// is fetched, posted or loaded from anywhere (inline code and data: images only), and
// only this site may frame it. It is given to a frame and to nothing else: opened by
// its address in a tab it would have no page around it whose policy keeps it from
// walking off to another site with what it holds, and would show someone's HTML
// full-page under this site's name. What stays open,
// told to the owner: Chrome does not act on webrtc 'block' (a
// sandboxed page still gathers candidates through a STUN server), and a link's
// dns-prefetch makes the browser look up a host name; through either a page's script
// can send out what the page itself holds or what is typed into it, nothing of this site.
const PAGE_CSP=["sandbox allow-scripts","default-src 'none'","script-src 'unsafe-inline'","style-src 'unsafe-inline'","img-src data: blob:","media-src data: blob:","font-src data:","form-action 'none'","base-uri 'none'","webrtc 'block'","frame-ancestors 'self'"].join('; ');
const PAGE_MAX=8*1024*1024,pageFs=require('node:fs');
app.get('/api/conversations/:id/attachments/:fileId/page',own,(req,res,next)=>{try{
 if(req.get('sec-fetch-dest')!=='iframe')return res.status(403).json({message:'This page is shown inside the preview only'});
 const file=attachments.location(agents.stateRoot,req.conversation,req.params.fileId);
 if(!/\.html?$/i.test(file.meta.name))return res.status(415).json({message:'Not an HTML file'});
 if(pageFs.statSync(file.path).size>PAGE_MAX)return res.status(413).json({message:'Too large to show as a page'});
 // The page's own headers only once the file is open, so an error keeps the site's.
 const stream=pageFs.createReadStream(file.path);
 stream.on('error',e=>res.headersSent?res.destroy(e):next(e));
 stream.on('open',()=>{res.set('Cache-Control','private, no-store, no-transform');res.set('Content-Security-Policy',PAGE_CSP);res.set('X-Frame-Options','SAMEORIGIN');res.set('Content-Type','text/html; charset=utf-8');stream.pipe(res);});
}catch(e){next(e);}});
app.delete('/api/conversations/:id/attachments/:fileId',own,(req,res,next)=>{try{attachments.remove(agents.stateRoot,req.conversation,req.params.fileId);res.json({ok:true});}catch(e){next(e);}});
// An agent's picture: whoever can open the agent sees it, only an admin changes it. The address carries a version, so it is kept.
app.get('/api/conversations/:id/avatar',own,(req,res,next)=>{try{const file=agents.avatarLocation(req.conversation);res.set('Cache-Control','private, max-age=31536000, immutable');res.set('X-Content-Type-Options','nosniff');res.type(file.type);res.sendFile(file.path);}catch(e){next(e);}});
app.post('/api/conversations/:id/avatar',adminOnly,own,express.raw({type:()=>true,limit:agents.AVATAR_MAX_BYTES}),(req,res,next)=>{try{agents.setAvatar(req.conversation,req.body);res.json(agents.publicView(req.conversation,true));}catch(e){next(e);}});
app.delete('/api/conversations/:id/avatar',adminOnly,own,(req,res,next)=>{try{agents.clearAvatar(req.conversation);res.json(agents.publicView(req.conversation,true));}catch(e){next(e);}});
app.post('/api/conversations/:id/messages',(req,res,next)=>{try{const c=agents.get(req.params.id,req.userId);const mentions=agents.mentionsFor(req.userId,req.body.mentions,req.body.text,c);const sent=agents.send(c,req.body.text,req.body.requestId,req.body.attachmentIds,mentions.length?{mentions}:{});
 res.json(sent);}catch(e){next(e);}});
app.post('/api/conversations/:id/:action',(req,res,next)=>{try{
 const c=agents.get(req.params.id,req.userId);
 // A member's Agent Profile is read-only: the admin who set the agent up owns its
 // name, instructions, memory and scope.
 if(['profile','rename','memory'].includes(req.params.action)&&req.role!=='admin')throw agents.error('Agent 設定由管理員調整。',403);
 let extra={};
 switch(req.params.action){
 // A change of model, effort or scope relaunches a live Claude: waiting on its
 // workspace or channel prompt too, or it would keep the old scope and mcp.json, as a scope set from the admin pages does.
 // Not running is not stopped: a run in the error phase may still have Claude alive under
 // the old scope, so it is stopped too and started again only if it was live.
 case 'profile':{const changed=agents.updateProfile(c,req.body,req.role),phase=agents.active(c).phase;if(changed&&c.mode==='claude'&&phase!=='stopped'){agents.stop(c);if(['ready','awaiting-workspace','awaiting-confirmation'].includes(phase))agents.launch(c);}break;}
 case 'permission':agents.decidePermission(c,req.body);break;
 case 'confirm-workspace':agents.confirmWorkspace(c);break;
 case 'confirm-channel':agents.confirmChannel(c);break;
 case 'compact':agents.compact(c);break;
 case 'wrap-up':{if(req.role!=='admin')throw agents.error('Admin only',403);agents.setWrapUp(c,req.body.wrapUp);break;}
 case 'threshold':{if(req.role!=='admin')throw agents.error('Admin only',403);agents.setThreshold(c,req.body.threshold===null?null:req.body.threshold);break;}
 // An agent's own subagent model and effort, or null to follow the admin page: an admin's, like the threshold.
 case 'subagents':{if(req.role!=='admin')throw agents.error('Admin only',403);extra.subagentNeeds=agents.setSubagents(c,req.body?.subagents===null?null:req.body?.subagents);break;}
 case 'subagents-apply':{if(req.role!=='admin')throw agents.error('Admin only',403);extra.subagentApply=agents.applyAgentSubagents(c);break;}
 // When its Claude Code compacts: 'follow', null (Claude Code's default) or a preset; an admin's, like subagents.
 case 'auto-compact':{if(req.role!=='admin')throw agents.error('Admin only',403);extra.autoCompactNeeds=agents.setAutoCompact(c,req.body?.autoCompact);break;}
 case 'auto-compact-apply':{if(req.role!=='admin')throw agents.error('Admin only',403);extra.autoCompactApply=agents.applyAgentAutoCompact(c);break;}
 case 'rename':if(typeof req.body.title!=='string'||!req.body.title.trim()||req.body.title.trim().length>80)throw agents.error('主題需為 1–80 字');c.title=req.body.title.trim();c.profileVersion=(c.profileVersion||0)+1;c.updatedAt=new Date().toISOString();agents.save();break;
 case 'archive':if(req.role!=='admin')throw agents.error('Agent 由管理員刪除。',403);agents.stop(c);c.archived=true;c.archivedAt=new Date().toISOString();agents.save(c);break;
 case 'interrupt':agents.interrupt(c);break;
 // The owner's own changes to the agent's checklists; the agent sees who made them.
 case 'checklist':agents.updateChecklist(c,req.body,'owner');break;
 // A choice in a menu waiting in the agent's terminal: the terminal is an admin's.
 case 'terminal-choice':if(req.role!=='admin')throw agents.error('Admin only',403);agents.chooseTerminalOption(c,req.body);break;
 // The terminal is an admin's, and so are the commands typed into it.
 case 'command':if(req.role!=='admin')throw agents.error('Admin only',403);extra={command:agents.runCommand(c,req.body.command)};break;
 case 'login-resend':agents.loginResend(c,req.body?.card);break;
 // The counts travel with the answer: the page holds only a window of bubbles, so
 // it cannot tell what changed by counting them.
 case 'import-history':{const imported=agents.importHistory(c);res.set('X-Imported',String(imported.added));extra={imported};break;}
 case 'start':agents.reconnect(c);break;
 // Paused by hand: schedules wait for it rather than starting it again.
 case 'stop':agents.stop(c);c.pausedByOwner=true;agents.save(c);break;
 case 'rotate':agents.rotate(c,req.body?.recent);break;
 case 'memory':if(typeof req.body.text!=='string'||req.body.text.length>20000)throw agents.error('記憶最多 20000 字');c.memory=req.body.text;c.profileVersion=(c.profileVersion||0)+1;agents.save();break;
 case 'simulate-compact':if(c.mode!=='demo')throw agents.error('只有模擬模式可測試 compact',403);agents.bridge(c,'postcompact',{eventKey:require('node:crypto').randomUUID()});if(c.pendingRotation)agents.rotate(c);break;
 default:throw agents.error('Unknown action',404);
 }res.json({...agents.publicView(c,true),...extra});
}catch(e){next(e);}});

};