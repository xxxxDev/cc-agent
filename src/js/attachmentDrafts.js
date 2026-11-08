import {ref,computed,nextTick,watch} from 'vue';
import {f7} from 'framework7-vue';
import {api,apiUpload} from './api.js';
export function useAttachmentDrafts(selected,user,busy,ct){
 const drafts=ref({}),fileInput=ref(null);
 const files=computed(()=>drafts.value[selected.value]||[]);
 const pendingSend=new Map();
 const resize=()=>nextTick(()=>document.querySelector('.chat-page .messagebar')?.f7Messagebar?.resizePage());
 function addFiles(list){if(!selected.value||busy.value)return;const next=[...files.value];for(const file of Array.from(list||[])){if(next.length>=10){f7.dialog.alert(ct('最多 10 個附件'));break;}if(!file.size||file.size>95*1024*1024){f7.dialog.alert(ct('附件大小須為 1 byte 至 95 MB')+': '+file.name);continue;}next.push({key:crypto.randomUUID(),file,name:file.name,size:file.size,uploadedId:null});}drafts.value[selected.value]=next;pendingSend.delete(selected.value);resize();}
 function pickFiles(e){addFiles(e.target.files);e.target.value='';}
 function dropFiles(e){if(e.dataTransfer?.files?.length)addFiles(e.dataTransfer.files);}
 // A picture or file copied on the computer is pasted in as an attachment. Text copied from an office document also carries a picture of
 // itself; there the text is what was meant, so the paste is left alone.
 function pasteFiles(e){const data=e.clipboardData,list=Array.from(data?.files||[]);if(!list.length)return;const types=Array.from(data.types||[]);if(types.includes('text/plain')&&(types.includes('text/html')||types.includes('text/rtf')))return;e.preventDefault();const d=new Date(),two=n=>String(n).padStart(2,'0'),stamp=''+d.getFullYear()+two(d.getMonth()+1)+two(d.getDate())+'-'+two(d.getHours())+two(d.getMinutes())+two(d.getSeconds());
  // A copied picture arrives as "image.png" every time; name it by when it was pasted.
  addFiles(list.map((file,i)=>/^image\.\w+$/i.test(file.name)?new File([file],'pasted-'+stamp+(i?'-'+(i+1):'')+file.name.slice(file.name.lastIndexOf('.')),{type:file.type}):file));}
 function removeFile(key){if(busy.value)return;const id=selected.value,item=files.value.find(x=>x.key===key);drafts.value[id]=files.value.filter(x=>x.key!==key);pendingSend.delete(id);if(item?.uploadedId)api('/conversations/'+id+'/attachments/'+item.uploadedId,{method:'DELETE'}).catch(()=>{});resize();}
 // A file not sent yet opens with the others beside it, to step through as in a sent bubble.
 function previewDraft(item){const shown=f=>({id:f.key,name:f.name,size:f.size,local:f.file});return {...shown(item),group:files.value.map(shown)};}
 // The editor lets go before iOS's own file picker opens: iOS hides the keyboard for the picker
 // but kept the editor focused, so the next tap on it was a native focus and iOS scrolled the
 // whole page up. Blurring inside the same tap keeps the
 // gesture, so the picker still opens; the next tap on the editor is a fresh, guarded focus.
 // While iOS's picker menu is up, the tap that dismisses it only dismisses it: landing on the
 // editor it would focus it, iOS would raise the keyboard and then drop it again as the picker
 // closes. The next tap opens the keyboard.
 function swallowWhilePicking(){
  const input=fileInput.value,opened=Date.now();let done=false;
  const editorTouch=e=>{if(e.target?.closest?.('[contenteditable],textarea'))e.preventDefault();};
  // iOS still focused the editor on that tap, so the
  // editors are not editable while the picker is up, and come back when it answers.
  const locked=[...(document.querySelectorAll?.('.chat-editor[contenteditable]')||[])].filter(el=>el.getAttribute('contenteditable')!=='false').map(el=>[el,el.getAttribute('contenteditable')]);
  for(const [el] of locked)el.setAttribute('contenteditable','false');
  const unlock=()=>{for(const [el,was] of locked)if(el.getAttribute('contenteditable')==='false')el.setAttribute('contenteditable',was);};
  const finish=e=>{if(done||e?.type==='focus'&&Date.now()-opened<400)return;done=true;clearTimeout(giveUp);input?.removeEventListener('change',finish);input?.removeEventListener('cancel',finish);globalThis.window?.removeEventListener?.('focus',finish);
   // Released at once: the dismissing tap ends well before the picker answers (about 750 ms on an
   // iPhone), and a short grace swallowed the next real tap.
   document.removeEventListener?.('touchend',editorTouch,true);unlock();};
  document.addEventListener?.('touchend',editorTouch,{capture:true,passive:false});
  input?.addEventListener?.('change',finish);input?.addEventListener?.('cancel',finish);globalThis.window?.addEventListener?.('focus',finish);
  const giveUp=setTimeout(()=>finish(),60000);giveUp?.unref?.();
 }
 function chooseFiles(){if(busy.value)return;const a=document.activeElement;if(a&&a!==document.body&&(a.isContentEditable||/^(TEXTAREA|INPUT)$/.test(a.tagName)))a.blur();swallowWhilePicking();fileInput.value?.click();}
 // A message on its way shows how far it got (with files to upload,
 // only a greyed send button said anything was happening). progress holds, per
 // conversation, the send under way: the files going up (the one at, how far) or the
 // message itself; each file's chip shows its own state (waiting, uploading with its
 // percent, done, failed). begin() and end() bracket a send, upload() moves it along.
 const progress=ref({});
 const status=computed(()=>{const p=progress.value[selected.value];if(!p)return '';if(p.phase!=='upload')return ct('傳送中…');if(p.percent>=99)return ct('上傳附件 {n}/{total}（伺服器處理中）…').replace('{n}',p.at).replace('{total}',p.total);return ct('上傳附件 {n}/{total}（{percent}%）…').replace('{n}',p.at).replace('{total}',p.total).replace('{percent}',p.percent);});
 function begin(id){progress.value[id]={phase:'send'};}
 // A failed file keeps its mark until the next send or its removal; the ones it held up go back to plain.
 function end(id){delete progress.value[id];for(const item of drafts.value[id]||[])if(item.state==='waiting'||item.state==='uploading'){item.state=null;item.percent=0;}}
 async function upload(id,items){
  const queue=items.filter(x=>!x.uploadedId);
  for(const item of items){item.state=item.uploadedId?'done':'waiting';item.percent=item.uploadedId?100:0;}
  for(const [i,item] of queue.entries()){
   progress.value[id]={phase:'upload',at:i+1,total:queue.length,percent:0};item.state='uploading';
   try{
    const r=await apiUpload('/conversations/'+id+'/attachments?name='+encodeURIComponent(item.name),item.file,{headers:{'Content-Type':'application/octet-stream'},onProgress:f=>{const pct=Math.min(99,Math.floor(f*100));item.percent=pct;const p=progress.value[id];if(p?.phase==='upload'&&p.at===i+1)p.percent=pct;}});
    item.uploadedId=r.id;item.state='done';item.percent=100;
   }catch(e){item.state='failed';throw e;}
  }
  if(progress.value[id])progress.value[id]={phase:'send'};
  return items.map(x=>x.uploadedId);
 }
 function requestId(id,text,items){const signature=JSON.stringify([text,items.map(x=>x.key)]);const previous=pendingSend.get(id);if(previous?.signature===signature)return previous.id;const value={signature,id:crypto.randomUUID()};pendingSend.set(id,value);return value.id;}
 function sent(id,items){const keys=new Set(items.map(x=>x.key));drafts.value[id]=(drafts.value[id]||[]).filter(x=>!keys.has(x.key));pendingSend.delete(id);resize();}
 watch(files,resize);
 watch(()=>user.value?.id,()=>{drafts.value={};pendingSend.clear();progress.value={};});
 return {files,fileInput,pickFiles,dropFiles,pasteFiles,removeFile,chooseFiles,previewDraft,upload,begin,end,status,requestId,sent};
}
