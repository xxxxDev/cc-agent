<template>
  <!-- Sign-in defence, for admins (server/services/securityLog.js): what was tried, from where, and which addresses are blocked. -->
  <f7-page name="security" class="page-large-static" ptr :ptr-mousewheel="true" @ptr:refresh="refresh" @page:afterin="load">
    <f7-navbar :title="ct('登入防禦')" :back-link="t('back')"></f7-navbar>

    <f7-block v-if="error" class="sec-error">{{ error }}</f7-block>
    <template v-if="data">
      <f7-block-title>{{ ct('總覽') }}</f7-block-title>
      <div class="list inset sec-card"><div class="sec-stats">
        <div><b>{{ today.ok }}</b><span>{{ ct('今天登入成功') }}</span></div>
        <div><b class="red">{{ today.fail + today.locked }}</b><span>{{ ct('今天失敗') }}</span></div>
        <div><b class="orange">{{ data.blocks.length }}</b><span>{{ ct('封鎖中') }}</span></div>
      </div>
      <div class="sec-bars">
        <div v-for="d in data.days" :key="d.date" class="sec-bar" :title="d.date">
          <i class="green" :style="{height: h(d.ok)}"></i><i class="red" :style="{height: h(d.fail + d.locked)}"></i><i class="orange" :style="{height: h(d.blocked)}"></i>
        </div>
      </div>
      <div class="sec-days"><span v-for="(d, i) in data.days" :key="d.date">{{ i === data.days.length - 1 ? ct('今天') : d.date.slice(5).replace('-', '/').replace(/^0/, '') }}</span></div>
      <div class="sec-legend"><span><i class="green"></i>{{ ct('成功') }}</span><span><i class="red"></i>{{ ct('失敗') }}</span><span><i class="orange"></i>{{ ct('被擋下') }}</span></div>
      </div>
      <p class="sec-note">{{ ct('其他防禦（今天）') }}：{{ ct('未登入存取') }} {{ today.guards.unauth }} · {{ ct('被限速') }} {{ today.guards.rate }} · {{ ct('被拒絕') }} {{ today.guards.refused }}</p>
      <p class="sec-note">{{ ct('同一個 IP 15 分鐘內失敗 10 次會被封鎖：第一次 1 小時，7 天內再犯 1 天，之後 1 週。封鎖只擋密碼登入，掃碼登入不受影響。') }}</p>

      <p class="sec-note">{{ ct('同一個帳號 1 小時內失敗 20 次（不論來自幾個 IP），或 1 天內驗證碼錯 10 次，會進入保護：1 小時內只有最近 30 天用過的 IP 能用密碼登入，24 小時內再發生則保護 1 天。掃碼登入不受影響。') }}</p>

      <template v-if="data.accounts?.length">
        <f7-block-title>{{ ct('保護中的帳號') }}</f7-block-title>
        <f7-list inset strong-ios class="sec-accounts">
          <f7-list-item v-for="a in data.accounts" :key="a.name" :title="a.name" :footer="`${ct('保護到')} ${timeText(a.until)}${a.times > 1 ? ` · ${ct('第')} ${a.times} ${ct('次')}` : ''}`">
            <template #after><a href="#" class="sec-unblock" @click.prevent.stop="releaseAccount(a.name)">{{ ct('解除') }}</a></template>
          </f7-list-item>
        </f7-list>
      </template>

      <template v-if="data.blocks.length">
        <f7-block-title>{{ ct('封鎖中') }}</f7-block-title>
        <f7-list inset strong-ios class="sec-blocks">
          <f7-list-item v-for="b in data.blocks" :key="b.group" link :title="label(b.group)" :footer="blockFooter(b)" @click="openSource(b.group)">
            <template #after><a href="#" class="sec-unblock" @click.prevent.stop="unblock(b.group)">{{ ct('解除') }}</a></template>
          </f7-list-item>
        </f7-list>
      </template>

      <f7-block-title>{{ ct('可疑來源') }}</f7-block-title>
      <f7-block v-if="!data.sources.length" class="sec-empty">{{ ct('還沒有失敗的登入') }}</f7-block>
      <f7-list v-else inset strong-ios class="sec-sources">
        <f7-list-item v-for="s in data.sources" :key="s.group" link :title="label(s.group)" :footer="sourceFooter(s)" @click="openSource(s.group)">
          <template #media><span class="sec-flag">{{ flag(s.country) }}</span></template>
          <template #after><span v-if="s.blocked" class="sec-tag orange">{{ ct('封鎖中') }}</span><span v-else-if="s.group === data.mine" class="sec-tag green">{{ ct('你目前') }}</span><span v-else-if="s.known" class="sec-tag green">{{ ct('曾成功登入') }}</span></template>
        </f7-list-item>
      </f7-list>

      <f7-block-title>{{ ct('最近的紀錄') }}</f7-block-title>
      <div class="sec-seg">
        <button v-for="f in filters" :key="f.id" type="button" :class="{on: filter === f.id}" @click="setFilter(f.id)">{{ ct(f.label) }}</button>
      </div>
      <f7-block v-if="!data.recent.length" class="sec-empty">{{ ct('沒有紀錄') }}</f7-block>
      <f7-list v-else inset strong-ios class="sec-recent">
        <f7-list-item v-for="(e, i) in data.recent" :key="e.ts + i" :link="!!e.group" :title="eventTitle(e)" :footer="eventFooter(e)" @click="e.group && openSource(e.group)">
          <template #after><span class="sec-tag" :class="eventTag(e).tone">{{ eventTag(e).text }}</span></template>
        </f7-list-item>
      </f7-list>

    </template>

    <!-- One address. -->
    <!-- On a phone a pushed card that closes on a pull down. -->
    <f7-popup :opened="!!source" class="sec-source-popup" :class="{ 'sheet-swipe': sheetSwipe }" :swipe-to-close="sheetSwipe" :push="sheetSwipe" @popup:closed="source = null"><div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"></div><f7-view><f7-page>
      <f7-navbar><f7-nav-left><f7-link popup-close icon-only icon-f7="xmark" :aria-label="ct('關閉')" /></f7-nav-left><f7-nav-title>{{ ct('來源詳情') }}</f7-nav-title></f7-navbar>
      <template v-if="source">
        <f7-block class="sec-source-head">
          <div class="sec-ip">{{ label(source.group) }}</div>
          <div class="sec-where">{{ flag(source.country) }} {{ place(source) || ct('地區不明') }}</div>
        </f7-block>
        <div class="list inset sec-card"><div class="sec-stats">
          <div><b class="red">{{ source.fails }}</b><span>{{ ct('失敗') }}</span></div>
          <div><b>{{ source.ok }}</b><span>{{ ct('成功') }}</span></div>
          <div><b>{{ source.usernames.length }}</b><span>{{ ct('試過的帳號') }}</span></div>
        </div></div>
        <template v-if="source.signs.length">
          <f7-block-title>{{ ct('判斷') }}</f7-block-title>
          <f7-list inset strong-ios class="sec-signs">
            <f7-list-item v-for="s in source.signs" :key="s.sign" :title="signTitle(s)" :footer="signFooter(s)">
              <template #after><span class="sec-tag" :class="s.level === 'high' ? 'red' : 'orange'">{{ s.level === 'high' ? ct('高') : ct('中') }}</span></template>
            </f7-list-item>
          </f7-list>
        </template>
        <f7-block-title>{{ ct('時間軸') }}</f7-block-title>
        <f7-list inset strong-ios class="sec-timeline">
          <f7-list-item v-for="(e, i) in source.events" :key="e.ts + i" :title="eventTitle(e)" :footer="timeText(e.ts) + (e.ua ? ' · ' + e.ua.slice(0, 60) : '')">
            <template #after><span class="sec-tag" :class="eventTag(e).tone">{{ eventTag(e).text }}</span></template>
          </f7-list-item>
        </f7-list>
        <f7-block>
          <f7-button v-if="source.blocked" round large class="sec-lift" @click="unblock(source.group)">{{ ct('解除封鎖') }}</f7-button>
          <f7-button v-else-if="!source.mine" round large class="sec-block" @click="blockSource(source.group)">{{ ct('封鎖這個 IP 24 小時') }}</f7-button>
          <p v-else class="sec-note">{{ ct('這是你目前使用的網路，不能封鎖。') }}</p>
        </f7-block>
      </template>
    </f7-page></f7-view></f7-popup>
  </f7-page>
</template>

<script setup>
import { computed, ref } from 'vue';
import { f7 } from 'framework7-vue';
import { t, lang } from '../js/i18n.js';
import { ct } from '../js/agent-i18n.js';
import { api } from '../js/auth.js';
import { describeAgent } from '../js/qrLogin.js';
import { sheetSwipe } from '../js/sheetSwipe.js';

const data = ref(null), error = ref(''), filter = ref('all'), source = ref(null);
const filters = [{ id: 'all', label: '全部' }, { id: 'fail', label: '失敗' }, { id: 'block', label: '封鎖' }, { id: 'qr', label: '掃碼' }];
const today = computed(() => data.value?.days.at(-1) || { ok: 0, fail: 0, locked: 0, blocked: 0, guards: { unauth: 0, rate: 0, refused: 0 } });
const most = computed(() => Math.max(1, ...(data.value?.days || []).map((d) => d.ok + d.fail + d.locked + d.blocked)));
const h = (n) => (n ? Math.max(3, Math.round(n / most.value * 60)) + 'px' : '0');

async function load() {
  try { data.value = await api(`/admin/security?filter=${filter.value}`);error.value = ''; } catch (e) { error.value = e.message; }
}
async function refresh(done) { try { await load(); } finally { done(); } }
function setFilter(id) { filter.value = id;load(); }

async function openSource(group) {
  try { source.value = await api(`/admin/security/source?group=${encodeURIComponent(group)}`); } catch (e) { f7.dialog.alert(e.message); }
}
function unblock(group) {
  f7.dialog.confirm(ct('這個 IP 可以再用密碼登入。'), ct('解除封鎖'), async () => {
    try { await api(`/admin/security/blocks?group=${encodeURIComponent(group)}`, { method: 'DELETE' });await load();if (source.value?.group === group) await openSource(group); } catch (e) { f7.dialog.alert(e.message); }
  });
}
function releaseAccount(name) {
  f7.dialog.confirm(ct('任何 IP 都可以再用密碼登入這個帳號。'), ct('解除帳號保護'), async () => {
    try { await api(`/admin/security/accounts?name=${encodeURIComponent(name)}`, { method: 'DELETE' });await load(); } catch (e) { f7.dialog.alert(e.message); }
  });
}
function blockSource(group) {
  f7.dialog.confirm(ct('24 小時內這個 IP 不能用密碼登入。'), ct('封鎖這個 IP 24 小時'), async () => {
    try { await api('/admin/security/blocks', { method: 'POST', body: JSON.stringify({ ip: group, hours: 24 }) });await load();await openSource(group); } catch (e) { f7.dialog.alert(e.message); }
  });
}

// A two-letter country as its flag, and its name.
const flag = (c) => (/^[A-Z]{2}$/.test(c || '') ? String.fromCodePoint(...[...c].map((x) => 0x1F1E6 + x.charCodeAt(0) - 65)) : '🌐');
function countryName(c) {
  if (!c) return '';
  try { return new Intl.DisplayNames([lang.value === 'en' ? 'en' : 'zh-Hant-TW'], { type: 'region' }).of(c); } catch { return c; }
}
// An IPv6 address counts by its /64, and is shown so.
const label = (g) => (String(g).includes(':') ? `${g}::/64` : g);
const place = (s) => [countryName(s.country), s.city].filter(Boolean).join(' ');
function timeText(ts) {
  const d = new Date(ts), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function blockFooter(b) {
  return `${b.auto ? ct('自動') : ct('手動')} · ${ct('封鎖到')} ${timeText(b.until)}${b.strikes ? ` · ${ct('第')} ${b.strikes} ${ct('次')}` : ''}`;
}
function sourceFooter(s) {
  return [countryName(s.country), `${s.fails} ${ct('次失敗')}`, s.usernames.length ? `${ct('試過')} ${s.usernames.join('、')}` : ''].filter(Boolean).join(' · ');
}
const REASONS = { 'no-such-user': '帳號不存在', 'wrong-password': '密碼錯誤', 'wrong-code': '驗證碼錯誤', inactive: '帳號停用', passkey: '通行密鑰驗證失敗', blocked: '封鎖中被擋下', 'codes-spent': '當天驗證碼次數已用完', account: '帳號保護中被擋下' };
const TWO_STEP = { on: '開啟兩步驟驗證', off: '關閉兩步驟驗證', reset: '重設兩步驟驗證' };
const QR = { bind: '綁定手機', unbind: '解除手機', approve: '手機核准', deny: '手機拒絕', 'wrong-code': '選錯數字', 'wrong-account': '帳號不符', 'signed-in': '掃碼登入' };
function eventTitle(e) {
  if (e.kind === 'login') return (e.username || ct('（沒有帳號）')) + (e.method === 'bind' ? ` · ${ct('綁定手機')}` : e.method === 'change-password' ? ` · ${ct('修改密碼')}` : e.method === 'admin-grant' ? ` · ${ct('管理員再次確認')}` : e.method === 'passkey' ? ` · ${ct('通行密鑰')}` : String(e.method).startsWith('two-step') ? ` · ${ct('兩步驟驗證')}` : '');
  if (e.kind === 'account') return `${e.action === 'protect' ? ct('帳號進入保護') : ct('解除帳號保護')} ${e.name}`;
  if (e.kind === 'two-step') return ct(TWO_STEP[e.action] || e.action);
  if (e.kind === 'passkey') return e.action === 'add' ? ct('建立通行密鑰') : ct('刪除通行密鑰');
  if (e.kind === 'qr') return ct(QR[e.action] || e.action);
  if (e.kind === 'block') return e.action === 'block' ? `${ct('手動封鎖')} ${label(e.group)}` : `${ct('解除封鎖')} ${label(e.group)}`;
  return e.kind;
}
function eventFooter(e) {
  const bits = [timeText(e.ts)];
  if (e.ip) bits.push(`${flag(e.country)} ${e.ip}`);
  if (e.kind === 'login' && e.reason) bits.push(ct(REASONS[e.reason] || e.reason));
  if (e.times > 1) bits.push(`${e.times} ${ct('次')}${e.lastTs ? `，${ct('最後')} ${timeText(e.lastTs)}` : ''}`);
  if (e.kind === 'login' && e.outcome === 'ok' && e.ua) bits.push(describeAgent(e.ua));
  if (e.by) bits.push(e.by);
  return bits.join(' · ');
}
function eventTag(e) {
  if (e.kind === 'login') return { ok: { text: ct('成功'), tone: 'green' }, fail: { text: ct('失敗'), tone: 'red' }, locked: { text: ct('封鎖'), tone: 'orange' }, blocked: { text: ct('擋下'), tone: 'orange' } }[e.outcome] || { text: e.outcome, tone: '' };
  if (e.kind === 'qr') return { text: ct('掃碼'), tone: e.action === 'wrong-code' || e.action === 'wrong-account' || e.action === 'deny' ? 'red' : 'green' };
  if (e.kind === 'passkey') return { text: ct('通行密鑰'), tone: 'green' };
  if (e.kind === 'two-step') return { text: ct('兩步驟'), tone: e.action === 'on' ? 'green' : 'orange' };
  if (e.kind === 'account') return { text: ct('保護'), tone: 'orange' };
  return { text: ct('封鎖'), tone: 'orange' };
}
function signTitle(s) {
  return { burst: ct('短時間大量嘗試'), guessing: ct('試了不存在的帳號'), 'new-country': ct('沒登入過的國家') }[s.sign] || s.sign;
}
function signFooter(s) {
  if (s.sign === 'burst') return `${ct('10 次失敗只花了')} ${s.minutes} ${ct('分鐘，像是自動程式')}`;
  if (s.sign === 'guessing') return `${s.usernames.join('、')}：${ct('在猜帳號')}`;
  if (s.sign === 'new-country') return `${ct('過去 180 天沒有從這裡成功登入過')}：${countryName(s.country)}`;
  return '';
}
</script>

<style>
.sec-card {padding:14px 8px 10px;background:var(--f7-list-strong-bg-color,var(--f7-list-bg-color,#1f1f21));border-radius:var(--f7-list-inset-border-radius,18px);}
.sec-stats {display:grid;grid-template-columns:repeat(3,1fr);text-align:center;}
.sec-stats b {display:block;font-size:24px;}
.sec-stats span {font-size:12px;color:var(--cc-color-text-secondary,#8e8e93);}
.sec-bars {display:flex;gap:6px;align-items:flex-end;height:64px;padding:12px 8px 6px;}
.sec-bar {flex:1;display:flex;flex-direction:column-reverse;gap:2px;}
.sec-bar i {display:block;border-radius:3px;}
.sec-days,.sec-legend {display:flex;gap:6px;padding:0 8px;font-size:10px;color:var(--cc-color-text-secondary,#8e8e93);}
.sec-days span {flex:1;text-align:center;}
.sec-legend {gap:14px;padding-top:8px;font-size:11px;}
.sec-legend i {display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;}
.sec-card .green,.sec-legend .green {background:#30d158;}
.sec-card .red,.sec-legend .red {background:#ff453a;}
.sec-card .orange,.sec-legend .orange {background:#ff9f0a;}
.sec-stats b.red {background:none;color:#ff453a;}
.sec-stats b.orange {background:none;color:#ff9f0a;}
.sec-note {font-size:12px;color:var(--cc-color-text-secondary,#8e8e93);margin:8px 32px;}
.sec-error {color:#ff453a;}
.sec-empty {color:var(--cc-color-text-secondary,#8e8e93);font-size:14px;}
.sec-flag {font-size:22px;}
.sec-tag {font-size:12px;padding:3px 8px;border-radius:10px;white-space:nowrap;}
.sec-tag.red {background:rgba(255,69,58,.18);color:#ff453a;}
.sec-tag.orange {background:rgba(255,159,10,.18);color:#ff9f0a;}
.sec-tag.green {background:rgba(48,209,88,.18);color:#30d158;}
.sec-unblock {color:#0a84ff;}
.sec-seg {display:flex;margin:0 16px 10px;background:rgba(120,120,128,.24);border-radius:10px;padding:2px;max-width:min(828px,calc(100% - 32px));box-sizing:border-box;}
@media (min-width:1024px){.sec-seg,.page-large-static .sec-card{max-width:min(828px,calc(100% - 32px));margin-left:auto;margin-right:auto;box-sizing:border-box;}.sec-note{max-width:min(828px,calc(100% - 32px));margin:8px auto;padding:0 16px;box-sizing:border-box;}}
.sec-seg button {flex:1;border:0;background:none;color:var(--cc-color-text-secondary,#8e8e93);padding:7px;font-size:13px;border-radius:8px;}
.sec-seg button.on {background:rgba(120,120,128,.5);color:var(--f7-text-color,#fff);}
.sec-source-head .sec-ip {font-family:ui-monospace,Menlo,monospace;font-size:20px;font-weight:700;word-break:break-all;}
.sec-source-head .sec-where {font-size:13px;color:var(--cc-color-text-secondary,#8e8e93);margin-top:4px;}
.sec-block {color:#ff453a;background:rgba(255,69,58,.15);}
.sec-lift {color:#0a84ff;}
.sec-recent .item-title,.sec-sources .item-title,.sec-blocks .item-title {font-variant-numeric:tabular-nums;}
</style>
