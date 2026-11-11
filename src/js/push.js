import { api as pushApi } from './api.js';
import { PRODUCT } from './productConfig.js';

const DEVICE_KEY = PRODUCT.storageKeys.pushDeviceId;

const DEFAULT_PREFERENCES = PRODUCT.pushPreferences;
let volatileDeviceId = null;
let volatileNotificationsEnabled = null;
// Who is signed in here (App.vue and the Settings page say). The opt-in kept in the
// browser belongs to the account that made it: when another account signs in on the
// same browser, the background repair must not hand it this browser's subscription,
// or it gets notifications it never asked for.
let account = '';
export function setPushAccount(id) { account = id ? String(id) : ''; }

function storageGet(key, scope = globalThis) {
  try {
    return scope?.localStorage?.getItem(key) ?? null;
  } catch (_error) {
    return null;
  }
}

function storageSet(key, value, scope = globalThis) {
  try {
    scope?.localStorage?.setItem(key, value);
  } catch (_error) {
    // Private browsing/storage denial must not prevent a current-session opt in.
  }
}

function storageRemove(key, scope = globalThis) {
  try {
    scope?.localStorage?.removeItem(key);
  } catch (_error) {
    // Ignore unavailable storage.
  }
}

export function pushSupported(scope = globalThis) {
  return Boolean(
    scope?.navigator?.serviceWorker
    && scope?.Notification
    && scope?.PushManager,
  );
}

export function decodeApplicationServerKey(value) {
  if (typeof value !== 'string' || !value) throw new Error('Missing Web Push public key');
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function pushDeviceId() {
  if (volatileDeviceId) return volatileDeviceId;
  const stored = storageGet(DEVICE_KEY);
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(stored || '')) {
    volatileDeviceId = stored;
    return stored;
  }
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  volatileDeviceId = `device-${random}`;
  storageSet(DEVICE_KEY, volatileDeviceId);
  return volatileDeviceId;
}

async function registration(scope = globalThis) {
  if (!pushSupported(scope)) return null;
  return scope.navigator.serviceWorker.getRegistration();
}

// Subscribing needs the worker *activated*, not merely registered: right after a
// fresh install or an update, getRegistration() hands back one that is still
// installing or waiting, and iOS refuses it with "Subscribing for push requires
// an active service worker" (seen on an iPhone). Wait for the
// activated registration instead, bounded so a broken worker cannot hang the
// toggle.
const ACTIVATION_TIMEOUT_MS = 10000;

async function activeRegistration(scope = globalThis, timeoutMs = ACTIVATION_TIMEOUT_MS) {
  const current = await registration(scope);
  if (!current || current.active) return current;
  const ready = scope.navigator?.serviceWorker?.ready;
  if (!ready || typeof ready.then !== 'function') return null;
  let timer;
  const activated = await Promise.race([
    ready,
    new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs, null); }),
  ]).finally(() => clearTimeout(timer));
  return activated?.active ? activated : null;
}

function decision(enabled, scope = globalThis) {
  volatileNotificationsEnabled = Boolean(enabled);
  if (enabled) {
    storageSet('notificationsEnabled', 'true', scope);
    if (account) storageSet('notificationsOwner', account, scope);
    storageRemove('notificationsDisabled', scope);
  } else {
    storageRemove('notificationsEnabled', scope);
    storageSet('notificationsDisabled', new Date().toISOString(), scope);
  }
}

function notificationsOptedIn(scope = globalThis) {
  if (storageGet('notificationsDisabled', scope)) return false;
  if (volatileNotificationsEnabled !== null) return volatileNotificationsEnabled;
  return storageGet('notificationsEnabled', scope) === 'true';
}

export async function loadPushState() {
  const supported = pushSupported();
  const deviceId = pushDeviceId();
  if (!supported) {
    return {
      supported: false,
      serviceWorkerReady: false,
      available: false,
      enabled: false,
      activeDevices: 0,
      preferences: { ...DEFAULT_PREFERENCES },
    };
  }
  const [server, worker] = await Promise.all([
    pushApi(`/push/status?deviceId=${encodeURIComponent(deviceId)}`),
    registration(),
  ]);
  const browserSubscription = worker ? await worker.pushManager.getSubscription() : null;
  return {
    supported: true,
    serviceWorkerReady: Boolean(worker),
    available: Boolean(server.available && worker),
    enabled: Boolean(server.deviceEnabled && browserSubscription),
    activeDevices: Number(server.activeDevices || 0),
    preferences: { ...DEFAULT_PREFERENCES, ...(server.preferences || {}) },
  };
}

export async function enablePush() {
  if (!pushSupported()) {
    const error = new Error('Web Push is not supported on this device');
    error.code = 'PUSH_UNSUPPORTED';
    throw error;
  }
  // requestPermission must remain the first awaited browser action so iOS
  // preserves the user's toggle gesture.
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== 'granted') {
    decision(false);
    const error = new Error('Notification permission was not granted');
    error.code = 'PUSH_PERMISSION_DENIED';
    throw error;
  }
  const config = await pushApi('/push/config');
  if (!config.available || !config.publicKey) {
    const error = new Error('Web Push is not configured');
    error.code = 'PUSH_NOT_CONFIGURED';
    throw error;
  }
  const worker = await activeRegistration();
  if (!worker) {
    const error = new Error('No active service worker for Web Push yet');
    error.code = 'PUSH_WORKER_UNAVAILABLE';
    throw error;
  }
  let browserSubscription = await worker.pushManager.getSubscription();
  let created = false;
  if (!browserSubscription) {
    browserSubscription = await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(config.publicKey),
    });
    created = true;
  }
  try {
    await pushApi('/push/subscription', {
      method: 'PUT',
      body: JSON.stringify({
        deviceId: pushDeviceId(),
        subscription: browserSubscription.toJSON(),
      }),
    });
  } catch (error) {
    if (created) await browserSubscription.unsubscribe().catch(() => {});
    throw error;
  }
  decision(true);
  return loadPushState();
}

export async function disablePush() {
  const worker = await registration();
  const browserSubscription = worker ? await worker.pushManager.getSubscription() : null;
  await pushApi('/push/subscription', {
    method: 'DELETE',
    body: JSON.stringify({
      deviceId: pushDeviceId(),
      endpoint: browserSubscription?.endpoint || null,
    }),
  });
  // The server has it off: that is noted first, as the user's own doing. Were the
  // browser's own unsubscribe to fail before the note, the repair would find a
  // subscription with no "turned off" beside it and turn it all on again.
  decision(false);
  if (browserSubscription) await browserSubscription.unsubscribe().catch(() => {});
  return loadPushState();
}

export async function savePushPreferences(preferences) {
  await pushApi('/push/preferences', {
    method: 'PUT',
    body: JSON.stringify({ preferences }),
  });
  return loadPushState();
}

export async function sendTestPush() {
  return pushApi('/push/test', {
    method: 'POST',
    body: JSON.stringify({ deviceId: pushDeviceId() }),
  });
}

// Byte-compare the live subscription's applicationServerKey (an ArrayBuffer the
// browser hands back) against the decoded current VAPID public key. A mismatch
// means the server rotated its VAPID keypair since this device subscribed.
export function applicationServerKeyMatches(liveKey, desiredKey) {
  if (!liveKey || !desiredKey) return false;
  const live = new Uint8Array(liveKey);
  if (live.length !== desiredKey.length) return false;
  for (let i = 0; i < live.length; i += 1) {
    if (live[i] !== desiredKey[i]) return false;
  }
  return true;
}

// VAPID rotation client behavior: when this device is subscribed and
// the server's current public key no longer matches the live subscription's
// applicationServerKey, silently unsubscribe and resubscribe against the current
// key so future sends succeed. Best-effort: any failure is logged to the
// console only and never blocks app start or settings open. Runs at app start
// and on settings open, alongside the existing push init points.
export async function resubscribeIfRotated({
  scope = globalThis,
  api = pushApi,
  deviceId = pushDeviceId,
  logger = console,
} = {}) {
  try {
    if (!pushSupported(scope)) return { changed: false, reason: 'unsupported' };
    const worker = await activeRegistration(scope);
    if (!worker) return { changed: false, reason: 'no_worker' };
    let browserSubscription = await worker.pushManager.getSubscription();
    if (
      volatileNotificationsEnabled === false
      || storageGet('notificationsDisabled', scope)
    ) {
      return { changed: false, reason: 'disabled' };
    }
    // Turned on here by another account: not this one's to repair. (No owner noted
    // is an opt-in from before owners were kept: taken as this account's, once.)
    const owner = storageGet('notificationsOwner', scope);
    if (account && owner && owner !== account) return { changed: false, reason: 'other_account' };
    // The account this run is for: if someone else is signed in by the time the
    // server is told, the run stops there (it waits on the push service in between).
    const who = account;
    // An opt-in from before owners were noted is taken as this account's only when
    // the server already has this browser turned on for it; otherwise the first
    // account to sign in after an update would inherit another's.
    if (who && !owner) {
      const status = await api(`/push/status?deviceId=${encodeURIComponent(deviceId())}`);
      if (!status?.deviceEnabled) return { changed: false, reason: 'not_this_account' };
    }
    // An existing subscription proves prior opt-in. If rotation failed after
    // unsubscribe, the explicit local marker lets the next run rebuild it.
    if (!browserSubscription && !notificationsOptedIn(scope)) {
      return { changed: false, reason: 'not_subscribed' };
    }
    const config = await api('/push/config');
    if (!config.available || !config.publicKey) {
      return { changed: false, reason: 'not_configured' };
    }
    const desiredKey = decodeApplicationServerKey(config.publicKey);
    let changed = false;
    let reason = 'current';
    if (!browserSubscription) {
      browserSubscription = await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: desiredKey,
      });
      changed = true;
      reason = 'repaired';
    } else {
      const liveKey = browserSubscription.options?.applicationServerKey;
      if (!applicationServerKeyMatches(liveKey, desiredKey)) {
        await browserSubscription.unsubscribe().catch(() => {});
        browserSubscription = await worker.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: desiredKey,
        });
        changed = true;
        reason = 'rotated';
      }
    }
    // What this run subscribed is given back when it is not to be kept.
    const giveBack = async () => { if (changed) await browserSubscription.unsubscribe().catch(() => {}); };
    // Always synchronize the current browser subscription. If a previous PUT
    // failed after subscribe succeeded, this idempotent write repairs the server
    // binding instead of returning "current" forever.
    // Another account signed in while this run waited on the push service: not
    // bound for it.
    if (account !== who) { await giveBack(); return { changed: false, reason: 'account_changed' }; }
    // Turned off while this run was waiting on the push service (the switch is free
    // after three seconds, the wait can be much longer): the user's "off" stands, and
    // what this run subscribed is given back.
    const turnedOff = () => volatileNotificationsEnabled === false || Boolean(storageGet('notificationsDisabled', scope));
    if (turnedOff()) { await giveBack(); return { changed: false, reason: 'disabled' }; }
    const written = await api('/push/subscription', {
      method: 'PUT',
      body: JSON.stringify({
        deviceId: deviceId(),
        subscription: browserSubscription.toJSON(),
      }),
    });
    // What was just written to the server is taken back when it is not to stand.
    const takeBack = () => api('/push/subscription', {
      method: 'DELETE',
      body: JSON.stringify({ deviceId: deviceId(), endpoint: browserSubscription.endpoint || null }),
    }).catch(() => {});
    // Another account signed in while the server was being told. The write may have
    // gone out under its session, binding it to a device it never turned on: then it
    // is taken back. One made for the account before is left alone: a DELETE now goes
    // with the new session and could remove the new account's own binding; with the
    // subscription given back the server drops it on its next send. The server says whom it bound (boundTo).
    if (account !== who) {
      if (written?.boundTo != null && String(written.boundTo) === account) await takeBack();
      await giveBack();
      return { changed: false, reason: 'account_changed' };
    }
    // Turned off while the server was being told: what was just written there is
    // taken back, or the server would go on holding this device as on with nothing
    // left to clear it.
    if (turnedOff()) { await takeBack(); await giveBack(); return { changed: false, reason: 'disabled' }; }
    // A browser subscription plus a successful server binding is authoritative
    // opt-in evidence, including legacy devices that predate the local marker.
    decision(true, scope);
    if (changed) return { changed: true, reason };
    return { changed: false, reason: 'current', synced: true };
  } catch (error) {
    // Never surface to the user or block startup. The opt-in marker plus the
    // idempotent sync above make the next app/settings run a repair attempt.
    logger.warn?.('[push] resubscribe-on-rotation failed', error);
    return { changed: false, reason: 'error' };
  }
}
