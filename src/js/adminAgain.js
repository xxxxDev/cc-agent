// The acting admin's own password again, and the code when their two-step is on:
// making an administrator, resetting a password, enabling or renaming an
// administrator, and what widens the peer link. One helper for every page that asks
// for it.
import {f7} from 'framework7-vue';
import {t} from './i18n.js';
import {ct} from './agent-i18n.js';
import {currentUser} from './auth.js';
import {passkeyAgainChallenge, answerPasskeyAgain, cancelled} from './passkeys.js';

// With a passkey on the account it is asked for first; cancelled or refused, the
// password (and code) as before.
export function adminAgain(title, then, text = ct('請輸入你自己的密碼確認。'), cancel = () => {}) {
  passkeyAgainChallenge().then((o) => {
    if (!o) return byPassword(title, then, text, cancel);
    f7.dialog.create({ title, text: ct('用 passkey 確認這個動作。'), buttons: [
      { text: ct('改用密碼'), onClick: () => byPassword(title, then, text, cancel) },
      { text: ct('使用 passkey'), bold: true, onClick: () => answerPasskeyAgain(o).then((adminPasskey) => then({adminPasskey}), (e) => { if (!cancelled(e)) console.warn('passkey:', e?.message); byPassword(title, then, text, cancel); }) },
    ] }).open();
  });
}
function byPassword(title, then, text, cancel) {
  f7.dialog.password(text, title, (adminPassword) => {
    if (!adminPassword) return cancel();
    if (!currentUser.value?.twoStep) return then({adminPassword});
    f7.dialog.prompt(ct('請輸入你的驗證碼或備用碼。'), title, (adminCode) => { if ((adminCode || '').trim()) then({adminPassword, adminCode: adminCode.trim()});else cancel(); }, cancel);
  }, cancel);
}
export const adminProblem = (err) => (err.code === 'NEED_CODE' ? ct('你的帳號已開啟兩步驟驗證，請重新整理頁面後再試一次') : err.code === 'CODES_SPENT' ? ct('今天驗證碼輸錯太多次，今天不再接受驗證器的碼，請改用備用碼') : err.status === 429 ? t('tooManyAttempts') : err.code === 'WRONG_PASSWORD' ? ct('密碼不正確') : err.code === 'WRONG_CODE' ? ct('驗證碼不正確') : err.code === 'PASSKEY_REFUSED' ? ct('passkey 沒有通過，請再試一次或改用密碼') : null);
// Asked first without: where the server answers NEED_PASSWORD (it widens something),
// the password (and code) is asked for and the call made again with it. Resolves to
// the call's answer, or null when the admin cancelled.
export async function withAdminAgain(title, call, text) {
  try { return await call({}); } catch (e) { if (e.code !== 'NEED_PASSWORD') throw e; }
  const again = await new Promise((done) => adminAgain(title, done, text, () => done(null)));
  return again ? call(again) : null;
}
