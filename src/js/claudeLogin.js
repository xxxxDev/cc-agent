// The sign-in the login cards share (server/claudeLogin.js): there is one for the whole
// machine, however many chats show a card. Read while a card is on screen and a sign-in
// is under way.
import {ref} from 'vue';
import {api} from './api.js';

export const loginFlow = ref({status: 'idle', url: null, error: ''});
const LIVE = ['starting', 'waiting', 'checking'];
export const loginLive = status => LIVE.includes(status);
let viewers = 0, timer = null;

function schedule() {
  clearTimeout(timer);timer = null;
  if (viewers > 0 && loginLive(loginFlow.value.status)) timer = setTimeout(read, 1500);
}
async function read() {
  try { loginFlow.value = await api('/claude-login'); } catch {}
  schedule();
}
async function post(action, body) {
  loginFlow.value = await api('/claude-login/' + action, {method: 'POST', ...(body ? {body: JSON.stringify(body)} : {})});
  schedule();
}
// A card on screen: returns what to call when it goes.
export function watchLogin() {
  viewers++;read();
  document.addEventListener('visibilitychange', read);
  return () => { viewers--;document.removeEventListener('visibilitychange', read);schedule(); };
}
export const startLogin = () => post('start');
export const sendLoginCode = code => post('code', {code});
export const cancelLogin = () => post('cancel');
