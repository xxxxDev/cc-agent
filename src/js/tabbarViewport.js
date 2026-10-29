// Keep the floating tabbar's offset, even when an installed PWA reports
// a layout viewport taller than the visible screen. Never resize the app shell.
export function bindTabbarViewport({viewport=window.visualViewport}={}) {
  if(!viewport)return ()=>{};
  let frame;
  const sync=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
    // The same shortfall for what sits at the very bottom of the app, as a toast
    // does ("已經是最新版本" was cut off).
    const app=document.getElementById('app');
    if(app&&viewport.scale===1){const value=Math.max(0,Math.round(app.getBoundingClientRect().bottom-(viewport.offsetTop+viewport.height)))+'px';if(document.documentElement.style.getPropertyValue('--viewport-overflow')!==value)document.documentElement.style.setProperty('--viewport-overflow',value);}
    const bar=document.querySelector('.toolbar-layout-wrapper');
    if(!bar||viewport.scale!==1)return;
    const parent=bar.offsetParent;
    if(!parent)return;
    const overflow=Math.max(0,parent.getBoundingClientRect().bottom-(viewport.offsetTop+viewport.height));
    if(bar.style.bottom!==`${overflow}px`)bar.style.bottom=`${overflow}px`;
  });};
  viewport.addEventListener('resize',sync);viewport.addEventListener('scroll',sync);
  window.addEventListener('resize',sync);
  const observer=new MutationObserver(sync);
  observer.observe(document.getElementById('app'),{childList:true,subtree:true});
  sync();
  return ()=>{cancelAnimationFrame(frame);observer.disconnect();viewport.removeEventListener('resize',sync);viewport.removeEventListener('scroll',sync);window.removeEventListener('resize',sync);const bar=document.querySelector('.toolbar-layout-wrapper');if(bar)bar.style.bottom='';document.documentElement.style.removeProperty('--viewport-overflow');};
}
