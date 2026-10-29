<template>
  <!-- First-entry install gate -->
  <InstallScreen
    v-if="entry === 'install'"
    @use-in-browser="useInBrowser"
    @dev-mode="enterMain"
  />

  <f7-app v-else v-bind="f7params" :dark="theme==='dark'">
    <!-- Auth gate: everything behind login -->
    <f7-login-screen :opened="!authLoading && !currentUser" :animate="false">
      <login-page></login-page>
    </f7-login-screen>

    <f7-view v-if="authLoading" main>
      <!-- The same dark start page the Agents tab opens on (StartPage.vue): the app
           always opens here, then goes to sign-in, the list or a conversation. -->
      <f7-page name="start" :page-content="false">
        <div class="start-page__wait"><f7-preloader :size="28"/></div>
      </f7-page>
    </f7-view>

    <template v-if="!authLoading && currentUser">
      <!-- The admin's split view: a grid of conversations, each in its own cell. -->
      <SplitView v-if="splitView"/>
      <template v-else>
      <!-- Desktop left panel: logo + selected-pill menu -->
      <f7-panel v-if="!embedded" left cover :visible-breakpoint="1024">
        <div class="view" @mouseenter="peekSidebar(true)" @mouseleave="peekSidebar(false)">
          <div class="page page-current">
            <div class="page-content">
              <div class="panel-logo" style="padding-top: 8vh; text-align: center;">
                <img class="panel-logo-img" src="/agent-symbol-256.png" alt="CC Agent" style="width: 56px; height: 56px;" />
              </div>
              <div class="list menu-list no-hairlines">
                <ul>
                  <li v-for="tb in tabs" :key="tb.id">
                    <a
                      class="item-link tab-link"
                      :class="{ 'item-selected': active === tb.id }"
                      href="#"
                      :data-tab="'#' + tb.id"
                      @click="selectTab(tb.id)"
                      @mouseenter="showSideTip($event, t(tb.labelKey))"
                      @mouseleave="sideTip = null"
                    >
                      <div class="item-content">
                        <div class="item-media">
                          <i class="icon left-panel__menu-icon" :class="tb.iconClass">{{ tb.icon }}</i>
                          <span v-if="tb.id === 'view-chat' && unreadTotal" class="menu-unread-dot"></span>
                        </div>
                        <div class="item-inner">
                          <div class="item-title">{{ t(tb.labelKey) }}</div>
                          <div v-if="tb.id === 'view-chat' && unreadTotal" class="item-after"><span class="badge color-red menu-unread">{{ unreadLabel(unreadTotal) }}</span></div>
                        </div>
                      </div>
                    </a>
                  </li>
                </ul>
              </div>
              <div class="panel-foot">
              <!-- How much of the Claude subscription is used, for the admin; the Admin page shows the same at its top. -->
              <UsageMeters v-if="desktop" :compact="sidebarNarrow"/>
              <!-- A new build waits here on a computer instead of interrupting with a
                   dialog; a tap offers it as before. -->
              <div v-if="newBuild" class="list menu-list no-hairlines panel-update">
                <ul>
                  <li>
                    <a class="item-link" href="#" @click.prevent="offerNewVersion" @mouseenter="showSideTip($event, t('updateAvailableTitle'))" @mouseleave="sideTip = null">
                      <div class="item-content">
                        <div class="item-media"><i class="icon f7-icons left-panel__menu-icon">arrow_down_circle_fill</i></div>
                        <div class="item-inner"><div class="item-title">{{ t('updateAvailableTitle') }}</div></div>
                      </div>
                    </a>
                  </li>
                </ul>
              </div>
              </div>
            </div>
          </div>
        </div>
      </f7-panel>
      <!-- The handle that folds and unfolds it, on the line between it and the page,
           shown only while the mouse is near that line.
           Outside the panel: WebKit filled the part of the panel's layer that a child
           reached past its edge with the panel's colour and stale pixels (a strip
           beside it). -->
      <div v-if="desktop && !embedded && !sidebarAuto" class="sidebar-edge">
        <button type="button" class="sidebar-handle" :aria-label="sidebarFolded ? ct('展開選單') : ct('收合選單')" :title="sidebarFolded ? ct('展開選單') : ct('收合選單')" @click="setSidebarFolded(!sidebarFolded)"><i class="icon f7-icons">{{ sidebarFolded ? 'chevron_right' : 'chevron_left' }}</i></button>
      </div>
      <div v-if="sideTip && sidebarNarrow" class="sidebar-tip" :style="{ top: sideTip.top + 'px', left: sideTip.left + 'px' }">{{ sideTip.text }}</div>

      <!-- Main: 3 tab views + segmented bottom tabbar -->
      <f7-views tabs class="safe-areas">
        <!-- A phone held sideways: a rail of its own on the right, with the same tabs; the
             bottom bar below stays exactly as it is, only hidden there, so turning upright
             gives it back untouched. -->
        <nav v-show="!embedded&&!(active==='view-chat' && (workspace.selected.value||workspace.atStart.value))&&!(active==='view-groups' && viewingGroup)" ref="railRef" class="landscape-rail" @pointerdown="railDown" @pointermove="railMove" @pointerup="railUp" @pointercancel="railCancel">
          <a v-for="tb in tabs" :key="tb.id" class="landscape-rail-tab" :class="{ active: (railHover || active) === tb.id }" :data-rail-tab="tb.id" href="#" :aria-label="t(tb.labelKey)" @click.prevent>
            <i class="icon" :class="tb.iconClass">{{ tb.icon }}</i>
            <span v-if="tb.id === 'view-chat' && unreadTotal" class="badge color-red rail-unread">{{ unreadLabel(unreadTotal) }}</span>
          </a>
        </nav>
        <div v-show="!embedded&&!(active==='view-chat' && (workspace.selected.value||workspace.atStart.value))&&!(active==='view-groups' && viewingGroup)" class="toolbar-layout-wrapper toolbar-menu">
          <div class="toolbar-views__toolbar-sticky__bg"></div>
          <div class="toolbar-views__toolbar-sticky__gradient-bg"></div>
          <div
            ref="segRef"
            class="segmented segmented-strong toolbar-views-ui__segmented-toolbar toolbar-menu"
          >
            <a
              v-for="tb in tabs"
              :key="tb.id"
              class="button tab-link"
              :class="{ 'tab-link-active': active === tb.id }"
              href="#"
              :data-tab="'#' + tb.id"
              @click="selectTab(tb.id)"
            >
              <i class="icon" :class="tb.iconClass">{{ tb.icon }}</i>
              <span v-if="tb.id === 'view-chat' && unreadTotal" class="badge color-red tab-unread">{{ unreadLabel(unreadTotal) }}</span>
              <span class="tabbar-label">{{ t(tb.labelKey) }}</span>
            </a>
            <span class="segmented-highlight"></span>
          </div>
        </div>

        <f7-view id="view-chat" main tab :tab-active="active === 'view-chat'" url="/start/" />
        <!-- A conversation opened by a notification: the list under it is not shown first. -->
        <div v-if="workspace.directOpening.value && active === 'view-chat'" class="direct-cover" aria-hidden="true"><f7-preloader :size="28"/></div>
        <f7-view v-if="isAdmin" id="view-groups" tab :tab-active="active === 'view-groups'" url="/groups/" />
        <f7-view id="view-schedules" tab :tab-active="active === 'view-schedules'" url="/schedules/" />
        <f7-view id="view-settings" tab :tab-active="active === 'view-settings'" url="/settings/" />
        <f7-view v-if="isAdmin" id="view-admin" tab :tab-active="active === 'view-admin'" url="/admin/" />
      </f7-views>
      </template>
    </template>
    <AgentOverlays v-if="currentUser"/>
  </f7-app>
</template>

<script setup>
import { provide, ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { f7 } from 'framework7-vue';
import routes from './routes.js';
import InstallScreen from './components/InstallScreen.vue';
import LoginPage from './pages/LoginPage.vue';
import { t } from './js/i18n.js';
import { api, authLoading, currentUser, verifyAuth, signedInByQr } from './js/auth.js';
import { createPresenceHeartbeat } from './js/presence-heartbeat.js';
import { resubscribeIfRotated, setPushAccount } from './js/push.js';
import { activeTab, setActiveTab } from './js/tab-session.js';
import { addressFor, screenFor } from './js/appUrl.js';
import { viewingGroup } from './js/groups.js';
import { scheduleFocus } from './js/schedules.js';
import {useTheme} from './theme.js';
const {theme,applyTheme}=useTheme();
import {useAgentChat} from './js/agent-chat.js';
import AgentOverlays from './components/AgentOverlays.vue';
const workspace=useAgentChat();provide('workspace',workspace);
const {unreadTotal,unreadLabel}=workspace;
import { resolveTabTap } from './tabNavigation.js';
import { startVersionChecks } from './versionCheck.js';
import { onServedBuild } from './js/live-connection.js';
import { embedded, splitView } from './js/embed.js';
import { updateDialog } from './js/updatePrompt.js';
import SplitView from './components/SplitView.vue';
import UsageMeters from './components/UsageMeters.vue';
import { ct } from './js/agent-i18n.js';
import { sidebarFolded, sidebarAuto, sidebarRail, sidebarNarrow, setSidebarFolded, peekSidebar } from './js/sidebarState.js';
import { forceAppUpdate } from './js/pwa-update.js';

const ls = (k) => {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
};
const setLs = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch (e) {
    /* ignore */
  }
};

// First-entry gating.
function computeEntry() {
  const standalone =
    (typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone === true);
  const notifDecided = ls('notificationsEnabled') === 'true' || !!ls('notificationsDisabled');
  if (ls('dev_mode') || notifDecided || standalone || embedded || splitView) return 'main';
  if (ls('in_browser') === '1') return 'main';
  return 'install';
}

const entry = ref(computeEntry());

function enterMain() {
  entry.value = 'main';
}

function useInBrowser() {
  setLs('in_browser', '1');
  entry.value = 'main';
}

// Agents, schedules, the admin's own tab (what only
// an admin sets moved out of Settings), settings.
const ALL_TABS = [
  { id: 'view-chat', labelKey: 'tabChat', icon: 'chat_bubble_2_fill', iconClass: 'f7-icons' },
  // Group chats, beside Agents and apart from them, an admin's.
  { id: 'view-groups', labelKey: 'tabGroups', icon: 'person_3_fill', iconClass: 'f7-icons', admin: true },
  { id: 'view-schedules', labelKey: 'tabSchedules', icon: 'calendar', iconClass: 'f7-icons' },
  { id: 'view-settings', labelKey: 'tabSettings', icon: 'gear_alt_fill', iconClass: 'f7-icons' },
  // After Settings.
  { id: 'view-admin', labelKey: 'tabAdmin', icon: 'shield_lefthalf_fill', iconClass: 'f7-icons', admin: true },
];
const isAdmin = computed(() => currentUser.value?.role === 'admin');
// Signed in or out in another tab of this site: every other open page follows at once,
// told through a BroadcastChannel; and a page showing the sign-in asks again when it
// comes back into view (sign-in and sign-out stay in sync without a reload).
const authChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('cc-agent-auth') : null;
let lastSaid = undefined;
watch(() => currentUser.value?.id || null, (id) => {
  if (authLoading.value || id === lastSaid) return;
  const first = lastSaid === undefined;
  lastSaid = id;
  if (!first) try { authChannel?.postMessage({ signedIn: !!id }); } catch {}
});
async function askWhoIAm() {
  try { const r = await api('/auth/verify'); if (r?.user && !currentUser.value) signedInByQr(r.user); else if (!r?.user && currentUser.value) verifyAuth(); }
  catch { if (currentUser.value) verifyAuth(); }
}
if (authChannel) authChannel.onmessage = (e) => { if (!!e.data?.signedIn !== !!currentUser.value) askWhoIAm(); };
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !currentUser.value && !authLoading.value) askWhoIAm(); });
const tabs = computed(() => ALL_TABS.filter((tb) => !tb.admin || isAdmin.value));

// Shared across pages so navigation never leaves the App-level highlight behind.
const active = activeTab;
const segRef = ref(null);
// The sideways rail: a tap picks a tab; a finger sliding along it lights the tab under it
// and picks that one when lifted, as the bottom bar's own swipe does.
const railRef = ref(null), railHover = ref('');
let railPress = null;
const railTabAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-rail-tab]')?.dataset.railTab || '';
// The page follows the finger as it slides, as it does on the bottom bar; a tap without sliding acts as a tap on the bar does.
function railDown(e) { railPress = { id: e.pointerId, from: railTabAt(e), slid: false };try { railRef.value?.setPointerCapture(e.pointerId); } catch {} railHover.value = railPress.from; }
function railMove(e) {
  if (railPress?.id !== e.pointerId) return;
  const id = railTabAt(e);if (!id || id === railHover.value) return;
  railHover.value = id;railPress.slid = true;
  if (id !== active.value) setActiveTab(id);
}
function railUp(e) {
  if (railPress?.id !== e.pointerId) return;
  const id = railTabAt(e) || railHover.value, slid = railPress.slid;railPress = null;railHover.value = '';
  if (!id) return;
  if (!slid) selectTab(id);else if (id !== active.value) setActiveTab(id);
}
function railCancel() { railPress = null;railHover.value = ''; }
// Turned around, iOS can leave the page scrolled a little or the bottom bar's touch area
// where it was before the turn: it looks right but takes no taps. After each turn the page is put back to the top and the bar laid out
// afresh, twice, as the turn settles.
// iOS (a home-screen app) can come out of a turn drawing the page below the status bar
// while telling it the top inset is 0, so every tap lands one row off. Setting the viewport again makes it
// work the insets out afresh.
function reapplyViewport() {
  const meta = document.querySelector('meta[name="viewport"]');if (!meta) return;
  const content = meta.getAttribute('content') || '';
  meta.setAttribute('content', content.replace(/,?\s*viewport-fit=cover/, ''));
  requestAnimationFrame(() => meta.setAttribute('content', content));
}
function settleAfterTurn() {
  try { window.scrollTo(0, 0);document.documentElement.scrollTop = 0;document.body.scrollTop = 0; } catch {}
  const bar = document.querySelector('.toolbar-layout-wrapper');
  if (bar) { const was = bar.style.display;bar.style.display = 'none';void bar.offsetHeight;bar.style.display = was; }
  positionHighlight();
  // What sizes itself to the screen (the app's frame, a conversation's composer) is told
  // again once the turn has settled: iOS can send its resize before the new size is known.
  try { window.dispatchEvent(new Event('resize'));window.visualViewport?.dispatchEvent(new Event('resize')); } catch {}
}
if (typeof window !== 'undefined') {
  let lastShape = window.innerWidth > window.innerHeight;
  const turned = () => { const shape = window.innerWidth > window.innerHeight;if (shape === lastShape) return;lastShape = shape;setTimeout(reapplyViewport, 250);setTimeout(settleAfterTurn, 120);setTimeout(settleAfterTurn, 700); };
  window.addEventListener('orientationchange', turned);
  window.addEventListener('resize', turned);
}
const presenceHeartbeat = createPresenceHeartbeat({
  ping: () => api('/auth/me'),
});

// Someone who is not an admin never stays on the Admin tab, whether it was remembered
// from an admin's session in this browser or named by an address.
watch([currentUser, activeTab], ([user, tab]) => {
  if (user && (tab === 'view-admin' || tab === 'view-groups') && user.role !== 'admin') setActiveTab('view-chat');
}, { immediate: true });

watch(currentUser, (user) => {
  if (user) presenceHeartbeat.start();
  else presenceHeartbeat.stop();
}, { immediate: true });
// Silent VAPID resubscribe-on-rotation: best-effort, never awaited, errors
// are swallowed inside. Run once it is known who is signed in, and again when that
// changes: the repair is only for the account that turned notifications on in this
// browser (src/js/push.js). A split-view cell is one of several copies of the app on
// the page and leaves this to the page itself.
watch(() => currentUser.value?.id || '', (id) => {
  setPushAccount(id);
  if (id && !embedded) resubscribeIfRotated();
}, { immediate: true });

// Every screen has an address, and an address opens its screen (src/js/appUrl.js),
// swapped with replaceState only: the app never adds a history entry. An address
// naming a screen is opened once someone is signed in and that tab's view exists —
// a scope-report notification's /?access-report=<id> among them — and an admin's
// page only for an admin. Conversation addresses are the chat tab's own
// (agent-chat.js).
let pendingScreen = typeof window !== 'undefined' ? screenFor(window.location.href) : null;
if (pendingScreen) setActiveTab(pendingScreen.tab);
function whenRouter(tab, run, tries = 0) {
  const router = f7?.views?.get('#' + tab)?.router;
  if (router) run(router);
  else if (tries < 50) setTimeout(() => whenRouter(tab, run, tries + 1), 100);
}
const boundRouters = new WeakSet();
function syncAddress() {
  if (typeof window === 'undefined' || !currentUser.value) return;
  for (const tab of tabs.value) {
    const router = f7?.views?.get('#' + tab.id)?.router;
    if (router && !boundRouters.has(router)) {
      boundRouters.add(router);
      router.on('routeChanged', () => nextTick(syncAddress));
    }
  }
  const route = f7?.views?.get('#' + activeTab.value)?.router?.currentRoute;
  // The start page keeps the address it opened with: it may name a conversation.
  if (!route || route.path === '/start/') return;
  const next = addressFor({ tab: activeTab.value, route, conversationId: workspace.selected.value });
  if (window.location.pathname + window.location.search !== next) window.history.replaceState(window.history.state, '', next);
}
watch([activeTab, () => workspace.selected.value, () => workspace.atStart.value], () => nextTick(syncAddress));
watch(currentUser, (user) => {
  if (!user) return;
  const screen = pendingScreen;
  pendingScreen = null;
  const stack = screen && !(screen.admin && user.role !== 'admin') ? screen.stack : [];
  if (screen) setActiveTab((screen.tab === 'view-admin' || screen.tab === 'view-groups') && user.role !== 'admin' ? 'view-chat' : screen.tab);
  // The page opens the schedule a proposal's notification named once it has it.
  if (screen?.schedule) scheduleFocus.value = screen.schedule;
  nextTick(() => whenRouter(activeTab.value, async (router) => {
    // One page at a time: F7 drops a navigation asked for while the previous one is
    // still being put in place, which left a deep link one page short.
    const settled = async (path) => {
      for (let n = 0; n < 80 && !(router.allowPageChange && router.currentRoute?.path === path); n++) await new Promise((r) => setTimeout(r, 25));
    };
    for (const url of stack) {
      await settled(router.currentRoute?.path);
      router.navigate(url, { animate: false });
      await settled(url.split('?')[0]);
    }
    syncAddress();
  }));
}, { immediate: true });

onUnmounted(() => {
  presenceHeartbeat.stop();
  versionChecks?.stop();
  stopServedBuild?.();
  desktopQuery?.removeEventListener?.('change', onDesktopChange);
});

function positionHighlight() {
  const seg = segRef.value;
  if (!seg) return;
  const hl = seg.querySelector('.segmented-highlight');
  if (!hl) return;
  const idx = tabs.value.findIndex((tb) => tb.id === active.value);
  hl.style.width = '';
  hl.style.transform = '';
  hl.style.setProperty('--f7-segmented-highlight-active', String(idx < 0 ? 0 : idx));
}

function selectTab(id) {
  // Re-tapping the current tab acts as a back button for that tab's own stack.
  // That is a navigation inside the tab, not a tab switch: the persisted active
  // tab and the chat session must be left exactly as they are.
  const router = f7?.views?.get(`#${id}`)?.router;
  const action = resolveTabTap({
    tappedId: id,
    activeId: active.value,
    historyLength: router?.history?.length ?? 0,
  });
  if (action === 'back') {
    router.back();
    return;
  }
  if (action === 'top') {
    // The page shown in that tab, scrolled to its top; nothing else changes.
    const content = document.querySelector(`#${id} .page-current .page-content`);
    content?.scrollTo?.({ top: 0, behavior: 'smooth' });
    return;
  }
  setActiveTab(id);
}

// The service worker fetches a new build in the background; this is what tells
// the user it exists and lets them choose when to take it, instead of a version
// swapping under them mid-task.
let versionChecks = null;
// The build waiting to be taken, shown at the foot of the desktop sidebar.
const newBuild = ref(null);
const DESKTOP = '(min-width: 1024px)';
// The usage meters at the foot of the sidebar, only where the sidebar shows.
const desktopQuery = typeof window !== 'undefined' ? window.matchMedia?.(DESKTOP) : null;
const desktop = ref(!!desktopQuery?.matches);
function onDesktopChange() { desktop.value = !!desktopQuery?.matches; }
desktopQuery?.addEventListener?.('change', onDesktopChange);
// The folded sidebar: the page keeps the rail's room (sidebar-rail), the sidebar shows
// icons only (sidebar-narrow); classes on <html>, read by styles/skin.css.
watch([sidebarRail, sidebarNarrow], ([rail, narrow]) => {
  document.documentElement.classList.toggle('sidebar-rail', rail);
  document.documentElement.classList.toggle('sidebar-narrow', narrow);
}, { immediate: true });
// A folded item's name beside it while the mouse is on it.
const sideTip = ref(null);
function showSideTip(event, text) {
  if (!sidebarNarrow.value) return;
  const box = event.currentTarget.getBoundingClientRect();
  sideTip.value = { text, top: box.top + box.height / 2, left: box.right + 10 };
}
function offerNewVersion() {
  f7.dialog.confirm(
    t('updateAvailableText', { current: __BUILD_ID__, latest: newBuild.value }),
    t('updateAvailableTitle'),
    () => void applyNewVersion(),
  );
}

async function applyNewVersion() {
  const progress = f7.dialog.preloader(t('forceUpdateChecking'));
  await forceAppUpdate({
    onPhase(phase) {
      if (phase === 'applying') progress.setText(t('forceUpdateApplying'));
      if (phase === 'reloading') progress.setText(t('forceUpdateReloading'));
    },
  });
}

function announceNewVersion(latestBuildId, { afterFailedUpdate } = {}) {
  const params = { current: __BUILD_ID__, latest: latestBuildId };
  if (afterFailedUpdate) {
    // Repeating the normal prompt here would loop the user through the same
    // silent failure, leaving them convinced they are up to date when they are
    // not. Name the failure and give the manual way out instead.
    f7.dialog.alert(t('updateFailedText', params), t('updateFailedTitle'));
    return;
  }
  // A computer, where the sidebar shows, gets the quiet marker, and the dialog too
  // only if Settings asks for it; a phone always gets the dialog.
  if (!embedded && !splitView && window.matchMedia?.(DESKTOP).matches) {
    newBuild.value = latestBuildId;
    if (!updateDialog.value) return;
  }
  f7.dialog.confirm(
    t('updateAvailableText', params),
    t('updateAvailableTitle'),
    () => void applyNewVersion(),
  );
}

// theme classes (ios + dark + white accent)
function applyThemeClasses() { applyTheme(theme.value); }
if (typeof document !== 'undefined') applyThemeClasses();

onMounted(() => {
  applyThemeClasses();
  nextTick(positionHighlight);
  verifyAuth();
  // A split-view cell is one of several copies of the app on the page: the split
  // view itself checks for updates, not each of its cells.
  if (embedded) return;
  versionChecks = startVersionChecks({
    currentBuildId: __BUILD_ID__,
    onNewVersion: announceNewVersion,
  });
  // The live socket names the build being served as soon as it changes
  // (js/live-connection.js); a different one is checked and offered the usual way.
  stopServedBuild = onServedBuild((buildId) => {
    if (buildId !== __BUILD_ID__) void versionChecks?.checkNow();
  });
});
let stopServedBuild = null;

watch(entry, () => {
  nextTick(() => {
    applyThemeClasses();
    positionHighlight();
  });
});

watch([active, tabs], () => nextTick(positionHighlight));
if (typeof window !== 'undefined') window.addEventListener('resize', () => nextTick(positionHighlight));

const f7params = {
  name: 'CC Agent',
  theme: 'ios',
  darkMode: false,
  // full stock palette restated — the colors param REPLACES F7's defaults 
  colors: {
    primary: '#ffffff',
    red: '#ff3b30',
    green: '#4cd964',
    blue: '#2196f3',
    pink: '#ff2d55',
    yellow: '#ffcc00',
    orange: '#ff9500',
    purple: '#9c27b0',
    deeppurple: '#673ab7',
    lightblue: '#5ac8fa',
    teal: '#009688',
    lime: '#cddc39',
    deeporange: '#ff6b22',
    gray: '#8e8e93',
    white: '#ffffff',
    black: '#000000',
  },
  routes,
  // Framework7's lit, enlarged press on the composer is left out: it moved the text
  // and its caret away from where they are, and could stay on after the keyboard
  // opened. The rest keep it.
  touch: {
    touchHighlightElements: '.toolbar-pane, .navbar .left, .navbar .right, .actions-group:not(.actions-grid .actions-group), .searchbar-input-wrap, .searchbar-disable-button, .subnavbar, .searchbar-input-wrap .autocomplete-dropdown, .notification, .toast, .fab > a',
  },
};
</script>

<style scoped>
.direct-cover {position:absolute;inset:0;z-index:6000;display:flex;align-items:center;justify-content:center;background:var(--cc-color-page,#121212);}
.panel-foot {position:absolute;left:0;right:0;bottom:calc(16px + var(--f7-safe-area-bottom, 0px));}
.panel-update {margin:0;}
/* The Agents tab's unread count: beside the title on a computer,
   on the icon's corner on a phone, low enough that the rounded tab does not cut its top off. */
.tab-link { position: relative; overflow: visible; }
.tab-unread { position: absolute; top: 7px; left: calc(50% + 3px); min-width: 18px; height: 18px; font-size: 11px; padding: 0 5px; pointer-events: none; }
/* The new-version icon stays white like the rest of the sidebar. */
.loading-block {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8e8e93;
}
</style>
