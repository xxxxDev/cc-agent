<template>
  <!-- One diagnostics report, laid out as a scope report (AccessReportDetailPage.vue): who
       sent it, for which agent, when, from which build, and the text as sent, to copy, mark
       handled, delete or hand to one of the admin's agents. -->
  <f7-page name="diagnostic-report" @page:init="load">
    <f7-navbar :title="ct('診斷回報')" back-link="Back" back-link-url="/diagnostic-reports/" :back-link-force="true" />

    <div class="page-col-medium detail-wrap">
      <f7-block v-if="loading" class="detail-state"><f7-preloader /></f7-block>
      <f7-block v-else-if="error" class="detail-state detail-error">{{ error }}</f7-block>

      <template v-else-if="r">
        <section class="detail-hero">
          <i class="f7-icons detail-icon" :class="open ? 'report-open' : 'report-handled'">{{ open ? 'doc_text_search' : 'checkmark_seal_fill' }}</i>
          <div>
            <h2>{{ open ? ct('未處理') : ct('已處理') }}</h2>
            <p>{{ r.agentTitle || 'Agent' }} · {{ r.fromName || ct('已刪除的使用者') }}</p>
          </div>
        </section>

        <section class="detail-card">
          <dl>
            <div><dt>{{ ct('使用者') }}</dt><dd>{{ r.fromName || ct('已刪除的使用者') }}</dd></div>
            <div><dt>Agent</dt><dd>{{ r.agentTitle || 'Agent' }}</dd></div>
            <div><dt>{{ ct('時間') }}</dt><dd>{{ reportTime(r.at) }}</dd></div>
            <div><dt>Build</dt><dd class="mono">{{ r.build }}</dd></div>
            <div v-if="!open"><dt>{{ ct('處理者') }}</dt><dd>{{ r.handledBy }} · {{ reportTime(r.handledAt) }}</dd></div>
          </dl>
        </section>

        <section class="detail-card action-card">
          <f7-button class="diagnostic-hand" fill round large :disabled="busy" @click="pickAgent">{{ ct('交給 agent') }}</f7-button>
          <f7-button class="diagnostic-copy" round large @click="copy">{{ ct(copied ? '已複製' : '複製') }}</f7-button>
          <f7-button class="diagnostic-mark" round large :disabled="busy" @click="mark(open ? 'handled' : 'open')">{{ open ? ct('標為已處理') : ct('重新開啟') }}</f7-button>
          <f7-button class="diagnostic-delete color-red" round large :disabled="busy" @click="remove">{{ ct('刪除') }}</f7-button>
        </section>

        <section class="detail-card">
          <h3>{{ ct('診斷資訊') }}</h3>
          <pre class="diagnostic-full">{{ r.text }}</pre>
        </section>
      </template>
    </div>
    <GlassDropdown :open="pickOpen" :point="pickPoint" :items="agentItems" @close="pickOpen = false" @select="handTo" />
  </f7-page>
</template>

<script setup>
import { computed, inject, ref } from 'vue';
import { f7 } from 'framework7-vue';
import { api } from '../js/api.js';
import { ct } from '../js/agent-i18n.js';
import { lang } from '../js/i18n.js';
import { reportTime } from '../js/access-reports.js';
import GlassDropdown from '../components/GlassDropdown.vue';
import { handOffName, handOffTargets, handOffText } from '../js/diagnosticHandOff.js';

const props = defineProps({ f7route: { type: Object, default: () => ({}) } });
const id = props.f7route?.query?.id || '';
const workspace = inject('workspace', null);
const r = ref(null);
const loading = ref(false);
const error = ref('');
const busy = ref(false);
const copied = ref(false);
const open = computed(() => r.value?.status === 'open');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    r.value = await api(`/diagnostic-reports/${encodeURIComponent(id)}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function mark(status) {
  busy.value = true;
  try {
    r.value = await api(`/diagnostic-reports/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) });
  } catch (e) {
    f7.dialog.alert(e.message);
  } finally {
    busy.value = false;
  }
}
// Removed for good, asked first: there is no Trash for these.
function remove() {
  f7.dialog.confirm(ct('刪除後無法復原。'), ct('刪除這份診斷回報？'), async () => {
    busy.value = true;
    try {
      await api(`/diagnostic-reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
      f7.views.get('#view-admin').router.back('/diagnostic-reports/', { force: true });
    } catch (e) {
      f7.dialog.alert(e.message);
    } finally {
      busy.value = false;
    }
  });
}
async function copy() {
  copied.value = false;
  try {
    await navigator.clipboard.writeText(r.value?.text || '');
    copied.value = true;
  } catch {
    f7.dialog.alert(ct('無法自動複製，請選取下方文字複製。'));
  }
}
// One of the admin's own agents that may take it (diagnosticHandOff.js): that conversation
// opens with the report in its box as a .txt file, for the admin to send with a message
// (agent-chat.js handToAgent). A full-access agent is asked about first: the report is the
// sender's words, and that agent can act on this computer.
const pickOpen = ref(false);
const pickPoint = ref({ clientX: 0, clientY: 0 });
const targets = () => handOffTargets(workspace?.conversations?.value);
const agentItems = computed(() => targets().map((c) => ({ value: c.id, label: c.title || 'Agent' })));
function pickAgent(event) {
  if (!agentItems.value.length) { f7.dialog.alert(ct('還沒有 Agent')); return; }
  const box = event?.currentTarget?.getBoundingClientRect?.();
  pickPoint.value = box ? { clientX: box.left + box.width / 2, clientY: box.bottom } : { clientX: event?.clientX ?? 0, clientY: event?.clientY ?? 0 };
  pickOpen.value = true;
}
function handTo(agentId) {
  pickOpen.value = false;
  const report = r.value;
  // Checked again on the list as it is now: an agent opened to outside people since stays out.
  const target = targets().find((c) => c.id === agentId);
  if (!report || !target || !workspace?.handToAgent) return;
  const send = () => workspace.handToAgent(agentId, [new File([handOffText(report, lang.value)], handOffName(report), { type: 'text/plain' })]);
  if (!target.access?.full) return send();
  // The dialogs show plain text (safeDialog.js); a function, so a $ in the name stays as it is.
  const who = String(report.fromName || ct('已刪除的使用者')).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ');
  f7.dialog.confirm(ct('這份回報是 {name} 寫的內容，會交給有完整權限的 agent，確定嗎？').replace('{name}', () => who), ct('交給 agent'), send);
}
</script>

<style scoped>
.detail-wrap { padding: 0 16px 28px; }
.detail-state { min-height: 180px; display: flex; align-items: center; justify-content: center; }
.detail-error { color: #ff453a; }
.detail-hero { display: flex; align-items: center; gap: 16px; padding: 18px 4px 22px; }
.detail-icon { font-size: 50px; }
.detail-hero h2 { margin: 0; font-size: 24px; }
.detail-hero p { margin: 5px 0 0; opacity: 0.6; }
.detail-card {
  margin-bottom: 14px; padding: 8px 16px; border-radius: 20px; background: rgba(127, 127, 127, 0.12);
  box-shadow: rgba(255, 255, 255, 0.4) 2px 2px 2px -2px inset, rgba(255, 255, 255, 0.4) -2px -2px 2px -2px inset;
}
.detail-card h3 { margin: 10px 0 4px; font-size: 17px; }
.detail-card dl { margin: 0; }
.detail-card dl > div { display: grid; grid-template-columns: minmax(90px, 0.8fr) minmax(0, 1.6fr); gap: 14px; padding: 12px 0; border-bottom: 1px solid rgba(127, 127, 127, 0.18); }
.detail-card dl > div:last-child { border-bottom: 0; }
.detail-card dt { opacity: 0.55; }
.detail-card dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
.action-card { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.diagnostic-full { margin: 6px 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.5; max-height: 60vh; overflow: auto; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.report-open { color: #ff9f0a; }
.report-handled { color: #30d158; }
</style>
