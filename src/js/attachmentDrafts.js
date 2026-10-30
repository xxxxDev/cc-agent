import {ref,computed,nextTick,watch} from 'vue';
import {f7} from 'framework7-vue';
import {api} from './api.js';
export function useAttachmentDrafts(selected,user,busy,ct){
 const drafts=ref({}),fileInput=ref(null);
 const files=computed(()=>drafts.value[selected.value]||[]);
 const pendingSend=new Map();
 const resize=()=>nextTick(()=>document.querySelector('.chat-page .messagebar')?.f7Messagebar?.resizePage());
 function addFiles(list){if(!selected.value||busy.value)return;const next=[...files.value];for(const file of Array.from(list||[])){if(next.length>=10){f7.dialog.alert(ct('最多 10 個附件'));break;}if(!file.size||file.size>25*1024*1024){f7.dialog.alert(ct('附件大小須為 1 byte 至 25 MB')+': '+file.name);continue;}next.push({key:crypto.randomUUID(),file,name:file.name,size:file.size,uploadedId:null});}drafts.value[selected.value]=next;pendingSend.delete(selected.value);resize();}
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
 function chooseFiles(){if(!busy.value)fileInput.value?.click();}
 async function upload(id,items){for(const item of items){if(!item.uploadedId){const r=await api('/conversations/'+id+'/attachments?name='+encodeURIComponent(item.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:item.file});item.uploadedId=r.id;}}return items.map(x=>x.uploadedId);}
 function requestId(id,text,items){const signature=JSON.stringify([text,items.map(x=>x.key)]);const previous=pendingSend.get(id);if(previous?.signature===signature)return previous.id;const value={signature,id:crypto.randomUUID()};pendingSend.set(id,value);return value.id;}
 function sent(id,items){const keys=new Set(items.map(x=>x.key));drafts.value[id]=(drafts.value[id]||[]).filter(x=>!keys.has(x.key));pendingSend.delete(id);resize();}
 watch(files,resize);
 watch(()=>user.value?.id,()=>{drafts.value={};pendingSend.clear();});
 return {files,fileInput,pickFiles,dropFiles,pasteFiles,removeFile,chooseFiles,previewDraft,upload,requestId,sent};
}
