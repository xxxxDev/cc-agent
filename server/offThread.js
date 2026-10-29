// Starting a process holds the thread that starts it, even through execFile: on
// Windows tens to hundreds of milliseconds each, so the screens read every few
// seconds held every page with them. They are started from a worker thread instead.
const {Worker}=require('node:worker_threads');
const WORKER=`const {parentPort}=require('node:worker_threads');const {execFile}=require('node:child_process');
parentPort.on('message',({id,file,args,timeout})=>execFile(file,args,{encoding:'utf8',timeout,windowsHide:true},(failed,out)=>parentPort.postMessage({id,out:failed?null:out})));`;
let worker=null,next=0;
const waiting=new Map();
function started(){
 if(worker)return worker;
 worker=new Worker(WORKER,{eval:true});
 // Held only while a read is unanswered, like the child process it stands for.
 worker.on('message',({id,out})=>{waiting.get(id)?.(out);waiting.delete(id);if(!waiting.size)worker.unref();});
 // A worker that died takes its unanswered reads with it; the next read starts another.
 worker.on('exit',()=>{worker=null;for(const done of waiting.values())done(null);waiting.clear();});
 worker.on('error',e=>console.error('off-thread worker failed:',e.message));
 return worker;
}
// The command's output, or null when it failed or ran past timeout.
function run(file,args,{timeout=1000}={}){
 return new Promise(resolve=>{const id=++next;waiting.set(id,resolve);const w=started();w.ref();w.postMessage({id,file,args,timeout});});
}
module.exports={run};
