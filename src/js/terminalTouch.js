const TAP_SLOP=8;

export function bindTerminalTouch(host,term) {
  const view=host.ownerDocument.defaultView;
  let gesture=null,frame=0,suppressClickUntil=0;
  function cancel(){if(gesture?.phase==='pan')suppressClickUntil=Date.now()+500;gesture=null;if(frame)view.cancelAnimationFrame(frame);frame=0;}
  function scroll(){
    frame=0;const g=gesture;if(!g)return;
    if(term.buffer.active.type==='normal'&&term.modes.mouseTrackingMode==='none'){
      const lines=Math.trunc(g.pixels/g.cellHeight);g.pixels-=lines*g.cellHeight;if(lines)term.scrollLines(lines);
    }else if(g.pixels){
      const rect=g.rect;
      g.target.dispatchEvent(new view.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaMode:0,deltaY:g.pixels,clientX:Math.max(rect.left+1,Math.min(rect.right-1,g.lastX)),clientY:Math.max(rect.top+1,Math.min(rect.bottom-1,g.lastY))}));g.pixels=0;
    }
    if(g.ended)gesture=null;
  }
  function schedule(){if(!frame)frame=view.requestAnimationFrame(scroll);}
  function start(event){
    cancel();if(event.touches.length!==1)return;const t=event.touches[0];if(t.clientX<24)return;
    const target=host.querySelector('.xterm-screen'),rect=target?.getBoundingClientRect(),cellHeight=rect?.height/term.rows;if(!(cellHeight>0))return;
    gesture={phase:'pending',id:t.identifier,x:t.clientX,y:t.clientY,lastX:t.clientX,lastY:t.clientY,target,rect,cellHeight,pixels:0};
  }
  function move(event){
    const g=gesture;if(!g)return;if(event.touches.length!==1){cancel();return;}
    const t=Array.from(event.touches).find(t=>t.identifier===g.id);if(!t){cancel();return;}
    const dx=t.clientX-g.x,dy=t.clientY-g.y;
    if(g.phase==='pending'){if(Math.max(Math.abs(dx),Math.abs(dy))<TAP_SLOP)return;g.phase=Math.abs(dx)>Math.abs(dy)?'horizontal':'pan';}
    if(g.phase==='horizontal')return;
    event.preventDefault();event.stopPropagation();g.pixels+=g.lastY-t.clientY;g.lastX=t.clientX;g.lastY=t.clientY;schedule();
  }
  function end(event){const g=gesture;if(!g)return;if(event.touches.length||g.phase!=='pan'){cancel();return;}suppressClickUntil=Date.now()+500;g.ended=true;if(frame)return;gesture=null;}
  function click(event){if(Date.now()<suppressClickUntil){event.preventDefault();event.stopPropagation();}}
  const options={capture:true,passive:false};
  const listeners=[['touchstart',start],['touchmove',move],['touchend',end],['touchcancel',cancel],['pointercancel',cancel],['click',click]];
  for(const [type,fn] of listeners)host.addEventListener(type,fn,options);
  return ()=>{cancel();for(const [type,fn] of listeners)host.removeEventListener(type,fn,true);};
}
