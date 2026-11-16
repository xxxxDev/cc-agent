<template>
  <!-- The peer link: this machine paired with another CC Agent, for admins. Pairing takes both machines;
       each side switches it on; only agents opened in Agent Profile exchange messages. -->
  <f7-page name="peer-link" class="page-large-static" ptr :ptr-mousewheel="true" @ptr:refresh="refresh" @page:afterin="load">
    <f7-navbar :title="ct('跨機連線')" :back-link="t('back')"></f7-navbar>

    <p class="peer-note peer-intro">{{ ct('跨機連線讓這台和另一台 CC Agent 的 agent 互傳訊息。要兩台一起設定：一台產生配對碼，另一台輸入配對碼加入。配對後，兩邊的管理員都要按「啟用」才會生效。只有在 Agent Profile 開通「跨機傳訊」的 agent 才能互傳訊息。') }}</p>
    <f7-block v-if="error" class="peer-error" role="alert">{{ error }}</f7-block>

    <template v-if="data">
      <f7-block-title>{{ ct('這台電腦') }}</f7-block-title>
      <f7-list inset class="cc-settings-list peer-self">
        <f7-list-item :title="ct('連線方式')" :after="data.role === 'caller' ? ct('主動連到對方') : ct('等對方連過來')" :footer="ct('編號') + ' ' + String(data.machineId || '').slice(0, 8)"><template #media><f7-icon f7="desktopcomputer"/></template></f7-list-item>
      </f7-list>

      <!-- The answering side shows a code for ten minutes. -->
      <template v-if="data.role === 'answerer'">
        <f7-list inset class="cc-settings-list peer-invite">
          <f7-list-item link no-chevron class="peer-invite-make" :title="ct('產生配對碼')" @click.prevent="makeInvite"><template #media><f7-icon f7="number_square"/></template></f7-list-item>
        </f7-list>
        <div v-if="code && left > 0" class="list inset peer-code-card">
          <div class="peer-code" aria-live="polite">{{ code }}</div>
          <div class="peer-code-left">{{ ct('剩下') }} {{ clock(left) }}</div>
          <p class="peer-code-hint">{{ ct('請在另一台電腦的「跨機連線」按「加入配對」，輸入這組配對碼。配對碼只能用一次。') }}</p>
        </div>
        <p v-else-if="openInvite" class="peer-note peer-invite-open">{{ ct('有一組配對碼還沒過期') }}（{{ clock(openInvite) }}）。{{ ct('看不到碼的話，請重新產生。') }}</p>
        <p v-else-if="code" class="peer-note">{{ ct('配對碼已過期，請重新產生。') }}</p>
      </template>

      <!-- The calling side types the other machine's code, and names it. -->
      <template v-else>
        <f7-block-title>{{ ct('加入配對') }}</f7-block-title>
        <f7-list inset class="cc-settings-list peer-join" form @submit.prevent="join">
          <f7-list-input :label="ct('配對碼')" type="text" class="peer-join-code" :value="joinCode" @update:value="joinCode = $event" :placeholder="ct('另一台電腦顯示的配對碼')" autocomplete="off" autocapitalize="characters"/>
          <f7-list-input :label="ct('替對方取名')" type="text" class="peer-join-name" :value="joinName" @update:value="joinName = $event" :placeholder="ct('例如 辦公室那台')" maxlength="40" :info="ct('1 到 40 個字')"/>
        </f7-list>
        <f7-block><f7-button fill round large class="peer-join-go" :class="{disabled: joining || !joinReady}" @click="join">{{ ct('加入配對') }}</f7-button></f7-block>
      </template>

      <f7-block-title>{{ ct('已配對的電腦') }}</f7-block-title>
      <f7-block v-if="!data.peers.length" class="peer-empty">{{ ct('還沒有配對的電腦') }}</f7-block>
      <template v-for="p in data.peers" :key="p.pairId">
        <f7-list inset class="cc-settings-list peer-card" :data-pair-id="p.pairId">
          <f7-list-item :title="p.name" :footer="p.flowing ? ct('可以互傳訊息') : ct('還不能互傳訊息')"><template #media><f7-icon f7="link"/></template><template #after><span class="peer-tag" :class="stateTone(p.state)">{{ ct(STATE[p.state] || p.state) }}</span></template></f7-list-item>
          <f7-list-item :title="ct('對方')" :after="remoteText(p)"/>
          <f7-list-item :title="ct('上次連線')" :after="p.lastContact ? timeText(p.lastContact) : ct('尚未連線')"/>
          <f7-list-item v-if="p.lastError" class="peer-last-error" :title="ct('最近的錯誤')" :footer="p.lastError"/>
          <f7-list-item v-if="p.state !== 'active'" link no-chevron class="peer-enable" :title="p.state === 'paused' ? ct('恢復') : ct('啟用這組配對')" @click.prevent="enable(p)"><template #media><f7-icon f7="play_circle"/></template></f7-list-item>
          <f7-list-item v-else link no-chevron class="peer-pause" :title="ct('暫停')" @click.prevent="pause(p)"><template #media><f7-icon f7="pause_circle"/></template></f7-list-item>
          <f7-list-item link no-chevron class="peer-rename" :title="ct('改名')" @click.prevent="rename(p)"><template #media><f7-icon f7="pencil"/></template></f7-list-item>
          <f7-list-item link no-chevron class="peer-remove" :title="ct('解除配對')" @click.prevent="remove(p)"><template #media><f7-icon f7="xmark_circle" class="peer-danger"/></template></f7-list-item>
        </f7-list>
        <p class="peer-note">{{ ct('對方開放的 agent') }}</p>
        <f7-list inset class="cc-settings-list peer-directory">
          <f7-list-item v-if="!p.directory.length" :title="ct('對方還沒有開放任何 agent')"/>
          <f7-list-item v-for="a in p.directory" :key="a.agentId" :title="a.title || a.agentId" :footer="[a.owner, a.agentId].filter(Boolean).join(' · ')"/>
        </f7-list>
      </template>
    </template>
  </f7-page>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { f7 } from 'framework7-vue';
import { t, timeLocale } from '../js/i18n.js';
import { ct } from '../js/agent-i18n.js';
import { api } from '../js/api.js';
import { adminProblem, withAdminAgain } from '../js/adminAgain.js';

const data = ref(null), error = ref(''), code = ref(''), expiresAt = ref(0), now = ref(Date.now());
const joinCode = ref(''), joinName = ref(''), joining = ref(false);
const STATE = { linked: '待啟用', active: '已啟用', paused: '已暫停' };
const stateTone = (s) => (s === 'active' ? 'green' : s === 'paused' ? 'orange' : '');
const remoteText = (p) => (p.remote?.paused ? ct('已暫停') : p.remote?.enabled ? ct('已啟用') : ct('還沒啟用'));
const left = computed(() => Math.max(0, expiresAt.value - now.value));
const openInvite = computed(() => { const at = Date.parse(data.value?.invite?.expiresAt || ''); return Number.isFinite(at) && at > now.value ? at - now.value : 0; });
const joinReady = computed(() => joinCode.value.trim() && joinName.value.trim() && joinName.value.trim().length <= 40);
const clock = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const timeText = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(timeLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const toast = (text) => f7.toast.create({ text, closeTimeout: 1800 }).open();
const fail = (e) => f7.dialog.alert(adminProblem(e) || e.message);

let ticker = null;
// What the other machine did shows here by itself: the live socket says something
// changed (server/liveUpdates.js compares the pairing state too) and the page reloads,
// so a pairing made on the other machine shows without leaving the page.
let loading = false;
const onLive = () => load();
onMounted(() => { ticker = setInterval(() => { now.value = Date.now(); }, 1000);window.addEventListener('cc-agent-changed', onLive);load(); });
onBeforeUnmount(() => { clearInterval(ticker);window.removeEventListener('cc-agent-changed', onLive); });
async function load() {
  if (loading) return;
  loading = true;
  try { data.value = await api('/peer-link');error.value = ''; } catch (e) { error.value = e.message; } finally { loading = false; }
}
async function refresh(done) { try { await load(); } finally { done(); } }

async function makeInvite() {
  try {
    const r = await withAdminAgain(ct('產生配對碼'), (again) => api('/peer-link/invite', { method: 'POST', body: JSON.stringify(again) }));
    if (!r) return;
    code.value = r.code;expiresAt.value = Date.parse(r.expiresAt) || Date.now() + 600000;now.value = Date.now();
    await load();
  } catch (e) { fail(e); }
}
async function join() {
  if (joining.value || !joinReady.value) return;
  joining.value = true;
  try {
    const body = { code: joinCode.value.trim(), name: joinName.value.trim() };
    const r = await withAdminAgain(ct('加入配對'), (again) => api('/peer-link/join', { method: 'POST', body: JSON.stringify({ ...body, ...again }) }));
    if (!r) return;
    joinCode.value = '';joinName.value = '';
    toast(ct('已配對，請兩邊都按「啟用」'));
    await load();
  } catch (e) { fail(e); } finally { joining.value = false; }
}
async function enable(p) {
  try {
    const r = await withAdminAgain(p.state === 'paused' ? ct('恢復') : ct('啟用這組配對'), (again) => api(`/peer-link/${encodeURIComponent(p.pairId)}/enable`, { method: 'POST', body: JSON.stringify(again) }));
    if (r) { toast(ct('已啟用'));await load(); }
  } catch (e) { fail(e); }
}
async function pause(p) {
  try { await api(`/peer-link/${encodeURIComponent(p.pairId)}/pause`, { method: 'POST', body: '{}' });toast(ct('已暫停'));await load(); } catch (e) { fail(e); }
}
function rename(p) {
  f7.dialog.prompt(ct('1 到 40 個字'), ct('改名'), async (value) => {
    const name = String(value || '').trim();
    if (!name || name === p.name) return;
    try { await api(`/peer-link/${encodeURIComponent(p.pairId)}/rename`, { method: 'POST', body: JSON.stringify({ name }) });toast(t('settingsSaved'));await load(); } catch (e) { fail(e); }
  }, () => {}, p.name);
}
function remove(p) {
  f7.dialog.confirm(ct('解除後這組配對作廢，排隊中的訊息不會送出；要再連線得重新產生配對碼。'), ct('解除配對') + ' ' + p.name, async () => {
    try {
      const r = await withAdminAgain(ct('解除配對'), (again) => api(`/peer-link/${encodeURIComponent(p.pairId)}/remove`, { method: 'POST', body: JSON.stringify(again) }));
      if (r) { toast(ct('已解除配對'));await load(); }
    } catch (e) { fail(e); }
  });
}
</script>
<style>
.peer-note {font-size:12px;color:var(--cc-color-text-secondary,#8e8e93);margin:8px calc(var(--f7-block-padding-horizontal,16px) + 16px);}
.peer-intro {font-size:13px;line-height:1.5;margin-top:16px;}
.peer-error {color:#ff453a;}
.peer-empty {color:var(--cc-color-text-secondary,#8e8e93);font-size:14px;}
.list.inset.peer-code-card {padding:18px 16px 14px;text-align:center;background:var(--f7-list-bg-color,#1f1f21);border-radius:var(--cc-radius-card,24px);margin-left:calc(var(--f7-list-inset-side-margin,16px) + var(--cc-space-5,0px));margin-right:calc(var(--f7-list-inset-side-margin,16px) + var(--cc-space-5,0px));}
.peer-code {font-family:ui-monospace,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:.12em;word-break:break-all;user-select:all;-webkit-user-select:all;}
.peer-code-left {margin-top:6px;font-size:13px;color:#ff9f0a;font-variant-numeric:tabular-nums;}
.peer-code-hint {margin:8px 0 0;font-size:12px;color:var(--cc-color-text-secondary,#8e8e93);}
.peer-tag {font-size:12px;padding:3px 8px;border-radius:10px;white-space:nowrap;background:rgba(120,120,128,.24);}
.peer-tag.green {background:rgba(48,209,88,.18);color:#30d158;}
.peer-tag.orange {background:rgba(255,159,10,.18);color:#ff9f0a;}
.peer-remove .item-title,.peer-danger {color:#ff3b30;}
.peer-last-error .item-footer {color:#ff453a;white-space:normal;}
.peer-directory .item-footer {font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all;white-space:normal;}
.peer-card,.peer-directory,.peer-self,.peer-invite {user-select:none;-webkit-user-select:none;}
@media (min-width:1024px){.peer-note{max-width:min(828px,calc(100% - 32px));margin-left:auto;margin-right:auto;box-sizing:border-box;}.peer-note{padding:0 16px;}}
</style>
