<template>
  <!-- This account's passkeys: sign in with the device's fingerprint,
       face or PIN, no password. Added and removed here. -->
  <f7-page name="passkeys" class="page-large-static passkeys-page" @page:afterin="load">
    <f7-navbar :title="ct('通行密鑰')" :back-link="t('back')"></f7-navbar>
    <f7-block class="pk-note">{{ ct('通行密鑰存在你的裝置或密碼管理工具裡，登入時用 Face ID、Touch ID、Windows Hello 或裝置密碼確認，不必輸入密碼和驗證碼。') }}</f7-block>
    <f7-block-title>{{ ct('已建立的通行密鑰') }}</f7-block-title>
    <f7-block v-if="!passkeys.length" class="pk-empty">{{ ct('還沒有通行密鑰') }}</f7-block>
    <f7-list v-else inset strong-ios class="pk-list">
      <f7-list-item v-for="p in passkeys" :key="p.id" :title="p.name" :footer="footer(p)">
        <template #media><f7-icon f7="checkmark_shield" /></template>
        <template #after><a href="#" class="pk-remove" @click.prevent="remove(p)">{{ ct('刪除') }}</a></template>
      </f7-list-item>
    </f7-list>

    <template v-if="works">
      <f7-block-title>{{ ct('建立通行密鑰') }}</f7-block-title>
      <f7-list strong-ios dividers-ios inset form @submit.prevent>
        <f7-list-input :label="ct('名稱')" type="text" maxlength="40" :placeholder="ct('例如：MacBook、iPhone')" v-model:value="name"></f7-list-input>
        <f7-list-input :label="t('password')" type="password" autocomplete="current-password" v-model:value="password" @keyup.enter="add"></f7-list-input>
        <f7-list-input v-if="currentUser?.twoStep" :label="ct('驗證碼或備用碼')" type="text" autocomplete="one-time-code" autocapitalize="off" v-model:value="code" @keyup.enter="add"></f7-list-input>
      </f7-list>
      <f7-block v-if="message" class="form-error">{{ message }}</f7-block>
      <f7-block><f7-button fill round large class="pk-add" :disabled="busy || !password || (currentUser?.twoStep && !code)" @click="add">{{ ct('建立通行密鑰') }}</f7-button></f7-block>
    </template>
    <f7-block v-else class="pk-note pk-unavailable">{{ ct('這個頁面無法建立通行密鑰：需要從 {product} 的網址（https）開啟，而且瀏覽器要支援。') }}</f7-block>
  </f7-page>
</template>

<script setup>
import { ref } from 'vue';
import { f7 } from 'framework7-vue';
import { t } from '../js/i18n.js';
import { ct } from '../js/agent-i18n.js';
import { currentUser } from '../js/auth.js';
import { listPasskeys, addPasskey, removePasskey, passkeysWork, cancelled } from '../js/passkeys.js';
import { describeAgent } from '../js/qrLogin.js';

const passkeys = ref([]), works = passkeysWork();
const name = ref(''), password = ref(''), code = ref(''), message = ref(''), busy = ref(false);
const day = (iso) => { if (!iso) return ''; const d = new Date(iso);return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const footer = (p) => `${day(p.createdAt)} ${ct('建立')}${p.lastUsedAt ? ' · ' + ct('上次使用') + ' ' + day(p.lastUsedAt) : ''}`;
async function load() {
  try { passkeys.value = (await listPasskeys()).passkeys || []; } catch (e) { f7.dialog.alert(e.message); }
}
async function add() {
  if (busy.value || !password.value) return;
  busy.value = true;message.value = '';
  try {
    // No name given: the device it is made on.
    await addPasskey({ name: name.value.trim() || describeAgent(navigator.userAgent), password: password.value, code: code.value.trim() });
    name.value = '';password.value = '';code.value = '';
    await load();
    f7.toast.create({ text: ct('通行密鑰已建立'), closeTimeout: 1800 }).open();
  } catch (e) {
    if (cancelled(e)) message.value = ct('已取消，沒有建立。');
    else if (e?.name === 'InvalidStateError') message.value = ct('這個裝置已經有這個帳號的通行密鑰。');
    else if (e.code === 'CODES_SPENT') message.value = ct('今天驗證碼輸錯太多次，今天不再接受驗證器的碼，請改用備用碼');
    else if (e.status === 429) message.value = t('tooManyAttempts');
    else if (e.code === 'WRONG_PASSWORD') message.value = ct('密碼不正確');
    else if (e.code === 'NEED_CODE') message.value = ct('請輸入你的驗證碼或備用碼。');
    else if (e.code === 'WRONG_CODE') message.value = ct('驗證碼不正確');
    else if (e.code === 'SIGN_IN_CHANGED') message.value = ct('加的途中帳號的密碼或狀態變了，這把沒有留下，請重新加一次。');
    else if (e.code === 'PASSKEY_NOT_REMOVED') message.value = ct('加的途中帳號的密碼或狀態變了，但這把沒能移除，請在下方清單刪掉它。');
    else message.value = e.message;
  } finally { busy.value = false; }
}
function remove(p) {
  f7.dialog.confirm(ct('刪除後，這把通行密鑰就不能再登入。裝置或密碼管理工具裡的那一份要另外自己刪。'), ct('刪除') + ' ' + p.name, async () => { await removePasskey(p.id).catch((e) => f7.dialog.alert(e.message));load(); });
}
load();
</script>

<style scoped>
.pk-note {font-size:14px;color:var(--cc-color-text-secondary,#8e8e93);line-height:1.5;}
.pk-empty {font-size:13px;color:var(--cc-color-text-secondary,#8e8e93);}
.pk-remove {color:#ff453a;font-size:14px;}
.form-error {color:#ff3b30;font-size:14px;}
</style>
