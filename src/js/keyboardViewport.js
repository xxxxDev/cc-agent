import {visibleHeight} from './visibleHeight.js';
// Keep iOS's visual viewport and Framework7's layout in agreement. Only the
// message list may scroll; Safari's focus scroll must not move the view/navbar.
export function bindKeyboardViewport({
  root = document.getElementById('app'),
  viewport = window.visualViewport,
  onResize = () => {},
} = {}) {
  if (!root || !viewport) return () => {};
  const properties = ['position', 'top', 'left', 'height', 'width', 'minHeight'];
  const original = Object.fromEntries(properties.map(key => [key, root.style[key]]));
  let frame, active = false, geometry = '', baseline = window.innerHeight;
  const editable = () => document.activeElement?.matches('input,textarea,[contenteditable=true]');
  function resetShellScroll() {
    // overflow:hidden still permits focus/programmatic scrolling on WebKit.
    for (const el of [document.documentElement, document.body, root,
      ...root.querySelectorAll('.framework7-root, .views, .view, .page')]) {
      if (el.scrollTop) el.scrollTop = 0;
      if (el.scrollLeft) el.scrollLeft = 0;
    }
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  }
  function sync() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      root.classList.toggle('input-focused', Boolean(editable()));
      const keyboard = viewport.scale === 1 && baseline - visibleHeight(viewport) > 100 && (editable() || active);
      if (!keyboard && !editable()) baseline = window.innerHeight;
      if (viewport.scale !== 1) return;
      const next = `${visibleHeight(viewport)}:${viewport.offsetTop}:${viewport.width}`;
      const changed = geometry !== next;
      active = keyboard; geometry = next;
      root.classList.toggle('keyboard-visible', keyboard);
      Object.assign(root.style, {
        position: 'fixed', top: `${viewport.offsetTop}px`, left: '0px',
        height: `${visibleHeight(viewport)}px`, width: '100%', minHeight: '0px',
      });
      resetShellScroll();
      if (changed) {
        onResize(); // F7 remeasures its root and messagebar after the visual resize.
        // Chat uses source column-reverse bottom anchoring; do not scroll it
        // on every keyboard animation frame.
      }
    });
  }
  function focus() {
    if (!active) baseline = Math.max(window.innerHeight, visibleHeight(viewport));
    // Lock before Safari starts its focus reveal, not after the keyboard has
    // already reduced the viewport by 100px.
    root.classList.toggle('input-focused', Boolean(editable()));
    resetShellScroll();
    sync();
  }
  function shellScroll(event) {
    // Reading older messages while composing remains normal scrolling.
    if ((active || root.classList.contains('input-focused')) && (event.target === document || event.target === window ||
      event.target === root || event.target?.matches?.('html,body,.framework7-root,.views,.view,.page'))) resetShellScroll();
  }
  sync(); // Fit the visual viewport before any input is focused.
  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);
  document.addEventListener('focusin', focus);
  document.addEventListener('focusout', sync);
  document.addEventListener('scroll', shellScroll, true);
  return () => {
    cancelAnimationFrame(frame);
    Object.assign(root.style, original); root.classList.remove('keyboard-visible', 'input-focused');
    viewport.removeEventListener('resize', sync); viewport.removeEventListener('scroll', sync);
    window.removeEventListener('resize', sync);
    document.removeEventListener('focusin', focus); document.removeEventListener('focusout', sync);
    document.removeEventListener('scroll', shellScroll, true);
  };
}
