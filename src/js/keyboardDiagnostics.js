import {ref} from 'vue';
// Explicitly started, memory-only geometry trace (Agent Profile's 「錄製診斷」,
// anyone's). No text, identifiers or network.
export const keyboardTrace=ref('');
let deadline=0,started=0,rows=[],last='';
export function startKeyboardTrace(){started=performance.now();deadline=started+60000;rows=[];last='';keyboardTrace.value='Recording for 60 seconds…';}
// What happened, not only where things were (such as a page jump after the + picker): taps,
// focus moves, the file picker and the viewport, each with the element's tag and classes only.
const tagOf=el=>!el||!el.tagName?'-':(el.tagName.toLowerCase()+(el.isContentEditable?'[ce]':'')+(typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\s+/).slice(0,3).join('.'):''));
function note(kind,el,extra){if(!deadline||performance.now()>deadline)return;rows.push({ms:Math.round(performance.now()-started),event:kind,target:tagOf(el),active:tagOf(globalThis.document?.activeElement),...(extra||{})});if(rows.length>240)rows.shift();keyboardTrace.value=JSON.stringify({units:'CSS px; boxes=[top,bottom,height]; vv=[height,offsetTop,pageTop,scale]; ancestors=[scrollTop,top]',samples:rows},null,2);}
const round=n=>Math.round(n*10)/10;
export function bindKeyboardTrace(page){
 let frame,until=0;
 function sample(){
  const now=performance.now();if(now>deadline||now>until)return;
  const vv=window.visualViewport;
  const box=el=>{if(!el)return null;const r=el.getBoundingClientRect();return [round(r.top),round(r.bottom),round(r.height)];};
  const ancestors=[];for(let el=page;el;el=el.parentElement)ancestors.push([round(el.scrollTop),round(el.getBoundingClientRect().top)]);
  const row={vv:vv?[round(vv.height),round(vv.offsetTop),round(vv.pageTop),round(vv.scale)]:null,
   window:[round(window.innerHeight),round(window.scrollY)],page:box(page),nav:box(page.querySelector('.navbar')),
   composer:box(page.querySelector('.messagebar')),editor:box(page.querySelector('[contenteditable]')),
   ancestors};
  const encoded=JSON.stringify(row);
  if(encoded!==last){last=encoded;rows.push({ms:Math.round(now-started),...row});if(rows.length>240)rows.shift();
   keyboardTrace.value=JSON.stringify({units:'CSS px; boxes=[top,bottom,height]; vv=[height,offsetTop,pageTop,scale]; ancestors=[scrollTop,top]',samples:rows},null,2);}
  frame=requestAnimationFrame(sample);
 }
 function wake(){if(performance.now()>deadline)return;until=Math.min(deadline,performance.now()+2000);cancelAnimationFrame(frame);sample();}
 const on=[['touchstart',e=>note('touchstart',e.target)],['touchend',e=>{note('touchend',e.target);wake();}],['click',e=>note('click',e.target)],
  ['focusin',e=>{note('focusin',e.target);wake();}],['focusout',e=>{note('focusout',e.target);wake();}],
  ['change',e=>{if(e.target?.type==='file')note('file-change',e.target,{files:e.target.files?.length||0});}],['cancel',e=>{if(e.target?.type==='file')note('file-cancel',e.target);}]];
 page.addEventListener('focusin',wake);page.addEventListener('focusout',wake);window.visualViewport?.addEventListener('resize',wake);
 const doc=globalThis.document;
 for(const [k,f] of on)doc?.addEventListener(k,f,true);
 const vvResize=()=>{note('vv-resize',null,{vv:window.visualViewport?[round(window.visualViewport.height),round(window.visualViewport.offsetTop)]:null,scrollY:round(window.scrollY)});wake();};
 const winFocus=()=>note('window-focus',null);const vis=()=>note('visibility:'+doc?.visibilityState,null);
 window.visualViewport?.addEventListener('resize',vvResize);window.visualViewport?.addEventListener('scroll',vvResize);window.addEventListener?.('focus',winFocus);doc?.addEventListener('visibilitychange',vis);
 return ()=>{cancelAnimationFrame(frame);page.removeEventListener('focusin',wake);page.removeEventListener('focusout',wake);window.visualViewport?.removeEventListener('resize',wake);for(const [k,f] of on)doc?.removeEventListener(k,f,true);window.visualViewport?.removeEventListener('resize',vvResize);window.visualViewport?.removeEventListener('scroll',vvResize);window.removeEventListener?.('focus',winFocus);doc?.removeEventListener('visibilitychange',vis);};
}
