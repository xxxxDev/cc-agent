// Once iOS reports a visual viewport of no height (-47, see visibleHeight.js) it keeps it, and
// then nothing tells the page how tall the keyboard is, so the composer stays under it. Loading the page again is meant to give a new viewport. Not when
// something typed would be lost, and not again within a minute, should it not help.
const KEY='cc-agent-viewport-reload',WAIT_MS=60000;
// What would be lost: a chat's draft or chosen files, an open dialog, a field in use. A field
// filled in on a page kept behind others (Settings, Schedules) does not count.
const typed=()=>[...document.querySelectorAll('.chat-editor')].some(el=>el.textContent.trim())
 ||!!document.querySelector('.attachment-chip,.modal-in,:focus:is(input,textarea,[contenteditable])');
function check(){
 if(document.visibilityState!=='visible'||!(window.visualViewport?.height<=0)||typed())return;
 try{
  if(Date.now()-Number(sessionStorage.getItem(KEY)||0)<WAIT_MS)return;
  sessionStorage.setItem(KEY,String(Date.now()));
 }catch{return;}
 location.reload();
}
export function startViewportRecovery(){
 const soon=()=>{setTimeout(check,900);setTimeout(check,2500);};
 document.addEventListener('visibilitychange',soon);
 soon();
}
