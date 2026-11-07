import { computed, ref, watch } from 'vue';
import { t } from './i18n.js';
import { api, currentUser } from './auth.js';
import { embedded } from './embed.js';

// How much of the Claude subscription is used, for an admin (the
// endpoints are admin only). Shown at the foot of the desktop
// sidebar and at the top of the Admin page; both
// read these refs, so there is one fetch and one timer however many show it. Asked of
// the server (which asks Anthropic at most every five minutes) when the first viewer
// appears, every five minutes, and when the app comes back to the front.
export const claudeUsage = ref(null);

// The split view too, since its cells have the usage view:
// only an open usage view there asks, as the split view has no sidebar.
export const usageAllowed = () => !embedded && currentUser.value?.role === 'admin';

export const usageGroups = computed(() => {
  const when = iso => { if (!iso) return ''; const d = new Date(iso), now = new Date(), hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`; };
  const errorText = (e) => t(e === 'login-expired' || e === 'no-login' ? 'usageLogin' : e === 'login-idle' ? 'usageLoginIdle' : e === 'keychain' ? 'usageKeychain' : e === 'rate-limited' ? 'usageRateLimited' : 'usageUnavailable');
  return [['claude', 'Claude', claudeUsage.value, '/sources/anthropic.svg']].filter(([, , u]) => u).map(([key, name, u, logo]) => ({
    key, name, logo, note: u.error ? errorText(u.error) : '',
    // Numbers kept while Anthropic asks us to wait (claudeUsage.js).
    stale: u.stale ? t('usageStale', { time: when(u.checkedAt) }) : '',
    // The 5-hour window above the week; only the Admin page shows it.
    meters: u.error ? [] : [['fiveHour', 'usageFiveHour'], ['sevenDay', 'usageWeekly']].filter(([k]) => u[k]).map(([k, label]) => {
      const { percent, resetsAt } = u[k];
      // The current 5-hour window's share of the week, once measured (claudeUsage.js).
      const share = k === 'sevenDay' && u.session?.share > 0 ? Math.min(percent, u.session.share) : 0;
      return { key: k, label, percent, share, resets: when(resetsAt), stale: u.stale ? t('usageStale', { time: when(u.checkedAt) }) : '', level: percent >= 90 ? 'high' : percent >= 70 ? 'mid' : 'low' };
    }),
  }));
});

// fresh: asked again now, not the server's kept answer (a pull to refresh).
export async function loadUsage({fresh = false} = {}) {
  if (!usageAllowed()) { claudeUsage.value = null; return; }
  const q = fresh ? '?fresh=1' : '';
  await api('/claude-usage' + q).then(u => { claudeUsage.value = u; }, () => {});
}

let viewers = 0, timer = null, stopUser = null;
function onVisible() { if (document.visibilityState === 'visible') void loadUsage(); }

// A place showing the usage: the first one starts the fetch and its timer, the last
// one to go stops them. Returns the function that ends this viewer.
export function watchUsage() {
  if (viewers++ === 0) {
    void loadUsage();
    stopUser = watch(currentUser, () => void loadUsage());
    timer = setInterval(() => void loadUsage(), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', onVisible);
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (--viewers === 0) { clearInterval(timer); timer = null; stopUser(); stopUser = null; document.removeEventListener('visibilitychange', onVisible); }
  };
}
