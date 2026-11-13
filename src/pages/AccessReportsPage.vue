<template>
  <f7-page name="access-reports" class="page-large-static" ptr :ptr-mousewheel="true" @ptr:refresh="refresh" @page:afterin="load">
    <f7-navbar large>
      <f7-nav-left :back-link="true"></f7-nav-left>
      <f7-nav-title sliding>{{ ct('範圍報告單') }}</f7-nav-title>
      <f7-nav-title-large>{{ ct('範圍報告單') }}</f7-nav-title-large>
    </f7-navbar>

    <f7-block-footer>{{ ct('Agent 碰到範圍外的動作時會被擋下，並在這裡開一張報告單。可以略過，或替那個 Agent 開通。Agent 的說明只是標記，報告單一律等管理員處理。') }}</f7-block-footer>

    <div class="page-col-medium">
      <!-- 待處理: what still needs an admin. 紀錄: everything, so an agent's scope or habits
           can be looked at later. -->
      <div class="report-views">
        <f7-segmented strong tag="div">
          <f7-button :active="view === 'open'" class="report-view-open" @click="view = 'open'">{{ ct('待處理') }}<span v-if="openCount"> {{ openCount }}</span></f7-button>
          <f7-button :active="view === 'all'" class="report-view-all" @click="view = 'all'">{{ ct('紀錄') }}</f7-button>
        </f7-segmented>
      </div>
      <div class="report-filters">
        <label>
          <span>Agent</span>
          <select v-model="agent" class="report-agent">
            <option value="">{{ ct('全部 Agent') }}</option>
            <option v-for="a in agentChoices" :key="a.id" :value="a.id">{{ agentOption(a) }}</option>
          </select>
        </label>
      </div>
      <!-- Every open report the agent says it no longer needs, of the agent picked or all, after
           a confirmation; each is dismissed and audited as a dismissal of its own. -->
      <div v-if="view === 'open' && notNeededCount" class="report-bulk">
        <f7-button small round tonal class="report-dismiss-not-needed" :disabled="bulkBusy" @click="dismissNotNeeded">{{ ct('略過所有標為不需要的') }} ({{ notNeededCount }})</f7-button>
      </div>
      <!-- The ones an upgrade reopened from an agent's old self-resolve, of the agent picked or
           all, after a confirmation listing each. -->
      <div v-if="view === 'open' && formerList.length" class="report-bulk">
        <f7-button small round tonal class="report-dismiss-former" :disabled="bulkBusy" @click="dismissFormer">{{ ct('略過所有原本標為已自行解決的') }} ({{ formerList.length }})</f7-button>
      </div>
      <div v-if="summaries.length" class="report-summaries">
        <button v-for="a in summaries" :key="a.id" type="button" class="report-summary" :data-agent-id="a.id" @click="agent = agent === a.id ? '' : a.id">
          <strong>{{ a.title }}<small v-if="a.ownerName"> · {{ plain(a.ownerName) }}</small></strong>
          <span class="report-counts">{{ summaryCounts(a) }}</span>
          <span v-if="a.top.length" class="report-habits">{{ labelled(ct('最常碰到'), listJoin(a.top.map((t) => t.name + ' ×' + t.n))) }}</span>
        </button>
      </div>

      <f7-block v-if="loading && !reports.length" class="report-state"><f7-preloader /></f7-block>
      <f7-block v-else-if="error" class="report-state report-error">{{ error }}</f7-block>
      <f7-block v-else-if="!shown.length" class="report-state report-muted">{{ ct('目前沒有報告單') }}</f7-block>

      <div v-else class="report-cards">
        <button v-for="r in shown" :key="r.id" type="button" class="report-card" @click="open(r)">
          <div class="report-card-head">
            <i class="f7-icons report-icon" :class="reportMeta(r).cls">{{ reportMeta(r).icon }}</i>
            <div class="report-card-title">
              <strong>{{ plain(r.agentTitle || r.title) }}</strong>
              <span>{{ plain(r.ownerName) }} · {{ reportTime(r.at) }}</span>
            </div>
            <span class="report-status" :class="reportMeta(r).cls">{{ reportMeta(r).label }}</span>
          </div>
          <div class="report-card-lines">
            <div v-if="isNotice(r)">🔁 {{ digestLine(r) }}</div>
            <div v-else>🛠 {{ plain(r.tool) || ct('未知工具') }}：{{ excerpt(r.detail) }}</div>
            <div v-if="r.error">⛔ {{ excerpt(r.error) }}</div>
            <!-- More refused in the same turn than were filed: how many, and their first lines. -->
            <div v-if="r.overflow?.count" class="report-overflow">➕ {{ labelled(ct('同一輪另有'), `${r.overflow.count} ${ct('次')}`) }}<span v-for="(line, i) in overflowLines(r.overflow).slice(0, 5)" :key="i" class="report-overflow-line">{{ excerpt(line, 100) }}</span><span v-if="overflowLines(r.overflow).length > 5" class="report-overflow-line">…</span></div>
            <div v-if="r.messageExcerpt">💬 {{ excerpt(r.messageExcerpt, 80) }}</div>
            <div v-if="r.explanation" class="report-reason">🗣 {{ excerpt(r.explanation.why, 100) }}</div>
            <div v-if="notNeeded(r)" class="report-not-needed">{{ ct('Agent 說不需要') }}</div>
            <div v-if="r.formerlySelfResolved" class="report-former">{{ ct('原本標為 Agent 已自行解決，已改回待處理') }}</div>
          </div>
          <div class="report-card-foot">
            <span>{{ reportKind(r) }}</span>
            <span>{{ ct('第') }} {{ r.generation }} {{ ct('代') }}</span>
            <i class="f7-icons">chevron_right</i>
          </div>
        </button>
      </div>
    </div>
  </f7-page>
</template>

<script setup>
import { computed, ref } from 'vue';
import { f7 } from 'framework7-vue';
import { api } from '../js/api.js';
import { ct, labelled, listJoin } from '../js/agent-i18n.js';
import { isNotice, reportMeta, reportKind, reportTime, excerpt, agentSummaries, digestLine, agentOption, summaryCounts, notNeeded, plain, escapeHtml, overflowLines } from '../js/access-reports.js';

const props = defineProps({ f7route: { type: Object, default: () => ({}) } });
const reports = ref([]);
const loading = ref(false);
const error = ref('');
// Opened for one agent (its profile's link), the record of that agent.
const agent = ref(props.f7route?.query?.agent || '');
const view = ref(agent.value ? 'all' : 'open');
const openCount = computed(() => reports.value.filter((r) => r.status === 'open').length);
const inView = computed(() => reports.value.filter((r) => view.value === 'all' || r.status === 'open'));
// Opened from the profile of an agent with no reports yet: still that agent, by the name the
// link carried, with none to show.
const agentChoices = computed(() => {
  const list = agentSummaries(reports.value);
  if (agent.value && !list.some((a) => a.id === agent.value)) list.push({id: agent.value, title: props.f7route?.query?.title || 'Agent', total: 0});
  return list.sort((a, b) => a.title.localeCompare(b.title));
});
const summaries = computed(() => agentSummaries(inView.value).filter((a) => !agent.value || a.id === agent.value));
const shown = computed(() => inView.value.filter((r) => !agent.value || r.conversationId === agent.value));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    reports.value = (await api('/access-reports')).reports || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function refresh(done) {
  await load();
  done();
}
// The ones the admin sees and dismisses: open, labelled not needed, of the agent picked or all,
// as the server allows them (bulkDismissable: no CC Agent notice, none an admin reopened, none
// reopened from an old self-resolve), and none of an agent that talks to people outside
// (outsiders could steer its label); those are counted apart and stay for one by one. The
// confirmation lists every one, by agent, tool and first line, and what is sent is exactly
// those, each with the time of the label it showed.
const bulkPool = computed(() => reports.value.filter((r) => r.bulkDismissable && notNeeded(r) && (!agent.value || r.conversationId === agent.value)));
const bulkList = computed(() => bulkPool.value.filter((r) => !r.outsideFacing));
const notNeededCount = computed(() => bulkList.value.length);
const bulkBusy = ref(false);
// A confirmation listing every report to be dismissed, by agent, tool and first line, then the
// request with exactly those.
function confirmBulk(title, intro, list, extra, path, body) {
  const name = (r) => plain(r.agentTitle || r.title) || 'Agent';
  const by = new Map();
  for (const r of list) by.set(name(r), (by.get(name(r)) || 0) + 1);
  const counts = [...by].map(([n, k]) => `<div>${escapeHtml(labelled(n, String(k)))}</div>`).join('');
  const lines = list.map((r) => `<li>${escapeHtml(name(r))} · ${escapeHtml(plain(r.tool) || ct('未知工具'))} ${escapeHtml(excerpt(reportFirstLine(r), 120))}</li>`).join('');
  const dialog = f7.dialog.create({
    title: escapeHtml(title),
    content: `<div class="dialog-text">${escapeHtml(intro)}</div>${counts}${extra}<ol class="bulk-dismiss-list">${lines}</ol>`,
    buttons: [{text: escapeHtml(ct('取消'))}, {text: escapeHtml(ct('略過')), bold: true, onClick: async () => {
      bulkBusy.value = true;
      try {
        await api(path, {method: 'POST', body: JSON.stringify(body)});
        await load();
      } catch (e) {
        f7.dialog.alert(e.message);
      } finally {
        bulkBusy.value = false;
      }
    }}],
  });
  dialog.open();
}
function dismissNotNeeded() {
  const list = bulkList.value, left = bulkPool.value.length - list.length;
  confirmBulk(ct('略過所有標為不需要的'), ct('略過這些 Agent 說不需要的報告單？每一張都會記錄為你略過的。'), list, left ? `<div>${escapeHtml(labelled(ct('對外的 Agent 不包含在內'), String(left)))}</div>` : '', '/access-reports/dismiss-not-needed', {items: list.map((r) => ({id: r.id, labelAt: r.explanation.at}))});
}
// Reopened from an agent's old self-resolve (formerBulk, as the server allows them).
const formerList = computed(() => reports.value.filter((r) => r.formerBulk && (!agent.value || r.conversationId === agent.value)));
function dismissFormer() {
  const list = formerList.value;
  confirmBulk(ct('略過所有原本標為已自行解決的'), ct('略過這些原本標為 Agent 已自行解決、升級後改回待處理的報告單？每一張都會記錄為你略過的。'), list, '', '/access-reports/dismiss-formerly-self-resolved', {ids: list.map((r) => r.id)});
}
// What a report tried, in one line: the command, the file or the address, or its description.
function reportFirstLine(r) {
  const text = String(r.detail || '');
  const field = r.kind !== 'permission' && /"(command|file_path|url|path|pattern)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (field) { try { return JSON.parse('"' + field[2] + '"'); } catch { return field[2]; } }
  return text.split('\n').find((l) => l.trim()) || '';
}
function open(r) {
  f7.views.get('#view-admin').router.navigate(`/access-report/?id=${encodeURIComponent(r.id)}`);
}
</script>

<style scoped>
.report-views { padding: 0 16px 12px; }
.report-bulk { padding: 0 16px 14px; }
.report-not-needed { color: #64d2ff; }
.report-former { opacity: 0.6; font-size: 12px; }
.report-overflow { display: flex; flex-direction: column; }
.report-overflow-line { padding-left: 1.4em; opacity: 0.75; font-size: 12px; }
:global(.bulk-dismiss-list) { max-height: 40vh; overflow: auto; margin: 8px 0 0; padding-left: 20px; text-align: left; font-size: 12px; overflow-wrap: anywhere; }
.report-summaries { display: flex; flex-direction: column; gap: 8px; padding: 0 16px 14px; }
.report-summary { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 11px 14px; border: 0; border-radius: 16px; color: inherit; text-align: left; background: rgba(127, 127, 127, 0.1); font: inherit; }
.report-summary small { font-weight: 400; opacity: 0.6; }
.report-counts, .report-habits { font-size: 12px; opacity: 0.7; overflow-wrap: anywhere; }
.report-filters { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 0 16px 14px; }
.report-filters label { display: flex; flex-direction: column; gap: 5px; color: var(--f7-block-footer-text-color, rgba(255, 255, 255, 0.58)); font-size: 12px; }
.report-filters select { width: 100%; min-height: 42px; padding: 0 12px; border: 0; border-radius: 13px; color: inherit; background: rgba(127, 127, 127, 0.16); font: inherit; font-size: 14px; }
.report-state { min-height: 140px; display: flex; align-items: center; justify-content: center; }
.report-error { color: #ff453a; }
.report-muted { opacity: 0.6; }
.report-cards { display: flex; flex-direction: column; gap: 12px; padding: 0 16px 24px; }
.report-card {
  width: 100%; padding: 15px 16px; border: 0; border-radius: 20px; color: inherit; text-align: left;
  background: rgba(127, 127, 127, 0.12);
  box-shadow: rgba(255, 255, 255, 0.4) 2px 2px 2px -2px inset, rgba(255, 255, 255, 0.4) -2px -2px 2px -2px inset;
}
.report-card-head { display: flex; align-items: center; gap: 11px; }
.report-icon { font-size: 32px; }
.report-card-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.report-card-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.report-card-title span { opacity: 0.55; font-size: 13px; }
.report-status { padding: 4px 8px; border-radius: 10px; background: rgba(127, 127, 127, 0.14); font-size: 11px; font-weight: 700; white-space: nowrap; }
.report-open { color: #ff9f0a; }
.report-granted { color: #30d158; }
.report-dismissed { color: #8e8e93; }
.report-card-lines { margin-top: 12px; font-size: 13px; line-height: 1.7; opacity: 0.85; overflow-wrap: anywhere; }
.report-card-foot { display: flex; gap: 12px; align-items: center; margin-top: 10px; opacity: 0.55; font-size: 12px; }
.report-card-foot .f7-icons { margin-left: auto; font-size: 15px; }
</style>
