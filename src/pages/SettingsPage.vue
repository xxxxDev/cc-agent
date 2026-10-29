<template>
  <f7-page name="settings" class="page-large-static">
    <f7-navbar large :title="t('tabSettings')" />

    <!-- Grouped as Agent, System and Account. -->
    <f7-block-title>{{ t('sectionAgent') }}</f7-block-title>
    <f7-list inset class="cc-settings-list">
      <f7-list-item :title="ct('Agents 自動排序')" class="auto-sort"><template #media><f7-icon f7="arrow_up_arrow_down"/></template><template #after><label class="toggle"><input type="checkbox" :aria-label="ct('Agents 自動排序')" :checked="autoSort" @change="saveAutoSort($event.target.checked)"/><span class="toggle-icon"></span></label></template></f7-list-item>
    </f7-list>

    <f7-block-title>{{ t('sectionSystem') }}</f7-block-title>
    <f7-list inset class="cc-settings-list">
      <!-- Notifications; while they are on, a small test button sits left of the switch
           inside the same row, so the switch keeps the other rows' line. -->
      <li class="push-row">
        <div class="item-content">
          <div class="item-media"><i class="icon f7-icons">bell_fill</i></div>
          <div class="item-inner">
            <div class="item-title">{{ t('pushNotifications') }}</div>
            <div class="item-after">
              <a v-if="pushEnabled" href="#" class="push-test" :class="{ disabled: pushBusy }" :aria-label="t('sendTestPush')" @click.prevent="onSendTestPush"><i class="icon f7-icons">play_circle</i><span>{{ t('testPushPill') }}</span></a>
              <label class="toggle">
                <input
                  type="checkbox"
                  :aria-label="t('pushNotifications')"
                  :checked="pushEnabled"
                  :disabled="pushBusy || (!pushAvailable && !pushEnabled)"
                  @change="onPushToggle"
                />
                <span class="toggle-icon"></span>
              </label>
            </div>
          </div>
        </div>
      </li>
      <f7-list-item link no-chevron :title="t('panelLanguage')" :after="language==='zh-TW'?'中文':'English'" @click.prevent="openDropdown($event)"><template #media><f7-icon f7="globe"/></template></f7-list-item>
      <f7-list-item :title="ct('深色模式')">
        <template #media><f7-icon f7="moon_fill"/></template><template #after><label class="toggle"><input type="checkbox" :aria-label="ct('深色模式')" :checked="theme==='dark'" @change="setTheme($event.target.checked?'dark':'light')"/><span class="toggle-icon"></span></label></template>
      </f7-list-item>
      <!-- The computer's menu kept folded, opening while the mouse is on it;
           a computer only, kept on each device. -->
      <f7-list-item v-if="desktop" :title="ct('自動收合電腦版選單')" :footer="ct('選單平常收成一排圖示，滑鼠移上去才展開，移開就收回。只影響這台裝置。')" class="sidebar-auto">
        <template #media><f7-icon f7="sidebar_left"/></template><template #after><label class="toggle"><input type="checkbox" :aria-label="ct('自動收合電腦版選單')" :checked="sidebarAuto" @change="setSidebarAuto($event.target.checked)"/><span class="toggle-icon"></span></label></template>
      </f7-list-item>
      <f7-list-item :title="ct('版本更新提示')" class="update-dialog"><template #media><f7-icon f7="arrow_down_circle"/></template><template #after><label class="toggle"><input type="checkbox" :aria-label="ct('版本更新提示')" :checked="updateDialog" @change="setUpdateDialog($event.target.checked)"/><span class="toggle-icon"></span></label></template></f7-list-item>
      <f7-list-item link :title="t('checkForUpdate')" class="check-update" @click.prevent="checkForUpdate">
        <template #media><f7-icon f7="arrow_2_circlepath" /></template>
      </f7-list-item>
    </f7-list>
    <f7-block-footer v-if="pushProblemHint" class="mode-hint">{{ pushProblemHint }}</f7-block-footer>

    <f7-block-title>{{ t('sectionAccount') }}</f7-block-title>
    <f7-list inset class="cc-settings-list">
      <f7-list-item :title="currentUser?.name || currentUser?.username" :after="currentUser?.role">
        <template #media><f7-icon f7="person_crop_circle" /></template>
      </f7-list-item>
      <f7-list-item link no-chevron :title="t('displayName')" :after="currentUser?.name" @click.prevent="editName">
        <template #media><f7-icon f7="pencil" /></template>
      </f7-list-item>
      <f7-list-item v-if="handheld" link :title="ct('掃碼登入')" class="scan-login-row" @click.prevent="goScanLogin"><template #media><f7-icon f7="qrcode_viewfinder" /></template></f7-list-item>
      <f7-list-item link :title="ct('裝置')" class="devices-row" @click.prevent="goDevices"><template #media><f7-icon f7="device_phone_portrait" /></template></f7-list-item>
      <f7-list-item link :title="ct('通行密鑰')" class="passkeys-row" @click.prevent="goPasskeys"><template #media><f7-icon f7="checkmark_shield" /></template></f7-list-item>
      <f7-list-item link :title="ct('兩步驟驗證')" :after="currentUser?.twoStep ? ct('已開啟') : ct('未開啟')" class="two-step-row" @click.prevent="goTwoStep"><template #media><f7-icon f7="lock_shield" /></template></f7-list-item>
      <f7-list-item link :title="t('changePassword')" @click.prevent="goChangePassword">
        <template #media><f7-icon f7="lock" /></template>
      </f7-list-item>
      <f7-list-item link no-chevron :title="t('logout')" class="logout-row" @click.prevent="doLogout">
        <template #media><f7-icon f7="square_arrow_right" style="color: #ff3b30;" /></template>
      </f7-list-item>
    </f7-list>

    <!-- anchored glass dropdown -->
    <GlassDropdown
      :open="dropdownOpen"
      :point="dropdownPoint"
      :items="dropdownItems"
      :selected="language"
      @close="dropdownOpen = false"
      @select="onDropdownSelect"
    />

    <!-- What only an admin sets is on the Admin tab (AdminPage.vue). -->
    <f7-block-footer class="text-align-center" style="margin-top: 35px;">{{ PRODUCT.name }} © 2026 · {{ buildId }}</f7-block-footer>
  </f7-page>
</template>

<script setup>
import {ct} from '../js/agent-i18n.js';
import { PRODUCT } from '../js/productConfig.js';
import {useTheme} from '../theme.js';
const {theme,setTheme}=useTheme();
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { f7 } from 'framework7-vue';
import { t, lang, setLang } from '../js/i18n.js';
import { currentUser, updateCurrentUser, logout } from '../js/auth.js';
import {
  loadPushState,
  enablePush,
  disablePush,
  sendTestPush,
  resubscribeIfRotated,
  setPushAccount,
} from '../js/push.js';
import { forceAppUpdate } from '../js/pwa-update.js';
import { isHandheld } from '../js/qrLogin.js';
import { updateDialog, setUpdateDialog } from '../js/updatePrompt.js';
import { sidebarAuto, setSidebarAuto } from '../js/sidebarState.js';
// The menu setting is for the computer's layout only (App.vue's breakpoint).
const desktopQuery = typeof window !== 'undefined' ? window.matchMedia?.('(min-width: 1024px)') : null;
const desktop = ref(!!desktopQuery?.matches);
const onDesktopChange = () => { desktop.value = !!desktopQuery?.matches; };
desktopQuery?.addEventListener?.('change', onDesktopChange);
onBeforeUnmount(() => desktopQuery?.removeEventListener?.('change', onDesktopChange));
import { fetchLatestBuildId, hasNewVersion } from '../versionCheck.js';
import GlassDropdown from '../components/GlassDropdown.vue';

import {autoSort,loadListPreferences,saveListPreferences} from '../js/agentPreferences.js';
onMounted(async()=>{try{await loadListPreferences();}catch{}});
// Whether one's own Agents list puts the latest conversation first; off by default.
async function saveAutoSort(on){
  const previous=autoSort.value;
  autoSort.value=on;
  try{await saveListPreferences({autoSort:on});toast(t('settingsSaved'));}
  catch(e){autoSort.value=previous;f7.dialog.alert(e.message||t('settingsFailed'));}
}
// Vite injects __BUILD_ID__, a Git description (vite.config.js); the footer shows it
// so a running build can be confirmed at a glance without DevTools.
const buildId = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const language = ref(currentUser.value?.language || lang.value);

// anchored dropdown for the language
const dropdownOpen = ref(false);
const dropdownPoint = ref({ clientX: 0, clientY: 0 });
const dropdownItems = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '中文' },
];

const pushBusy = ref(true);
// A toggle or a test in hand: the page's own first release of the switch (below)
// and a background look at the state must not free it, or put an older state on it,
// half-way through one. The operation releases it itself.
// `pushOperations` counts their starts and their ends, so a background look begun
// before one, or while one ran, is dropped when it ends later (one begun during a toggle put the state from before it back).
let pushWorking = false;
let pushOperations = 0;
const pushDone = () => { pushWorking = false;pushOperations += 1;pushBusy.value = false; };
const pushAvailable = ref(false);
const pushSupportedHere = ref(true);
const pushWorkerReady = ref(false);
const pushEnabled = ref(false);
// All notification categories are on whenever push is enabled: the master toggle means "receive every category", so there are
// no per-category switches to render here.
// Footer only surfaces real problems (unsupported browser, missing worker,
// server not configured). The normal enabled/disabled states speak for
// themselves through the toggle.
const pushProblemHint = computed(() => {
  if (!pushSupportedHere.value) return t('pushUnsupported');
  if (!pushWorkerReady.value) return t('pushInstallRequired');
  if (!pushAvailable.value && !pushEnabled.value) return t('pushUnavailable');
  return '';
});

function applyPushState(state) {
  pushSupportedHere.value = state.supported;
  pushWorkerReady.value = state.serviceWorkerReady;
  pushAvailable.value = state.available;
  pushEnabled.value = state.enabled;
}

async function refreshPushState({ quiet = false, background = false } = {}) {
  const begun = pushOperations;
  const stale = () => background && (pushWorking || begun !== pushOperations);
  try {
    const state = await loadPushState();
    if (stale()) return;
    applyPushState(state);
  } catch (error) {
    if (stale()) return;
    pushAvailable.value = false;
    if (!quiet) throw error;
  }
}

function openDropdown(event) {
  dropdownPoint.value = { clientX: event?.clientX ?? 0, clientY: event?.clientY ?? 0 };
  dropdownOpen.value = true;
}

async function onDropdownSelect(value) {
  if (value === language.value) return;
  language.value = value;
  await saveLanguage();
}

watch(
  currentUser,
  (user) => {
    language.value = user?.language || lang.value;
  },
  { immediate: true },
);

const toast = (text) => f7.toast.create({ text, closeTimeout: 1800 }).open();

async function saveLanguage() {
  try {
    await updateCurrentUser({ language: language.value });
    setLang(language.value);
    toast(t('settingsSaved'));
  } catch (err) {
    f7.dialog.alert(err.message || t('settingsFailed'));
  }
}

function pushFailureMessage(error, enabling) {
  if (error?.code === 'PUSH_PERMISSION_DENIED') return t('pushPermissionDenied');
  if (error?.code === 'PUSH_NOT_CONFIGURED') return t('pushUnavailable');
  if (error?.code === 'PUSH_WORKER_UNAVAILABLE') return t('pushInstallRequired');
  if (error?.code === 'PUSH_UNSUPPORTED') return t('pushUnsupported');
  if (error?.code === 'PUSH_TOGGLE_TIMEOUT') return error.message;
  // An unrecognised failure is usually the browser's own (iOS reports
  // AbortError / InvalidStateError from subscribe()). Showing it is the only
  // way to tell those apart on a phone with no console.
  const detail = [error?.name, error?.message].filter(Boolean).join(': ').slice(0, 200);
  const base = enabling ? t('pushEnableFailed') : t('pushDisableFailed');
  return detail ? `${base}\n${detail}` : base;
}

// An operation that outlived its fifteen seconds is still running: its result is
// put on the page when it comes, and nothing new is started on top of it.
let pushLate = null;
const within = (work, ms) => Promise.race([work, new Promise((ok) => setTimeout(ok, ms))]);
async function onPushToggle(event) {
  const enabled = Boolean(event.target.checked);
  if (pushLate) { event.target.checked = pushEnabled.value;f7.dialog.alert(ct('瀏覽器還在處理上一次的要求，請稍後再試'));return; }
  // A tap while the switch is busy is no tap: it changes nothing.
  if (pushBusy.value) { event.target.checked = pushEnabled.value;return; }
  pushBusy.value = true;pushWorking = true;pushOperations += 1;
  let work = null;
  try {
    // Fifteen seconds at most: a desktop browser can leave the request to its push
    // service unanswered for ever, and the switch then did nothing at all, with no
    // word.
    let timer;
    const late = new Promise((_, no) => { timer = setTimeout(() => no(Object.assign(new Error(ct('瀏覽器 15 秒內沒有回應，請再試一次')), { name: 'TimeoutError', code: 'PUSH_TOGGLE_TIMEOUT' })), PUSH_TOGGLE_MS); });
    work = enabled ? enablePush() : disablePush();
    const state = await Promise.race([work, late]).finally(() => clearTimeout(timer));
    applyPushState(state);
    event.target.checked = pushEnabled.value;
    if (state.enabled === enabled) toast(enabled ? t('pushEnabled') : t('pushDisabled'));
    // Asked for and not so, with no error to show: said, instead of a switch that
    // goes back by itself without a word.
    else f7.dialog.alert(enabled ? ct('通知沒有開啟，請再試一次') : ct('通知沒有關閉，請再試一次'));
  } catch (error) {
    event.target.checked = pushEnabled.value;
    f7.dialog.alert(pushFailureMessage(error, enabled));
    if (error?.code === 'PUSH_TOGGLE_TIMEOUT' && work) {
      const mine = pushLate = work.then((state) => { applyPushState(state); }, () => refreshPushState({ quiet: true }))
        .catch(() => {}).finally(() => { if (pushLate === mine) pushLate = null; });
      // Not for ever: an operation that never comes back (a permission prompt left
      // open) must not lock the switch for the life of the page. Its result is still
      // put on the page if it ever comes.
      setTimeout(() => { if (pushLate === mine) pushLate = null; }, 45000);
    }
    // Five seconds at most: the read after a failure must not hold the switch itself.
    await within(refreshPushState({ quiet: true }), 5000);
  } finally {
    pushDone();
  }
}

async function onSendTestPush() {
  if (pushBusy.value || !pushEnabled.value) return;
  pushBusy.value = true;pushWorking = true;pushOperations += 1;
  try {
    await sendTestPush();
    toast(t('pushTestSent'));
  } catch (error) {
    f7.dialog.alert(error?.message || t('pushTestFailed'));
  } finally {
    pushDone();
  }
}

const PUSH_TOGGLE_MS = 15000, PUSH_READY_MS = 3000;
// The first reads can fail or never answer (a worker not ready yet), and this tab's
// page is not made again: the state is read again whenever the app is looked at.
const rereadPush = () => { if (document.visibilityState === 'visible' && !pushWorking) refreshPushState({ quiet: true, background: true }).catch(() => {}); };
onBeforeUnmount(() => document.removeEventListener('visibilitychange', rereadPush));
onMounted(() => {
  document.addEventListener('visibilitychange', rereadPush);
  // The switch is free as soon as the state is read, and after three seconds
  // whatever happens: it used to wait for the repair below, which on a desktop
  // browser can wait on the push service without end, and the switch stayed locked.
  const free = setTimeout(() => { if (!pushWorking) pushBusy.value = false; }, PUSH_READY_MS);
  refreshPushState({ quiet: true, background: true }).finally(() => { clearTimeout(free);if (!pushWorking) pushBusy.value = false; });
  // Silent VAPID resubscribe-on-rotation on settings open: best-effort,
  // in the background; the state is read again once it is done, and that reading is
  // dropped if a toggle or a test began meanwhile (the operation reads it itself).
  setPushAccount(currentUser.value?.id);
  resubscribeIfRotated().then(() => refreshPushState({ quiet: true, background: true })).catch(() => {});
});

function editName() {
  f7.dialog.prompt(t('displayName'), PRODUCT.name, async (value) => {
    const name = (value || '').trim();
    if (!name) return;
    try {
      await updateCurrentUser({ name });
      toast(t('settingsSaved'));
    } catch (err) {
      f7.dialog.alert(err.message || t('settingsFailed'));
    }
  }, undefined, currentUser.value?.name || '');
}

// Scanning is the phone's part: a computer is signed in by a code, never scans one.
const handheld = isHandheld();
function goScanLogin() { f7.views.get('#view-settings').router.navigate('/scan-login/'); }
function goDevices() { f7.views.get('#view-settings').router.navigate('/devices/'); }

function goPasskeys() { f7.views.get('#view-settings').router.navigate('/passkeys/'); }
function goTwoStep() { f7.views.get('#view-settings').router.navigate('/two-step/'); }
function goChangePassword() {
  f7.views.get('#view-settings').router.navigate('/change-password/');
}

function doLogout() {
  f7.dialog.confirm(t('logoutConfirm'), async () => {
    await logout();
  });
}

// The single update routine lives in js/pwa-update.js so this button and the
// "new build available" offer cannot drift apart; only the wording stays here.
// Check for a new version: ask the server which build it serves; a different one is offered
// with the same prompt the app shows by itself, and nothing changes until the
// person agrees. Already on it, it says so.
async function checkForUpdate() {
  const progress = f7.dialog.preloader(t('forceUpdateChecking'));
  const latest = await fetchLatestBuildId({ fetchImpl: window.fetch.bind(window) });
  progress.close();
  if (!latest) { f7.dialog.alert(t('updateCheckFailed')); return; }
  if (!hasNewVersion(__BUILD_ID__, latest)) {
    f7.toast.create({ text: t('upToDate', { current: __BUILD_ID__ }), closeTimeout: 2400 }).open();
    return;
  }
  f7.dialog.confirm(t('updateAvailableText', { current: __BUILD_ID__, latest }), t('updateAvailableTitle'), forceUpdate);
}

async function forceUpdate() {
  // Instant feedback + staged text: a silent tap once read as a hang.
  const progress = f7.dialog.preloader(t('forceUpdateChecking'));
  await forceAppUpdate({
    onPhase(phase) {
      if (phase === 'applying') progress.setText(t('forceUpdateApplying'));
      if (phase === 'reloading') progress.setText(t('forceUpdateReloading'));
    },
  });
}

</script>

<style scoped>
/* The small test button left of the notifications switch. */
.push-row .item-after {display:flex;align-items:center;gap:10px;}
.push-test {display:flex;align-items:center;gap:5px;height:28px;padding:0 12px;border-radius:14px;background:rgba(120, 120, 128, .24);color:var(--f7-list-item-title-text-color, var(--f7-text-color));font-size:13px;}
.push-test .icon {font-size:17px;}
.push-test.disabled {opacity:.4;pointer-events:none;}
/* Toggle rows are plain (non-link) list items, so without this their titles
   are text-selectable while link rows are not — visually inconsistent. */
.cc-settings-list {
  user-select: none;
  -webkit-user-select: none;
}
.mode-hint {
  color: #8e8e93;
  font-size: 13px;
}
.logout-row :deep(.item-title) {
  color: #ff3b30;
}
</style>
