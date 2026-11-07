// A finger on a message bubble: drawn to the left, a round reply icon shows on its right and
// fills in; past REPLY_PX it lights up (a short buzz where the phone has one) and letting
// go replies, short of it the bubble slides back. Held still for LONG_PRESS_MS, the page
// dims, the bubble lifts and two round buttons float over it, copy and reply; a tap
// anywhere else closes them.
// It keeps out of the way of what fingers already do there: the direction is decided on
// the first DECIDE_PX and only a leftward, mostly level move is taken (a vertical one
// scrolls as before, and the iOS back swipe from the left edge goes rightward; a touch
// starting at that edge never swipes); a code block or table that scrolls sideways keeps
// its own swipe; a selection already made is left to the browser. The native callout and
// selection are held back on that one bubble only while it is pressed or its menu is up.
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';

export const LONG_PRESS_MS = 450, DECIDE_PX = 8, REPLY_PX = 56, EDGE_PX = 24;
const MAX_PX = 96, ICON = 36, BUTTON = 44, GAP = 10, LIFT = 1.03;
// Never a gesture here: things that take a finger of their own.
const SKIP_ALL = 'input,textarea,select,[contenteditable],.md-scroll';
// No long press here: links, buttons, pictures and files keep the browser's own.
const SKIP_PRESS = 'a,button,.md-copy,.reply-quote,.message-pictures,.attachment-chip';

export function useBubbleGestures({list, find, canReply, isSent, reply, copy}) {
  const menu = ref(null);
  let g = null, root = null;

  function bubbleOf(target) {
    const el = target?.closest?.('.message[data-message-id]');
    if (!el || !root?.contains(el) || el.classList.contains('schedule-card') || el.classList.contains('message-typing')) return null;
    const m = find(el.dataset.messageId);
    return m ? {el, m} : null;
  }
  function start(e) {
    if (menu.value) return;
    if (e.touches.length !== 1) { drop(); return; }
    const hit = bubbleOf(e.target);
    if (!hit || e.target.closest(SKIP_ALL) || String(window.getSelection?.() || '')) return;
    const t = e.touches[0];
    const press = !e.target.closest(SKIP_PRESS) && (!!hit.m.text || canReply());
    g = {...hit, x0: t.clientX, y0: t.clientY, mode: null, armed: false, swipe: canReply() && t.clientX > EDGE_PX, timer: null};
    if (press) { hit.el.classList.add('bubble-pressing'); g.timer = setTimeout(openMenu, LONG_PRESS_MS); }
    // A list that scrolls under the finger (a flick, the momentum of one) is no press.
    document.addEventListener('scroll', scrolled, {capture: true, passive: true});
  }
  function scrolled() { if (g && !g.mode) drop(); }
  function move(e) {
    if (!g) return;
    if (g.mode === 'menu') { if (e.cancelable) e.preventDefault(); return; }
    const t = e.touches[0], dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.mode) {
      if (Math.hypot(dx, dy) < DECIDE_PX) return;
      clearTimeout(g.timer); g.el.classList.remove('bubble-pressing');
      if (!(g.swipe && dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2)) { g = null; unhook(); return; }
      g.mode = 'swipe'; beginSwipe(g);
    }
    if (e.cancelable) e.preventDefault();
    pullTo(g, -dx);
  }
  function end(e) {
    if (!g) return;
    const was = g; g = null; unhook();
    clearTimeout(was.timer); was.el.classList.remove('bubble-pressing');
    if (was.mode === 'menu') { if (e.cancelable) e.preventDefault(); return; }
    if (was.mode === 'swipe') { if (e.cancelable) e.preventDefault(); settle(was, e.type === 'touchend' && was.armed); }
  }
  function unhook() { document.removeEventListener('scroll', scrolled, {capture: true}); }
  function drop() {
    if (!g) return;
    const was = g; g = null; unhook();
    clearTimeout(was.timer); was.el.classList.remove('bubble-pressing');
    if (was.mode === 'swipe') settle(was, false);
  }

  function beginSwipe(s) {
    const box = s.el.getBoundingClientRect(), content = s.el.querySelector('.message-content')?.getBoundingClientRect() || box;
    s.contentRight = content.right - box.left; s.width = s.el.clientWidth;
    s.icon = document.createElement('div');
    s.icon.className = 'reply-swipe-icon'; s.icon.setAttribute('aria-hidden', 'true');
    s.icon.innerHTML = '<i class="icon f7-icons">arrowshape_turn_up_left</i>';
    s.el.classList.add('reply-swiping'); s.el.appendChild(s.icon);
  }
  function pullTo(s, raw) {
    const pull = Math.max(0, raw);
    const shown = Math.min(MAX_PX, pull <= REPLY_PX ? pull : REPLY_PX + (pull - REPLY_PX) * 0.35);
    s.el.style.setProperty('--reply-swipe', -shown + 'px');
    const progress = Math.min(1, shown / REPLY_PX);
    s.icon.style.left = Math.min(s.contentRight - shown + 12, s.width - ICON - 8) + 'px';
    s.icon.style.opacity = String(progress);
    s.icon.style.transform = `translateY(-50%) scale(${0.6 + 0.4 * progress})`;
    const armed = pull >= REPLY_PX;
    if (armed && !s.armed) navigator.vibrate?.(10);
    s.armed = armed; s.icon.classList.toggle('armed', armed);
  }
  function settle(s, go) {
    s.el.classList.add('reply-swipe-back');
    s.el.style.setProperty('--reply-swipe', '0px');
    if (s.icon) s.icon.style.opacity = '0';
    setTimeout(() => { s.el.classList.remove('reply-swiping', 'reply-swipe-back'); s.el.style.removeProperty('--reply-swipe'); s.icon?.remove(); }, 220);
    if (go) reply(s.m);
  }

  function openMenu() {
    if (!g || g.mode) return;
    g.mode = 'menu';
    const {el, m} = g;
    window.getSelection?.()?.removeAllRanges?.();
    const bubble = el.querySelector('.message-bubble');
    const box = (bubble && bubble.offsetParent !== null ? bubble : el.querySelector('.message-content') || el).getBoundingClientRect();
    el.classList.add('bubble-menu-on');
    menu.value = {message: m, el, sent: isSent(m), canCopy: !!m.text, canReply: canReply(),
      rect: {top: box.top, left: box.left, width: box.width, height: box.height}};
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    document.addEventListener('keydown', onKey);
  }
  function closeMenu() {
    const open = menu.value;
    if (!open) return;
    open.el.classList.remove('bubble-menu-on');
    menu.value = null;
    window.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('resize', closeMenu);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } }
  function contextMenu(e) { if (g || menu.value) e.preventDefault(); }

  // The bubble's place, a little larger as it lifts, left clear of the dimming (the
  // hole of an SVG mask over the page).
  const holeStyle = computed(() => {
    const open = menu.value, r = open?.rect; if (!r) return null;
    // It grows by LIFT from its own side (left for a reply, right for the reader's own).
    const grow = r.width * (LIFT - 1), padY = 4 + r.height * (LIFT - 1) / 2;
    return {x: r.left - 4 - (open.sent ? grow : 0), y: r.top - padY, width: r.width + 8 + grow, height: r.height + padY * 2};
  });
  // Over the bubble, on its own side; under it when there is no room above.
  const menuStyle = computed(() => {
    const open = menu.value; if (!open) return null;
    const r = open.rect, count = (open.canCopy ? 1 : 0) + (open.canReply ? 1 : 0), w = count * BUTTON + (count - 1) * GAP;
    const top = r.top - BUTTON - 14 >= 56 ? r.top - BUTTON - 14 : r.top + r.height + 14;
    const x = open.sent ? r.left + r.width - w : r.left;
    return {top: Math.min(top, innerHeight - BUTTON - 8) + 'px', left: Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px'};
  });

  onMounted(() => {
    root = list();
    if (!root) return;
    root.addEventListener('touchstart', start, {passive: true});
    root.addEventListener('touchmove', move, {passive: false});
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', drop);
    root.addEventListener('contextmenu', contextMenu);
  });
  onBeforeUnmount(() => {
    closeMenu(); drop();
    root?.removeEventListener('touchstart', start);
    root?.removeEventListener('touchmove', move);
    root?.removeEventListener('touchend', end);
    root?.removeEventListener('touchcancel', drop);
    root?.removeEventListener('contextmenu', contextMenu);
  });

  return {
    menu, holeStyle, menuStyle, close: closeMenu,
    copy() { const m = menu.value?.message; closeMenu(); if (m) copy(m); },
    reply() { const m = menu.value?.message; closeMenu(); if (m) reply(m); },
  };
}
