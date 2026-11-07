// An icon button's name under it while the mouse rests on it:
// the split-view cell's header and the conversation's navbar on a computer. A native title
// does not show reliably in the installed PWA window, so this draws the folded sidebar's own
// tip (App.vue sideTip, styles/skin.css .sidebar-tip) below the button after a short wait,
// kept inside the window. A mouse only: a finger's tap never shows one. v-tip="text"; the
// button keeps its aria-label.
export const TIP_DELAY_MS = 350;
let tip = null, timer = null, owner = null;

function hide() {
  clearTimeout(timer);timer = null;owner = null;
  if (tip) tip.hidden = true;
}
function show(el) {
  const text = el.__tipText;
  if (!text || !el.isConnected) return;
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'sidebar-tip hover-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  tip.textContent = text;tip.hidden = false;
  const box = el.getBoundingClientRect(), w = tip.offsetWidth, margin = 8;
  const left = Math.min(Math.max(margin, box.left + box.width / 2 - w / 2), window.innerWidth - w - margin);
  tip.style.left = left + 'px';tip.style.top = (box.bottom + 8) + 'px';
}
function enter(e) {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  const el = e.currentTarget;
  clearTimeout(timer);owner = el;
  timer = setTimeout(() => { if (owner === el) show(el); }, TIP_DELAY_MS);
}
function leave(e) { if (owner === e.currentTarget || !owner) hide(); }

export const tipDirective = {
  mounted(el, binding) {
    el.__tipText = binding.value;
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    // A click opens or closes something: the name goes, and does not come back until the
    // mouse comes in again.
    el.addEventListener('pointerdown', hide);
  },
  updated(el, binding) {
    el.__tipText = binding.value;
    if (owner === el && tip && !tip.hidden) tip.textContent = binding.value || '';
  },
  beforeUnmount(el) {
    el.removeEventListener('pointerenter', enter);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('pointerdown', hide);
    if (owner === el) hide();
  },
};
