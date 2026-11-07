import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
createRequire(import.meta.url)('../server/services/outputStreams.js').keepOutputErrorsQuiet();
// server/.env first, so its data folder, port and public address apply to everything
// below (a value already in the environment wins).
const devGiven=process.env.CC_AGENT_DEV;
createRequire(import.meta.url)('dotenv').config({path:path.join(root,'server','.env'),quiet:true});
// Development trust (siteConfig.devMode) is given on the command line only: a line in
// server/.env would quietly make the dev and test ports trusted origins for the live
// service. Empty, so server/app.js's own .env read does not bring it back either.
if(devGiven===undefined&&process.env.CC_AGENT_DEV!==undefined){process.env.CC_AGENT_DEV='';console.warn('CC_AGENT_DEV in server/.env is ignored: set it on the command line while developing.');}
if(process.env.CC_AGENT_DEV==='1')console.warn('Developing (CC_AGENT_DEV=1): the vite dev server and the test instance ports are trusted origins.');
const data=path.resolve(process.env.CC_AGENT_DATA_DIR||path.join(root,'.local'));fs.mkdirSync(data,{recursive:true,mode:0o700});
// With a data folder set (CC_AGENT_DATA_DIR), the audit log goes in it too, under logs/;
// with the default .local, it stays in server/logs.
if(data!==path.join(root,'.local')&&!process.env.CC_AGENT_AUDIT_LOG)process.env.CC_AGENT_AUDIT_LOG=path.join(data,'logs','api-audit.log');
const lock=path.join(data,'server.lock');
// Accounts without the secret that signs their logins: a new secret and a new seed
// password would be made beside them, so the start is refused before anything is
// written.
if(fs.existsSync(path.join(data,'auth','users.db'))&&!fs.existsSync(path.join(data,'local-access.json')))throw new Error('Auth exists without its secret; refusing bootstrap.');
try {fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}catch{
 const pid=Number(fs.readFileSync(lock,'utf8'));let live=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')live=false;}
 if(live)throw new Error('Another CC Agent server is already running on this data folder.');fs.unlinkSync(lock);fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});
}
// Removed at exit only while it is still the file this process made: not a link, the same
// file, and still naming this process. One replaced meanwhile, by another start that
// found this one gone, say, stays.
const ownedRuntimeLock=fs.lstatSync(lock);
process.on('exit',()=>{try{const current=fs.lstatSync(lock);if(!current.isSymbolicLink()&&current.ino===ownedRuntimeLock.ino&&current.dev===ownedRuntimeLock.dev&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}catch{}});
const credentials=path.join(data,'local-access.json');
if(!fs.existsSync(credentials))fs.writeFileSync(credentials,JSON.stringify({jwt:randomBytes(32).toString('hex'),password:randomBytes(12).toString('base64url')},null,2),{mode:0o600});
const secrets=JSON.parse(fs.readFileSync(credentials));
process.env.JWT_SECRET=secrets.jwt;process.env.DB_DIR=path.join(data,'auth');const aliasFile=path.join(data,'workspace-alias.json');
const alias=process.env.CC_AGENT_WORKSPACE_ALIAS||(fs.existsSync(aliasFile)?JSON.parse(fs.readFileSync(aliasFile)).path:fs.realpathSync(data));
if(fs.realpathSync(alias)!==fs.realpathSync(data))throw new Error('Workspace alias must refer to this data directory');
process.env.AGENT_DATA_DIR=alias;process.env.NODE_ENV='development';
const require=createRequire(import.meta.url);
const site=require('../server/siteConfig.js');
const pushKeys=path.join(data,'push-keys.json');
if(!fs.existsSync(pushKeys)){
 const vapid=require('web-push').generateVAPIDKeys();
 fs.writeFileSync(pushKeys,JSON.stringify({VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,VAPID_SUBJECT:site.publicOrigin(),PUSH_SUBSCRIPTION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PUSH_SUBSCRIPTION_HMAC_KEY:randomBytes(32).toString('hex')}),{mode:0o600,flag:'wx'});
}
const savedPushKeys=JSON.parse(fs.readFileSync(pushKeys,'utf8'));
if(savedPushKeys.VAPID_SUBJECT==='https://localhost'){savedPushKeys.VAPID_SUBJECT=site.publicOrigin();fs.writeFileSync(pushKeys,JSON.stringify(savedPushKeys),{mode:0o600});}
Object.assign(process.env,savedPushKeys);
const {usersDB,sessionsDB,pushSubscriptionsDB}=require('../server/stores.js');const bcrypt=require('bcryptjs');
// Logins still holding a raw token are converted before serving (server/serviceStart.js).
const service=require('../server/serviceStart.js');
await service.migrateSessions({sessionsDB,subscriptionsDB:pushSubscriptionsDB});
// Only the first admin is seeded; members are created by an admin, each with a
// password of their own.
for(const [username,name,role] of [['admin','Admin','admin']]){
 const found=await new Promise((ok,no)=>usersDB.findOne({username},(e,x)=>e?no(e):ok(x)));
 // Only when there is no administrator at all: an admin that was renamed or removed is
 // not made again under the old name with the seed password and no two-step.
 const anyAdmin=await new Promise((ok,no)=>usersDB.findOne({role:'admin',lifecycleStatus:{$ne:'deleted_tombstone'}},(e,x)=>e?no(e):ok(x)));
 if(!found&&!anyAdmin)await new Promise((ok,no)=>usersDB.insert({username,name,normalizedUsername:username,password:bcrypt.hashSync(secrets.password,10),role,language:'en',lifecycleStatus:'active',lifecycleSchemaVersion:1},(e,x)=>e?no(e):ok(x)));
}
const {app}=require('../server/app.js');
// The generic web service start (server/serviceStart.js: listening on
// this machine, audit-log rotation, the live socket, shutdown); what CC Agent runs
// beside it is below.
service.startService({app,port:site.servicePort(),
 onListening:()=>{console.log('CC Agent: http://127.0.0.1:'+site.servicePort());console.log('First sign-in: username admin, password in '+credentials);},
 product(server){
  const agents=require('../server/agentStore.js');
  const stopNotifications=require('../server/notifications.js').startNotifications(agents);
  // Storage that nobody asked to keep: conversations archived past the grace period,
  // attachments staged but never sent, and finished checklists past their setting. Swept
  // at startup and every six hours, unref'd so it never holds the process open.
  const sweep=()=>{try{const r=agents.sweepRetention();if(r.conversations||r.attachments||r.workspaces||r.checklists)console.log(`retention: removed ${r.conversations} archived conversation(s), ${r.attachments} unsent attachment file(s), ${r.workspaces} orphaned workspace(s), ${r.checklists||0} finished checklist(s)`);}catch(e){console.error('retention sweep failed:',e.message);}};
  sweep();
  setInterval(sweep,6*60*60*1000).unref();
  // Schedules the owner approved fall due here (server/schedules.js); half a minute
  // is close enough for a schedule written to the minute.
  // An agent whose owner can no longer sign in is not started on a timer.
  const {activeOwners}=require('../server/scheduleOwners.js');
  const runSchedules=async()=>{let ownerActive;try{ownerActive=await activeOwners();agents.runSchedules({ownerActive});}catch(e){console.error('schedules failed:',e.message);}try{if(ownerActive)agents.runLimitResumes({ownerActive});}catch(e){console.error('limit resume failed:',e.message);}try{if(ownerActive)agents.runWrapUps({ownerActive});}catch(e){console.error('wrap-up failed:',e.message);}};
  // Messages between agents' sessions reach both chats within a few seconds.
  setInterval(()=>agents.syncAllRelays(),4000).unref();
  setInterval(runSchedules,30_000).unref();setTimeout(runSchedules,5_000).unref();
  // The peer link's exchange with a paired machine, on the side that connects (server/peerLink.js).
  try{agents.peerLink.start();}catch(e){console.error('peer link:',e.message);}
  const terminals=require('../server/terminal.js').installTerminal(server);
  return {
   stop(){stopNotifications();try{agents.peerLink.stop();}catch{}try{agents.loginShutdown();}catch{}terminals.close();return 0;},
   finish(){try{agents.loginShutdown('SIGKILL');}catch{}},
  };
 }});
