// The height the visual viewport reports, or the window's when it reports none: back from
// another app held sideways, iOS can give a home-screen app -47 (the status bar's height) and
// keep it, which put the composer above the screen.
// With no height, nothing tells the page the keyboard's either, so while a field is being typed in
// its top is taken from what was measured there: 44% of the screen, bar above it included.
export const visibleHeight=(viewport,typing=false)=>viewport.height>0?viewport.height:window.innerHeight-(typing?Math.round(screen.height*.44):0);
// A phone's keyboard that iOS reports far shorter than it is: held sideways with a field focused,
// iOS has reported a viewport of 360 of 428 (a 68 px keyboard) while the keyboard covered half the
// screen, leaving the composer behind it; other times it reports 136 of 428, as expected. No phone keyboard is under
// a quarter of the window, so its top is taken from measured sizes instead: 68% of the window
// sideways, 44% of the screen upright. Null when the reported viewport is believable.
export function shortKeyboard(viewport,{innerHeight=window.innerHeight,innerWidth=window.innerWidth,scr=screen,coarse=globalThis.matchMedia?.('(pointer: coarse)').matches}={}){
 if(!(viewport.height>0)||!coarse||Math.min(scr.width,scr.height)>=600)return null;
 const cut=innerHeight-viewport.height;if(cut<=0||cut>=innerHeight*.25)return null;
 return innerHeight-Math.round(innerWidth>innerHeight?innerHeight*.68:scr.height*.44);
}
