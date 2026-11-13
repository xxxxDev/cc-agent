// A finger on a message bubble: drawn to the left, a round reply icon shows on its right and
// fills in; past REPLY_PX it lights up (a short buzz where the phone has one) and letting
// go replies, short of it the bubble slides back. Held still for LONG_PRESS_MS, the page
// dims, the bubble lifts and two round buttons float under it, copy and reply; a tap
// anywhere else closes them, all easing in and out.
// It keeps out of the way of what fingers already do there: the direction is decided on
// the first DECIDE_PX and only a leftward, mostly level move is taken (a vertical one
// scrolls as before, and the iOS back swipe from the left edge goes rightward; a touch
// starting at that edge never swipes); a code block or table that scrolls sideways keeps
// its own swipe; a selection already made is left to the browser. The native callout and
// selection are held back on that one bubble only while it is pressed or its menu is up.
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';

export const LONG_PRESS_MS = 450, DECIDE_PX = 8, REPLY_PX = 56, EDGE_PX = 24;
const MAX_PX = 96, ICON = 36, BUTTON = 44, GAP = 10, MENU_GAP = 12, LIFT = 1.03, CLOSE_MS = 220;
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
    if (menu.value && !menu.value.closing) return;
    if (menu.value) finish();
    if (e.touches.length !== 1) { drop(); return; }
    const hit = bubbleOf(e.target);
    if (!hit || e.target.closest(SKIP_ALL) || String(window.getSelection?.() || '')) return;
    const t = e.touches[0];
    const press = !e.target.closest(SKIP_PRESS) && (!!hit.m.text || canReply());
    g = {...hit, x0: t.clientX, y0: t.clientY, mode: null, armed: false, swipe: canReply() && t.clientX > EDGE_PX, timer: null};
    // Where the finger is in the text, taken at the touch, before the press styles the bubble.
    if (press && hit.m.text) g.caret = caretAt(t.clientX, t.clientY, hit.el);
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
    clearSelection();
    // iOS starts its own text selection a moment after our press opens the menu, and put its
    // handles on the menu's icons: clear it while the menu is up.
    document.addEventListener('selectionchange', clearSelection);
    setTimeout(clearSelection, 120); setTimeout(clearSelection, 400);
    finish();
    const content = el.querySelector('.message-content') || el, c = content.getBoundingClientRect(), sent = isSent(m);
    const bubble = el.querySelector('.message-bubble'), shown = bubble && bubble.offsetParent !== null && bubble.getBoundingClientRect().height > 0;
    // It lifts by LIFT from the middle of its own side (right for the reader's own, left for a reply).
    const ox = sent ? c.right : c.left, oy = c.top + c.height / 2;
    const lift = r => ({left: ox + (r.left - ox) * LIFT, top: oy + (r.top - oy) * LIFT, width: r.width * LIFT, height: r.height * LIFT});
    // What the icons sit against: the bubble, or for files alone the files.
    const anchorEl = shown ? bubble : el.querySelector('.message-header') || content, a = anchorEl.getBoundingClientRect();
    lifted = buildLift(el, content, c, sent);
    el.classList.add('bubble-menu-on');
    const cell = root?.closest?.('.split-cell') || root?.closest?.('.page');
    const bar = cell?.querySelector?.('.messagebar')?.getBoundingClientRect(), nav = cell?.querySelector?.('.navbar, .split-cell-bar')?.getBoundingClientRect();
    const at = g.caret || null;
    menu.value = {message: m, el, sent, at, canCopy: !!m.text, canSelect: !!m.text, canReply: canReply(), shown: false, closing: false,
      bubble: lift(a), block: lift({left: c.left, top: c.top, width: c.width, height: a.bottom - c.top}),
      floor: bar && bar.height ? bar.top : innerHeight, ceiling: nav && nav.height ? nav.bottom : 0};
    // Drawn first as it is, then eased into place: the dim, the lift and the icons together.
    requestAnimationFrame(() => requestAnimationFrame(() => { if (menu.value && !menu.value.closing) menu.value.shown = true; }));
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    document.addEventListener('keydown', onKey);
  }
  // A copy of the message drawn over the dim, exactly where the message is, so what stays
  // bright is the message itself, its tail and files included, in whatever shape the theme
  // gives it (a rounded hole in the dim never matched the masked bubble). The message itself is hidden under it until the copy has eased back.
  let lifted = null, closeTimer = 0;
  function buildLift(el, content, c, sent) {
    const box = el.getBoundingClientRect();
    const shell = document.createElement('div');
    shell.className = root?.className || 'messages message-list';
    for (const at of root?.attributes || []) if (at.name.startsWith('data-v-')) shell.setAttribute(at.name, '');
    shell.classList.add('bubble-lift-shell');
    shell.setAttribute('aria-hidden', 'true');
    Object.assign(shell.style, {position: 'fixed', inset: '0', display: 'block', minHeight: '0', margin: '0', padding: '0', background: 'none', pointerEvents: 'none', overflow: 'visible', zIndex: 'auto'});
    const copy = el.cloneNode(true);
    copy.classList.remove('bubble-menu-on', 'bubble-pressing', 'message-arrival', 'message-found', 'reply-swiping', 'reply-swipe-back');
    copy.classList.add('bubble-lift');
    copy.style.removeProperty('--reply-swipe');
    for (const x of [copy, ...copy.querySelectorAll('[id],[data-message-id]')]) { x.removeAttribute('id'); x.removeAttribute('data-message-id'); }
    copy.querySelectorAll('.reply-swipe-icon').forEach(x => x.remove());
    copy.inert = true;
    Object.assign(copy.style, {position: 'absolute', left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px', margin: '0', maxWidth: 'none', boxSizing: 'border-box'});
    const inner = copy.querySelector('.message-content');
    if (inner) inner.style.transformOrigin = `${sent ? c.width : 0}px ${c.height / 2}px`;
    shell.appendChild(copy);
    // Scrolled code blocks and tables keep their place in the copy.
    const from = el.querySelectorAll('*'), to = copy.querySelectorAll('*');
    shell.restore = () => { from.forEach((x, i) => { if ((x.scrollLeft || x.scrollTop) && to[i]) { to[i].scrollLeft = x.scrollLeft; to[i].scrollTop = x.scrollTop; } }); };
    return shell;
  }
  // The backdrop's lift layer (a function ref): the copy goes in as it mounts.
  function mountLift(layer) { if (layer && lifted && lifted.parentNode !== layer) { layer.appendChild(lifted); lifted.restore?.(); } }
  const still = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Closing eases everything back out; the actions run at once, and the page is free under it.
  function closeMenu() {
    const open = menu.value;
    if (!open || open.closing) return;
    open.closing = true; open.shown = false;
    window.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('resize', closeMenu);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('selectionchange', clearSelection);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(finish, still() ? 0 : CLOSE_MS);
  }
  function finish() {
    clearTimeout(closeTimer);
    const open = menu.value;
    if (open) open.el.classList.remove('bubble-menu-on');
    lifted?.remove(); lifted = null;
    if (open) menu.value = null;
  }
  function clearSelection() { window.getSelection?.()?.removeAllRanges?.(); }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } }
  function contextMenu(e) { if (g || (menu.value && !menu.value.closing)) e.preventDefault(); }

  // Under the bubble on its own side (right for the reader's own, left for a reply); over it
  // when there is no room between it and the composer.
  const menuStyle = computed(() => {
    const open = menu.value; if (!open) return null;
    const count = (open.canCopy ? 1 : 0) + (open.canSelect ? 1 : 0) + (open.canReply ? 1 : 0), w = count * BUTTON + (count - 1) * GAP;
    const below = open.bubble.top + open.bubble.height + MENU_GAP, above = open.block.top - MENU_GAP - BUTTON;
    const floor = open.floor - 8, ceiling = Math.max(8, open.ceiling + 8);
    const under = below + BUTTON <= floor || above < ceiling;
    const top = under ? Math.min(below, floor - BUTTON) : above;
    const x = open.sent ? open.bubble.left + open.bubble.width - w : open.bubble.left;
    return {top: Math.max(8, top) + 'px', left: Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px', '--bubble-menu-from': (under ? -6 : 6) + 'px'};
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
    closeMenu(); finish(); drop();
    root?.removeEventListener('touchstart', start);
    root?.removeEventListener('touchmove', move);
    root?.removeEventListener('touchend', end);
    root?.removeEventListener('touchcancel', drop);
    root?.removeEventListener('contextmenu', contextMenu);
  });

  return {
    menu, menuStyle, mountLift, close: closeMenu,
    copy() { const open = menu.value; if (!open || open.closing) return; closeMenu(); copy(open.message); },
    reply() { const open = menu.value; if (!open || open.closing) return; closeMenu(); reply(open.message); },
    // Select text: the menu closes and the bubble's words are
    // handed to iOS's own selection, so its handles pick the part wanted; a tap elsewhere ends
    // it. Only the word under the finger is selected to start with, not the whole bubble: from
    // a whole long message the ends are hard to reach on a phone. Where no word can be found
    // there, the whole text.
    select() {
      const open = menu.value; if (!open || open.closing) return; closeMenu();
      const el = open.el;
      setTimeout(() => {
        const text = el.querySelector('.message-text, .message-markdown');
        if (!text) return;
        el.classList.add('bubble-selecting');
        const sel = window.getSelection?.(); if (!sel) return;
        const range = open.at && text.contains(open.at.node) ? wordAround(open.at.node, open.at.offset) : null;
        const all = () => { const r = document.createRange(); r.selectNodeContents(text); return r; };
        sel.removeAllRanges(); sel.addRange(range || all());
        const end = e => { if (e && el.contains(e.target)) return; el.classList.remove('bubble-selecting'); document.removeEventListener('touchstart', end, true); document.removeEventListener('mousedown', end, true); };
        document.addEventListener('touchstart', end, true); document.addEventListener('mousedown', end, true);
      }, still() ? 0 : CLOSE_MS + 20);
    },
  };
}

// The text position at a point of the page inside `within`, or null: the browser's caret there
// (caretRangeFromPoint in Safari and Chrome, caretPositionFromPoint in Firefox).
export function caretAt(x, y, within, doc = document) {
  let node, offset;
  if (doc.caretRangeFromPoint) { const r = doc.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; offset = r.startOffset; } }
  else if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; offset = p.offset; } }
  return node && node.nodeType === 3 && within.contains(node) ? {node, offset} : null;
}
// The word around a text position, as a Range, or null. Intl.Segmenter cuts the text node into
// words, Chinese and Japanese ones too. On a space or punctuation the nearest word after it,
// else before it, so a press always starts somewhere.
export function wordAround(node, offset, doc = document) {
  const s = node.data; if (!s.trim()) return null;
  const at = Math.min(Math.max(offset, 0), s.length - 1);
  let words = [];
  try { words = [...new Intl.Segmenter(undefined, {granularity: 'word'}).segment(s)].filter(w => w.isWordLike).map(w => [w.index, w.index + w.segment.length]); } catch { /* no Segmenter */ }
  if (!words.length) words = [...s].map((ch, i) => [i, i + 1]).filter(([i]) => /\S/.test(s[i]));
  const hit = words.find(([a, b]) => at >= a && at < b) || words.find(([a]) => a > at) || words.findLast(([, b]) => b <= at);
  if (!hit) return null;
  const r = doc.createRange(); r.setStart(node, hit[0]); r.setEnd(node, hit[1]); return r;
}
