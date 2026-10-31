// The navbar and routed page keep their native F7 geometry. Only the scroll
// region and composer follow the keyboard's available height.
//
// The history region is *eased* into its new height; the composer is not: easing
// the composer leaves it under the keyboard, and not easing the history is what
// makes the whole thing look like a jump.
//
// The curve is smootherstep — gentle at both ends. It is used instead of the
// msg-fade-up cubic-bezier(.22,1,.36,1), which is right for a bubble arriving but
// covers a third of the distance in its first tenth: over 300px of region that
// reads as a snap followed by a settle, not as being carried.
const ease=t=>t<=0?0:t>=1?1:t*t*t*(t*(t*6-15)+10);
import {visibleHeight} from './visibleHeight.js';
const REGION_MS=340;
export function bindConversationViewport(page,{viewport=window.visualViewport}={}) {
  if(!page||!viewport)return ()=>{};
  let motionFrame,shownHeight,targetHeight,fromHeight,startTime;
  let focusFrame,baseline=window.innerHeight,pin=false,keyboard=false;
  const content=()=>page.querySelector('.messages-content');
  const input=()=>page.querySelector('textarea:focus,input:focus,[contenteditable]:focus');
  // Safari can reveal a contenteditable caret by scrolling overflow:hidden
  // ancestors, in addition to shrinking visualViewport. Keep the app shell at
  // its pre-focus origin; message history and editor scrolling remain native.
  let shellScroll=null,bodyLock=null;
  function rememberShell(){
    if(shellScroll)return;
    shellScroll=[];
    // Device trace: only the document root scrolls (0 -> 416), despite clip.
    // Fix the body's layout before native caret reveal; retain its full height.
    const doc=page.ownerDocument,body=doc?.body;
    if(body&&input()?.hasAttribute?.('contenteditable'))lockBody(body,doc);

    for(let el=page;el;el=el.parentElement){
      const style=el.style;
      shellScroll.push({el,top:el.scrollTop||0,left:el.scrollLeft||0,
        overflow:style?.getPropertyValue?.('overflow')||'',priority:style?.getPropertyPriority?.('overflow')||''});
      // Unlike hidden, clip does not create a programmatically scrollable box.
      // Apply BEFORE focusing, including on the view and app ancestors.
      style?.setProperty('overflow','clip');
    }
  }
  function lockBody(body,doc){
    if(bodyLock)return;
    const props=['position','top','left','width','height'];
    bodyLock={body,styles:props.map(key=>[key,body.style.getPropertyValue(key),body.style.getPropertyPriority(key)])};
    const height=doc.documentElement.clientHeight||page.clientHeight;
    body.style.setProperty('position','fixed');body.style.setProperty('top',`${-(window.scrollY||0)}px`);
    body.style.setProperty('left',`${-(window.scrollX||0)}px`);body.style.setProperty('width','100%');body.style.setProperty('height',`${height}px`);
  }
  function releaseShell(){
    if(bodyLock){for(const [key,value,priority] of bodyLock.styles){if(value)bodyLock.body.style.setProperty(key,value,priority);else bodyLock.body.style.removeProperty(key);}bodyLock=null;}

    if(!shellScroll)return;
    for(const {el,overflow,priority} of shellScroll){
      if(overflow)el.style?.setProperty('overflow',overflow,priority);
      else el.style?.removeProperty('overflow');
    }
    shellScroll=null;
  }
  function restoreShell(){
    if(!shellScroll||viewport.scale!==1)return;
    for(const {el,top,left} of shellScroll){
      if(el.scrollTop!==top)el.scrollTop=top;
      if(el.scrollLeft!==left)el.scrollLeft=left;
    }
  }
  function shellScrolled(event){
    if(shellScroll?.some(({el})=>el===event.target)||event.target===viewport)sync();
  }
  let hiddenInput,focusStyles,focusTimer,parked=false;
  function reveal(){
    clearTimeout(focusTimer);
    if(hiddenInput){
      for(const [key,value,priority] of focusStyles){
        if(value)hiddenInput.style.setProperty(key,value,priority);
        else hiddenInput.style.removeProperty(key);
      }
      hiddenInput=null;parked=false;
    }
  }
  function sync(){
    if(viewport.scale!==1)return;
    keyboard=(Boolean(input())||keyboard)&&baseline-visibleHeight(viewport,Boolean(input()))>100;
    if(!input()&&!keyboard)baseline=window.innerHeight;

    const height=Math.min(visibleHeight(viewport,Boolean(input())),page.clientHeight);
    // The composer must track the keyboard boundary immediately; only the history
    // gets the eased resize.
    page.classList.toggle('conversation-keyboard',keyboard);
    page.style.setProperty('--conversation-composer-lift',`${Math.max(0,page.clientHeight-height)}px`);
    // Geometry and safe area are ready before correcting document scroll.
    restoreShell();
    // Restore the caret only after the composer is above the keyboard.
    if(parked&&keyboard)reveal();
    if(!input()&&!keyboard)releaseShell();
    const animate=shownHeight!==undefined&&(Boolean(input())||keyboard||shownHeight<page.clientHeight-1)&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if(height===targetHeight)return;
    targetHeight=height;
    cancelAnimationFrame(motionFrame);
    if(!animate){paint(height);return;}
    // Retarget from what is on screen, so a stream of resize samples during one
    // keyboard opening reads as a single continuous move.
    fromHeight=shownHeight;startTime=undefined;
    motionFrame=requestAnimationFrame(step);
  }
  function paint(height){
    shownHeight=height;
    page.style.setProperty('--conversation-visible-height',`${height}px`);
    if(pin&&content())content().scrollTop=content().scrollHeight;
  }
  function step(time){
    if(startTime===undefined)startTime=time;
    const progress=Math.min(1,(time-startTime)/REGION_MS);
    paint(fromHeight+(targetHeight-fromHeight)*ease(progress));
    if(progress<1)motionFrame=requestAnimationFrame(step);
  }
  function focus(){rememberShell();const el=content();pin=Boolean(el&&el.scrollHeight-el.clientHeight-el.scrollTop<80);if(!keyboard)baseline=Math.max(window.innerHeight,visibleHeight(viewport,Boolean(input())));sync();}
  // A stuck viewport sends no resize when the keyboard goes.
  function stuckBlur(){if(viewport.height<=0)setTimeout(sync);}
  function touchFocus(event){
    const el=event.target.closest?.('[contenteditable]')||event.target;
    if(!el.matches?.('textarea,input,[contenteditable]')||document.activeElement===el)return;
    rememberShell();if(el.hasAttribute?.('contenteditable')&&page.ownerDocument?.body)lockBody(page.ownerDocument.body,page.ownerDocument);
    event.preventDefault();reveal();cancelAnimationFrame(focusFrame);
    hiddenInput=el;
    focusStyles=['opacity','transform','transition'].map(key=>[key,el.style.getPropertyValue(key),el.style.getPropertyPriority(key)]);
    parked=el.hasAttribute?.('contenteditable')&&!keyboard;
    el.style.setProperty('opacity','0');
    if(parked){
      // Native caret reveal ignores preventScroll for this editable div.
      // Move only its invisible focus geometry (not the toolbar/page layout)
      // near the navbar until visualViewport reports the keyboard boundary.
      const top=page.querySelector('.navbar')?.getBoundingClientRect().bottom||0;
      const delta=Math.min(0,top+16-el.getBoundingClientRect().top);
      el.style.setProperty('transition','none','important');
      el.style.setProperty('transform',`translateY(${delta}px)`,'important');
      // Hardware keyboards may never resize visualViewport.
      focusTimer=setTimeout(reveal,500);
    }
    el.focus({preventScroll:true});
    if(!parked)focusFrame=requestAnimationFrame(reveal);
  }
  let tap=null;
  function touchStart(event){
    const el=event.target.closest?.('[contenteditable]')||event.target;
    const point=event.touches?.[0];
    tap=event.touches?.length===1&&el.matches?.('textarea,input,[contenteditable]')&&document.activeElement!==el
      ?{el,x:point.clientX,y:point.clientY}:null;
  }
  function touchMove(event){
    const point=event.touches?.[0];
    if(!point||event.touches.length!==1||tap&&Math.hypot(point.clientX-tap.x,point.clientY-tap.y)>8)tap=null;
  }
  function touchEnd(event){
    const pending=tap;tap=null;
    if(!pending||event.touches?.length||!event.cancelable)return;
    // Focus after release, then suppress Safari's default focus/caret action
    // for this same tap. A moved invisible editor must not be re-hit-tested.
    touchFocus({target:pending.el,preventDefault:()=>event.preventDefault()});
  }
  function touchCancel(){tap=null;}
  // A search taking the reader to an older message: the next keyboard move must
  // not pin them back to the newest. The keyboard closing after a tap in the search
  // did exactly that, so the jump seemed to need a second tap.
  function unpin(){pin=false;}
  // The reader scrolling up while the keyboard is open lets go of the bottom: every
  // later keyboard resize (a suggestion bar, a keyboard switch) pulled them back to
  // the newest while they typed. Scrolling back to
  // the bottom holds it again.
  function historyScrolled(event){
    const el=event.target;
    if(!el?.classList?.contains('messages-content'))return;
    pin=el.scrollHeight-el.clientHeight-el.scrollTop<80;
  }
  const touchOptions={passive:false};
  viewport.addEventListener('resize',sync);viewport.addEventListener('scroll',shellScrolled);window.addEventListener('resize',sync);
  page.ownerDocument?.addEventListener('scroll',shellScrolled,true);
  page.addEventListener('touchstart',touchStart,{passive:true});page.addEventListener('touchmove',touchMove,{passive:true});page.addEventListener('touchend',touchEnd,touchOptions);page.addEventListener('touchcancel',touchCancel);page.addEventListener('focusin',focus);page.addEventListener('focusout',stuckBlur);page.addEventListener('focusout',sync);page.addEventListener('conversation:unpin',unpin);page.addEventListener('scroll',historyScrolled,true);sync();
  return ()=>{cancelAnimationFrame(motionFrame);cancelAnimationFrame(focusFrame);reveal();page.style.removeProperty('--conversation-visible-height');page.style.removeProperty('--conversation-composer-lift');page.classList.remove('conversation-keyboard');page.removeEventListener('focusout',stuckBlur);viewport.removeEventListener('resize',sync);viewport.removeEventListener('scroll',shellScrolled);page.ownerDocument?.removeEventListener('scroll',shellScrolled,true);releaseShell();window.removeEventListener('resize',sync);page.removeEventListener('touchstart',touchStart);page.removeEventListener('touchmove',touchMove);page.removeEventListener('touchend',touchEnd,touchOptions);page.removeEventListener('touchcancel',touchCancel);page.removeEventListener('focusin',focus);page.removeEventListener('focusout',sync);page.removeEventListener('conversation:unpin',unpin);page.removeEventListener('scroll',historyScrolled,true);};
}
