<template>
  <!-- Pushed page within the #view-admin stack. -->
  <f7-page name="user-edit">
    <f7-navbar>
      <f7-nav-left :back-link="true"></f7-nav-left>
      <f7-nav-title sliding>{{ user?.name || t('manageUsers') }}</f7-nav-title>
    </f7-navbar>

    <div class="page-col-medium">
    <template v-if="user">
      <!-- edit menu (identity lives in the navbar title; the list row already
           showed avatar/role/status, so no duplicated header here) -->
      <f7-list v-if="canEdit" inset class="cc-settings-list" style="margin-top: 24px;">
        <f7-list-item link no-chevron :title="t('changeDisplayName')" @click.prevent="changeDisplayName">
          <template #media><f7-icon f7="textformat" /></template>
        </f7-list-item>
        <f7-list-item link no-chevron :title="t('changeUserName')" @click.prevent="changeUserName">
          <template #media><f7-icon f7="at" /></template>
        </f7-list-item>
        <f7-list-item
          link
          no-chevron
          :title="t('changeRole')"
          :after="user.role"
          @click.prevent="openRoleDropdown($event)"
        >
          <template #media><f7-icon f7="star" /></template>
        </f7-list-item>
        <!-- One's own password is changed on the change-password page, with the old one. -->
        <f7-list-item v-if="user.id !== currentUser?.id" link no-chevron :title="t('resetPassword')" class="reset-password" @click.prevent="resetPassword">
          <template #media><f7-icon f7="lock_rotation" /></template>
        </f7-list-item>
        <!-- For someone whose authenticator and recovery codes are gone. -->
        <f7-list-item v-if="user.twoStep && user.id !== currentUser?.id" link no-chevron :title="ct('重設兩步驟驗證')" class="reset-two-step" @click.prevent="resetTwoStep">
          <template #media><f7-icon f7="lock_shield" /></template>
        </f7-list-item>
      </f7-list>

      <!-- This person's agents: an admin sets their scope and deletes them here. -->
      <template v-if="canEdit">
        <f7-block-title>{{ ct('這個使用者的 Agent') }}</f7-block-title>
        <f7-list inset class="cc-settings-list user-agents">
          <f7-list-item v-for="c in agents" :key="c.id" link :title="c.title" :after="phaseLabel(c.phase)" @click.prevent="editAccess(c)">
            <template #media><f7-icon f7="bubble_left" /></template>
            <template #content-end><f7-link icon-only icon-f7="trash" color="red" class="user-agent-remove" :aria-label="ct('刪除 Agent') + ' ' + c.title" @click.stop="archiveAgent(c)" /></template>
          </f7-list-item>
          <f7-list-item v-if="!agents.length" :title="ct('還沒有 Agent')" />
        </f7-list>
        <!-- An agent's scope, set outright: how a grant from a report is narrowed or
             taken back. At the app root, like the other overlays. -->
        <Teleport to=".framework7-root">
          <f7-popup :opened="accessEditing !== null" class="user-agent-access" @popup:closed="accessEditing = null">
            <f7-page v-if="accessEditing">
              <f7-navbar :title="accessEditing.title"><f7-nav-right><f7-link @click="accessEditing = null">{{ ct('關閉') }}</f7-link></f7-nav-right></f7-navbar>
              <AgentProfileFields v-model="accessEditing" :admin="true" :show-access="true" :access-only="true" :allow-full="user?.role === 'admin'" />
              <f7-block><f7-button fill round large :disabled="accessSaving" @click="saveAccess">{{ ct('保存範圍') }}</f7-button></f7-block>
            </f7-page>
          </f7-popup>
        </Teleport>
      </template>

      <f7-list v-if="user.id !== currentUser?.id" inset class="cc-settings-list">
        <f7-list-item v-if="canDisable" link no-chevron :title="t('disableUser')" @click.prevent="disableUser">
          <template #media><f7-icon f7="pause_circle" /></template>
        </f7-list-item>
        <f7-list-item v-if="canEnable" link no-chevron :title="t('enableUser')" @click.prevent="enableUser">
          <template #media><f7-icon f7="play_circle" /></template>
        </f7-list-item>
        <f7-list-item v-if="canDelete" link no-chevron :title="t('deleteUser')" class="danger-row" @click.prevent="removeUser">
          <template #media><f7-icon f7="trash" style="color: #ff3b30;" /></template>
        </f7-list-item>
      </f7-list>

      <!-- permanent purge: only ever offered for a tombstone account. -->
      <f7-list v-if="canPurge" inset class="cc-settings-list">
        <f7-list-item link no-chevron :title="t('purgeUser')" class="danger-row" @click.prevent="purgeUser">
          <template #media><f7-icon f7="xmark_octagon" style="color: #ff3b30;" /></template>
        </f7-list-item>
      </f7-list>

      <GlassDropdown
        :open="roleDropdownOpen"
        :point="roleDropdownPoint"
        :items="roleItems"
        :selected="user.role"
        @close="roleDropdownOpen = false"
        @select="changeRole"
      />
    </template>

    <f7-block v-else class="muted" style="margin-top: 60px; text-align: center;">
      {{ t('unknown') }}
    </f7-block>
    </div>
  </f7-page>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { f7 } from 'framework7-vue';
import { t } from '../js/i18n.js';
import { ct } from '../js/agent-i18n.js';
import { PRODUCT } from '../js/productConfig.js';
import { api, currentUser } from '../js/auth.js';
import { users, loadUsers, findUser } from '../js/users-store.js';
import { adminAgain, adminProblem } from '../js/adminAgain.js';
import GlassDropdown from '../components/GlassDropdown.vue';
import AgentProfileFields from '../components/AgentProfileFields.vue';

const props = defineProps({
  f7route: { type: Object, default: () => ({}) },
});

const userId = props.f7route?.query?.id || '';
const user = computed(() => findUser(userId));
const lifecycleStatus = computed(() => user.value?.lifecycleStatus || 'active');
const canEdit = computed(() => lifecycleStatus.value !== 'deleted_tombstone');
const canDisable = computed(() => lifecycleStatus.value === 'active' && user.value?.id !== currentUser.value?.id);
const canEnable = computed(() => lifecycleStatus.value === 'disabled' && user.value?.id !== currentUser.value?.id);
const canDelete = computed(() => lifecycleStatus.value !== 'deleted_tombstone' && user.value?.id !== currentUser.value?.id);
const canPurge = computed(() => lifecycleStatus.value === 'deleted_tombstone');

const toast = (text) => f7.toast.create({ text, closeTimeout: 1800 }).open();

const agents = ref([]);
const phaseLabel = (phase) => ({ ready: ct('在線'), stopped: ct('已暫停'), error: ct('需要重新連線'), starting: ct('啟動中'), busy: ct('處理中') }[phase] || phase || '');
async function loadAgents() {
  try {
    agents.value = (await api(`/agent-admin/users/${userId}/agents`)).conversations || [];
  } catch (_error) { /* the actions below report their own failures */ }
}
// Opened straight from a scope report, the users list may not be loaded yet.
onMounted(() => { if (!user.value) loadUsers().catch(() => {}); loadAgents(); });
const accessEditing = ref(null);
const accessSaving = ref(false);
function editAccess(c) {
  accessEditing.value = { id: c.id, title: c.title, access: JSON.parse(JSON.stringify(c.access || { allow: [], exclude: [], domains: [] })) };
}
async function saveAccess() {
  accessSaving.value = true;
  try {
    agents.value = (await api(`/agent-admin/users/${userId}/agents/${accessEditing.value.id}/access`, { method: 'PUT', body: JSON.stringify({ access: accessEditing.value.access }) })).conversations || [];
    accessEditing.value = null;
    toast(ct('範圍已保存，執行中的 Agent 會重新連線'));
  } catch (err) { f7.dialog.alert(err.message); } finally { accessSaving.value = false; }
}
function archiveAgent(c) {
  f7.dialog.confirm(ct('停止這個 Agent 並從這位使用者的清單移除？它的紀錄會留在這台電腦上，直到依保留設定清除。'), ct('刪除 Agent'), async () => {
    try {
      agents.value = (await api(`/agent-admin/users/${userId}/agents/${c.id}/archive`, { method: 'POST', body: '{}' })).conversations || [];
      toast(ct('已刪除 Agent'));
    } catch (err) { f7.dialog.alert(err.message); }
  });
}

function goBack() {
  f7.views.get('#view-admin').router.back();
}

async function updateUser(patch, successText) {
  try {
    await api(`/auth/users/${userId}`, { method: 'PUT', body: JSON.stringify(patch) });
    await loadUsers();
    toast(successText);
  } catch (err) {
    f7.dialog.alert(err.message);
    await loadUsers().catch(() => {});
    agentsLeft(err.data);
  }
}

function changeDisplayName() {
  f7.dialog.prompt(t('changeDisplayName'), PRODUCT.name, (value) => {
    const name = (value || '').trim();
    if (!name) return;
    updateUser({ name }, t('settingsSaved'));
  }, undefined, user.value?.name || '');
}

function changeUserName() {
  f7.dialog.prompt(t('changeUserNamePrompt'), t('changeUserName'), (value) => {
    const username = (value || '').trim();
    if (!username) return;
    // An administrator's name is changed with the acting admin's own password again.
    if (user.value?.role !== 'admin' || username === user.value?.username) return updateUser({ username }, t('settingsSaved'));
    adminAgain(t('changeUserName'), (again) => adminDo(() => api(`/auth/users/${userId}`, { method: 'PUT', body: JSON.stringify({ username, ...again }) }), t('settingsSaved')));
  }, undefined, user.value?.username || '');
}
// The acting admin's own password again, and the code when their two-step is on
// (js/adminAgain.js): making an administrator, resetting a password, enabling or
// renaming an administrator.
async function adminDo(call, successText) {
  // A refusal that says the clean-up was incomplete has changed the account all the
  // same: the list is read again either way.
  try { const done = await call(); await loadUsers(); toast(successText); agentsLeft(done); } catch (err) { f7.dialog.alert(adminProblem(err) || lifecycleErrorMessage(err)); await loadUsers().catch(() => {}); agentsLeft(err.data); }
}
// Agents a disable or delete could not stop, named so the admin stops them by hand.
// Dialogs show plain text (js/safeDialog.js).
function agentsLeft(data) {
  const names = (data?.agentsNotStopped || []).map((c) => c?.title || c?.id).filter(Boolean);
  if (!names.length && !data?.agentsStopUnchecked) return;
  loadAgents();
  f7.dialog.alert(names.length ? `${ct('這些 Agent 沒有停下來，請手動停止：')}\n${names.join('\n')}` : ct('無法確認這個帳號的 Agent 都已停止，請檢查並手動停止。'), ct('Agent 沒有全部停止'));
}

// role picker: anchored glass dropdown (same as settings preferences)
const roleDropdownOpen = ref(false);
const roleDropdownPoint = ref({ clientX: 0, clientY: 0 });
const roleItems = [
  { value: 'admin', label: 'admin' },
  { value: 'user', label: 'user' },
];
function openRoleDropdown(event) {
  roleDropdownPoint.value = { clientX: event?.clientX ?? 0, clientY: event?.clientY ?? 0 };
  roleDropdownOpen.value = true;
}
function changeRole(role) {
  if (role === user.value?.role) return;
  // Taking another administrator down is confirmed the same way.
  if (role !== 'admin' && user.value?.role === 'admin' && user.value?.id !== currentUser.value?.id) return adminAgain(ct('取消管理員'), (again) => grantAdmin({ role, ...again }), ct('把這個管理員改成一般使用者，請輸入你自己的密碼確認。'));
  if (role !== 'admin') return updateUser({ role }, t('settingsSaved'));
  // Making an administrator takes the acting admin's own password again, and the
  // two-step code when theirs is on.
  adminAgain(ct('設為管理員'), (again) => grantAdmin({ role, ...again }), ct('把這個帳號設為管理員，請輸入你自己的密碼確認。'));
}
async function grantAdmin(patch) {
  try {
    await api(`/auth/users/${userId}`, { method: 'PUT', body: JSON.stringify(patch) });
    await loadUsers();
    toast(t('settingsSaved'));
  } catch (err) {
    f7.dialog.alert(adminProblem(err) || err.message);
    await loadUsers().catch(() => {});
    agentsLeft(err.data);
  }
}

function resetPassword() {
  f7.dialog.password(
    t('resetPasswordPrompt', { name: user.value?.username || '' }),
    t('resetPassword'),
    (password) => {
      if (!password) return;
      // Anyone's password is reset with the acting admin's own password again.
      adminAgain(t('resetPassword'), (again) => adminDo(() => api(`/auth/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: password, ...again }),
      }), t('passwordReset')));
    },
  );
}

// Another account's second step is taken away with the acting admin's own password
// again, and the code when theirs is on.
function resetTwoStep() {
  adminAgain(ct('重設兩步驟驗證'), async (again) => {
    try {
      await api(`/auth/users/${userId}/reset-two-step`, { method: 'POST', body: JSON.stringify(again) });
      // The list is read again: the row goes away with the account's second step.
      await loadUsers();
      toast(ct('兩步驟驗證已重設'));
    } catch (err) {
      f7.dialog.alert(adminProblem(err) || err.message);
      await loadUsers().catch(() => {});
    }
  }, ct('這個帳號之後只用密碼就能登入，直到本人重新開啟。請輸入你自己的密碼確認。'));
}

function lifecycleErrorMessage(err) {
  if (err?.code === 'USER_HAS_ACTIVE_SCHEDULE') return t('userHasActiveSchedule');
  return err?.message || t('settingsFailed');
}

function changeLifecycle(action, confirmKey, successKey) {
  f7.dialog.confirm(t(confirmKey, { name: user.value?.username || '' }), async () => {
    // An administrator is disabled, or brought back, with the acting admin's own password again.
    if (user.value?.role === 'admin' && (action === 'enable' || action === 'disable')) {
      return adminAgain(t(confirmKey, { name: user.value?.username || '' }), (again) => adminDo(() => api(`/auth/users/${userId}/${action}`, { method: 'POST', body: JSON.stringify({ reason: `admin_${action}`, ...again }) }), t(successKey)));
    }
    try {
      const done = await api(`/auth/users/${userId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: `admin_${action}` }),
      });
      await loadUsers();
      toast(t(successKey));
      agentsLeft(done);
    } catch (err) {
      f7.dialog.alert(lifecycleErrorMessage(err));
      await loadUsers().catch(() => {});
      agentsLeft(err.data);
    }
  });
}

function disableUser() {
  changeLifecycle('disable', 'disableUserConfirm', 'userDisabled');
}

function enableUser() {
  changeLifecycle('enable', 'enableUserConfirm', 'userEnabled');
}

function removeUser() {
  f7.dialog.confirm(t('deleteUserConfirm', { name: user.value?.username || '' }), async () => {
    // Deleting an administrator takes the acting admin's own password again.
    if (user.value?.role === 'admin') {
      return adminAgain(t('deleteUserConfirm', { name: user.value?.username || '' }), async (again) => {
        try { const done = await api(`/auth/users/${userId}`, { method: 'DELETE', body: JSON.stringify(again) }); toast(t('userDeleted')); await loadUsers(); agentsLeft(done); goBack(); }
        catch (err) { f7.dialog.alert(adminProblem(err) || lifecycleErrorMessage(err)); await loadUsers().catch(() => {}); agentsLeft(err.data); }
      });
    }
    try {
      const done = await api(`/auth/users/${userId}`, { method: 'DELETE' });
      toast(t('userDeleted'));
      await loadUsers();
      agentsLeft(done);
      goBack();
    } catch (err) {
      f7.dialog.alert(lifecycleErrorMessage(err));
      await loadUsers().catch(() => {});
      agentsLeft(err.data);
    }
  });
}

// Permanent purge: irreversible, so it is double-confirmed. On success the
// account disappears from the list, so navigate back and refresh.
function purgeUser() {
  const name = user.value?.username || '';
  f7.dialog.confirm(t('purgeUserConfirm', { name }), () => {
    f7.dialog.confirm(t('purgeUserConfirmAgain', { name }), () => {
      const purge = async (again) => {
        try {
          await api(`/auth/users/${userId}/purge`, { method: 'DELETE', ...(again ? { body: JSON.stringify(again) } : {}) });
          toast(t('userPurged'));
          await loadUsers();
          goBack();
        } catch (err) {
          f7.dialog.alert(adminProblem(err) || err?.message || t('settingsFailed'));
          await loadUsers().catch(() => {});
        }
      };
      // What is left of an administrator goes with the acting admin's own password again.
      if (user.value?.role === 'admin') return adminAgain(t('purgeUser'), purge);
      purge();
    });
  });
}
</script>

<style scoped>
.danger-row :deep(.item-title) {
  color: #ff3b30;
}
.muted {
  color: #8e8e93;
}
</style>
