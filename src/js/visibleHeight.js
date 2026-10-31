// The height the visual viewport reports, or the window's when it reports none: back from
// another app held sideways, iOS can give a home-screen app -47 (the status bar's height) and
// keep it, which put the composer above the screen.
// With no height, nothing tells the page the keyboard's either, so while a field is being typed in
// its top is taken from what was measured there: 44% of the screen, bar above it included.
export const visibleHeight=(viewport,typing=false)=>viewport.height>0?viewport.height:window.innerHeight-(typing?Math.round(screen.height*.44):0);
