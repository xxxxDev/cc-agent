// Framework7's lit, enlarged press (touch-highlight) goes only on the element's own
// pointerleave. A touch that a native sheet takes (the composer's ＋ opening the file
// picker) never sends one, and the ＋ stayed lit and enlarged until something drew the
// page again; a control should let go of its own press.
// Once no finger is down, every press still lit is let go: by its own pointerleave, so
// Framework7 forgets it too, and by hand for one it has already forgotten.
const LIGHT = 'span.rounded-\\[inherit\\]';
// The finger last put down and not yet lifted: what it holds stays lit.
let held = null, later = 0;
function releaseAll() {
  for (const light of document.querySelectorAll(LIGHT)) {
    const el = light.parentElement;
    if (!el || held && held.target && el.contains(held.target)) continue;
    try { el.dispatchEvent(new PointerEvent('pointerleave', {bubbles: false})); } catch {}
    if (light.isConnected) light.remove();
    el.style.scale = '';
  }
}
function soon() { clearTimeout(later); later = setTimeout(releaseAll, 400); }
export function startTouchHighlightRelease() {
  if (typeof document === 'undefined') return;
  document.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') held = {id: e.pointerId, target: e.target}; }, true);
  const up = e => { if (e.pointerType === 'mouse') return; if (held?.id === e.pointerId) held = null; soon(); };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  // A sheet or picker that took the touch: its answer, or the page coming back.
  const reset = () => { held = null; soon(); };
  document.addEventListener('change', e => { if (e.target?.matches?.('input[type=file]')) reset(); }, true);
  document.addEventListener('cancel', e => { if (e.target?.matches?.('input[type=file]')) reset(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reset(); });
  window.addEventListener('focus', reset);
  window.addEventListener('pageshow', reset);
}
