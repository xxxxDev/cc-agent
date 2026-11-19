// Keep the floating tabbar's offset, even when an installed PWA reports
// a layout viewport taller than the visible screen. Never resize the app shell.
// More than a status bar or a home indicator, less than any keyboard.
const STALE_SHORTFALL=120;
export function bindTabbarViewport({viewport=window.visualViewport}={}) {
  if(!viewport)return ()=>{};
  let frame;
  // The same fallback as visibleHeight.js, written out so this file imports nothing.
  // Back from another app that had its keyboard open, iOS can leave the visual viewport short by
  // that keyboard and send nothing more, and the bar stayed where the keyboard's top had been.
  // With nothing on this page being typed in, no keyboard is ours: a shortfall that large is
  // taken as stale and the window's height used instead.
  const typing=()=>!!document.activeElement?.matches?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  const height=()=>{const h=viewport.height>0?viewport.height:window.innerHeight;return !typing()&&window.innerHeight-h>STALE_SHORTFALL?window.innerHeight:h;};
  const sync=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
    // The same shortfall for what sits at the very bottom of the app, as a toast
    // does ("已經是最新版本" was cut off).
    const app=document.getElementById('app');
    if(app&&viewport.scale===1){const value=Math.max(0,Math.round(app.getBoundingClientRect().bottom-(viewport.offsetTop+height())))+'px';if(document.documentElement.style.getPropertyValue('--viewport-overflow')!==value)document.documentElement.style.setProperty('--viewport-overflow',value);}
    const bar=document.querySelector('.toolbar-layout-wrapper');
    if(!bar||viewport.scale!==1)return;
    const parent=bar.offsetParent;
    if(!parent)return;
    // A keyboard of ours up (a field in use, the screen short by more than a home bar): the bar
    // stays at the foot behind it, as an iPhone app's tab bar does, rather than riding over the
    // list on the keyboard's top. Toasts above still follow the keyboard.
    const keyboard=typing()&&window.innerHeight-height()>STALE_SHORTFALL;
    const overflow=keyboard?0:Math.max(0,parent.getBoundingClientRect().bottom-(viewport.offsetTop+height()));
    if(bar.style.bottom!==`${overflow}px`)bar.style.bottom=`${overflow}px`;
    const hide=keyboard?'hidden':'';
    if(bar.style.visibility!==hide)bar.style.visibility=hide;
  });};
  viewport.addEventListener('resize',sync);viewport.addEventListener('scroll',sync);
  window.addEventListener('resize',sync);
  // Measured again a few times once back in front, and when a field is left: iOS may correct its
  // numbers later without a resize.
  let later=[];
  const again=()=>{later.forEach(clearTimeout);later=[0,150,500,1200].map(ms=>setTimeout(sync,ms));};
  const shown=()=>{if(document.visibilityState==='visible')again();};
  document.addEventListener('visibilitychange',shown);window.addEventListener('pageshow',again);window.addEventListener('focus',again);document.addEventListener('focusout',again);
  const observer=new MutationObserver(sync);
  observer.observe(document.getElementById('app'),{childList:true,subtree:true});
  sync();
  return ()=>{cancelAnimationFrame(frame);later.forEach(clearTimeout);document.removeEventListener('visibilitychange',shown);window.removeEventListener('pageshow',again);window.removeEventListener('focus',again);document.removeEventListener('focusout',again);observer.disconnect();viewport.removeEventListener('resize',sync);viewport.removeEventListener('scroll',sync);window.removeEventListener('resize',sync);const bar=document.querySelector('.toolbar-layout-wrapper');if(bar){bar.style.bottom='';bar.style.visibility='';}document.documentElement.style.removeProperty('--viewport-overflow');};
}
