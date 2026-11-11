#!/usr/bin/env node
// The answering side of the peer link (docs/PEER-LINK.md): run only by the forced
// command of the other machine's dedicated SSH key, as
//   command="<node> <this project>/scripts/peer-exchange.mjs",restrict ssh-ed25519 …
// It reads one exchange (JSON, at most 256 KB) from stdin and hands it to this machine's
// CC Agent on 127.0.0.1 with the peer key only this account can read; the answer goes
// to stdout. It takes no arguments and ignores SSH_ORIGINAL_COMMAND, so the key runs
// nothing else. A failure prints one fixed line, never a path or the key.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const MAX=256*1024;
const fail=(code=1)=>{process.stdout.write('{"error":"exchange failed"}\n');process.exit(code);};
const require=createRequire(import.meta.url);
// The same settings the service starts with (scripts/start.mjs): SSH runs this with a
// bare environment, so a port or key file set in server/.env would otherwise be missed
// and the exchange sent to the default port. A value already in the environment wins.
try{require('dotenv').config({path:path.join(path.dirname(fileURLToPath(import.meta.url)),'..','server','.env'),quiet:true});}catch{fail();}
const keyFile=process.env.CC_AGENT_PEER_KEY_FILE||path.join(os.homedir(),'.config','cc-agent','peer-key');

function readKey(){
 const st=fs.lstatSync(keyFile);
 // A plain file of this account that nobody else can read, as the service writes it.
 if(!st.isFile()||st.uid!==process.getuid()||(st.mode&0o077))throw new Error('key');
 const k=fs.readFileSync(keyFile,'utf8').trim();
 if(!/^ccp_[A-Za-z0-9_-]{40,}$/.test(k))throw new Error('key');
 return k;
}
function readStdin(){
 return new Promise((ok,no)=>{
  const parts=[];let size=0;
  process.stdin.on('data',d=>{size+=d.length;if(size>MAX){no(new Error('too large'));process.stdin.destroy();return;}parts.push(d);});
  process.stdin.on('end',()=>ok(Buffer.concat(parts)));
  process.stdin.on('error',no);
 });
}
async function main(){
 let key,body,port;
 try{key=readKey();port=require('../server/siteConfig.js').servicePort();}catch{return fail();}
 try{body=await readStdin();JSON.parse(body.toString('utf8'));}catch{return fail();}
 try{
  const r=await fetch(`http://127.0.0.1:${port}/bridge/peer/exchange`,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json',host:`127.0.0.1:${port}`},body,signal:AbortSignal.timeout(25_000)});
  const text=await r.text();
  if(!r.ok||text.length>MAX)return fail();
  JSON.parse(text);
  process.stdout.write(text+'\n');
 }catch{return fail();}
}
main();
