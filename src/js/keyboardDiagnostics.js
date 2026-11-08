import {ref,reactive,computed} from 'vue';
// Explicitly started, memory-only geometry trace (Agent Profile's 「錄製診斷」,
// anyone's). No text, identifiers or network.
// The recording, app-wide: on until stopped, by the badge
// every page shows while it runs or by 「停止錄製」 in Agent Profile, and at most five minutes;
// for the agent it was started from, whose report it goes with.
export const RECORDING_CAP_MS=5*60*1000;
export const recording=reactive({active:false,conversationId:null,startedAt:0,elapsed:0});
const UNITS='CSS px; boxes=[top,bottom,height]; vv=[height,offsetTop,pageTop,scale]; ancestors=[scrollTop,top]';
// Enough for five minutes of taps and settled geometry; the oldest go first past it, and the
// report trims more when its text would not fit (diagnosticsText.js).
const MAX_ROWS=1000;
let deadline=0,started=0,rows=[],last='',tick=null,cap=null;
const unref=t=>{t?.unref?.();return t;};
// Written out when read, not on every sample: five minutes of samples is a long text.
const changes=ref(0),placeholder=ref('');
function publish(){changes.value++;}
export const keyboardTrace=computed(()=>(changes.value,rows.length?JSON.stringify({units:UNITS,samples:rows},null,2):placeholder.value));
// The samples as they are, for a report that must leave the oldest out to fit.
export function traceSamples(){return rows.slice();}
export function traceWith(samples,leftOut){return JSON.stringify({units:UNITS,...(leftOut?{leftOut:`the oldest ${leftOut} samples, to fit the report`}:{}),samples},null,2);}
export function startKeyboardTrace(conversationId=null){
 clearInterval(tick);clearTimeout(cap);
 started=performance.now();deadline=started+RECORDING_CAP_MS;rows=[];last='';placeholder.value='Recording…';publish();
 Object.assign(recording,{active:true,conversationId,startedAt:Date.now(),elapsed:0});
 tick=unref(setInterval(()=>{recording.elapsed=Math.min(RECORDING_CAP_MS,Math.max(0,Math.round(performance.now()-started)));},1000));
 cap=unref(setTimeout(stopKeyboardTrace,RECORDING_CAP_MS));
}
// Stopped: what was recorded stays, for 複製 and 回報 in 工程診斷資訊.
export function stopKeyboardTrace(){
 if(!recording.active)return;
 clearInterval(tick);clearTimeout(cap);tick=cap=null;
 const now=performance.now();deadline=Math.min(deadline,now);
 Object.assign(recording,{active:false,elapsed:Math.min(RECORDING_CAP_MS,Math.round(now-started))});
 placeholder.value='Nothing was recorded.';publish();
}
// 0:23, 4:05.
export function recordingClock(ms){const s=Math.floor((ms||0)/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
// What happened, not only where things were (such as a page jump after the + picker): taps,
// focus moves, the file picker and the viewport, each with the element's tag and classes only.
const tagOf=el=>!el||!el.tagName?'-':(el.tagName.toLowerCase()+(el.isContentEditable?'[ce]':'')+(typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\s+/).slice(0,3).join('.'):''));
function note(kind,el,extra){if(!deadline||performance.now()>deadline)return;rows.push({ms:Math.round(performance.now()-started),event:kind,target:tagOf(el),active:tagOf(globalThis.document?.activeElement),...(extra||{})});if(rows.length>MAX_ROWS)rows.shift();publish();}
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
  if(encoded!==last){last=encoded;rows.push({ms:Math.round(now-started),...row});if(rows.length>MAX_ROWS)rows.shift();publish();}
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
