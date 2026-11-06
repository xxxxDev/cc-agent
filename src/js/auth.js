import { ref, computed } from 'vue';
import { setLang } from './i18n.js';
import { api } from './api.js';
export { api } from './api.js';

export const currentUser = ref(null);
export const authLoading = ref(true);
export const authError = ref(null);

export const isAuthenticated = computed(() => Boolean(currentUser.value));

function applyUser(user) {
  currentUser.value = user;
  if (user?.language) setLang(user.language, { persist: false });
}

const VERIFY_TIMEOUT_MS = 8000, VERIFY_RETRY_FOR_MS = 90 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only the server saying so signs the page out. A check that fails any other way, the
// service restarting for a new version, a proxy answering 502, a network that just
// changed, is asked again for a while on the start page instead of showing the sign-in
// screen; a sign-in still valid on the server was otherwise lost at every restart. Each
// check keeps its own time limit.
const signedOut = (e) => e?.status === 401 || e?.status === 403;
export async function verifyAuth() {
  authLoading.value = true;
  authError.value = null;
  try {
    let data;
    const until = Date.now() + VERIFY_RETRY_FOR_MS;
    for (let wait = 1000; ; wait = Math.min(wait * 2, 8000)) {
      try { data = await api('/auth/verify', { signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) }); break; }
      catch (e) { if (signedOut(e) || Date.now() + wait > until) throw e; await sleep(wait); }
    }
    applyUser(data.user);
  } catch {
    currentUser.value = null;
  } finally {
    authLoading.value = false;
  }
}

export async function login(username, password) {
  authError.value = null;
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  // Two-step sign-in is on for the account: no session yet, a ticket to hand back
  // with the code (loginCode below).
  if (data.step === 'code') return { step: 'code', ticket: data.ticket };
  applyUser(data.user);
  return data.user;
}
export async function loginCode(ticket, code) {
  const data = await api('/auth/login/code', { method: 'POST', body: JSON.stringify({ ticket, code }) });
  applyUser(data.user);
  return data.user;
}

// Signed in by a phone approving this page's QR request (src/js/qrLogin.js).
export function signedInByQr(user) { authError.value = null;applyUser(user); }

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    currentUser.value = null;
  }
}

export async function updateCurrentUser(patch) {
  const data = await api('/auth/me', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  applyUser(data.user);
  return data.user;
}

export async function changePassword(oldPassword, newPassword, code) {
  return api('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword, ...(code ? { code } : {}) }),
  });
}
