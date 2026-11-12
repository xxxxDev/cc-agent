<template>
  <f7-page name="access-report" @page:init="load">
    <f7-navbar :title="ct('報告單')" back-link="Back" back-link-url="/access-reports/" :back-link-force="true" />

    <div class="page-col-medium detail-wrap">
      <f7-block v-if="loading" class="detail-state"><f7-preloader /></f7-block>
      <f7-block v-else-if="error" class="detail-state detail-error">{{ error }}</f7-block>

      <template v-else-if="r">
        <section class="detail-hero">
          <i class="f7-icons detail-icon" :class="meta.cls">{{ meta.icon }}</i>
          <div>
            <h2>{{ meta.label }}</h2>
            <p>{{ r.agentTitle }} · {{ r.ownerName }}</p>
          </div>
        </section>

        <section class="detail-explanation" :class="meta.cls">
          <span>{{ reportKind(r) }}</span>
          <h3 v-if="r.kind === 'digest'">{{ digestLine(r) }}</h3>
          <template v-else>
            <h3>{{ r.tool || ct('未知工具') }}</h3>
            <p class="mono">{{ r.detail }}</p>
          </template>
          <p v-if="r.error" class="mono detail-refusal">{{ r.error }}</p>
        </section>

        <!-- The agent's own word (explain_report), or what it wrote just before the call. -->
        <section v-if="r.explanation" class="detail-card agent-reason">
          <h3>{{ ct('Agent 說明') }}<small v-if="r.explanationCount > 1"> · {{ ct('共') }} {{ r.explanationCount }} {{ ct('次') }}</small></h3>
          <dl>
            <div><dt>{{ ct('為什麼') }}</dt><dd>{{ r.explanation.why }}</dd></div>
            <div v-if="r.explanation.instead"><dt>{{ ct('改用') }}</dt><dd>{{ r.explanation.instead }}</dd></div>
            <div><dt>{{ ct('仍需要') }}</dt><dd>{{ r.explanation.stillNeeded ? ct('是') : ct('否，已自行解決') }}</dd></div>
          </dl>
          <!-- What it said before, shortened, newest last (explain_report keeps a few). -->
          <ol v-if="r.explanationHistory?.length" class="earlier-reasons">
            <li v-for="(e, i) in r.explanationHistory" :key="i">{{ reportTime(e.at) }} · {{ e.stillNeeded ? ct('仍需要') : ct('自行解決') }} · {{ e.why }}</li>
          </ol>
        </section>
        <section v-else-if="r.agentWords" class="detail-card agent-reason">
          <h3>{{ ct('Agent 當時寫的') }}</h3>
          <p>{{ r.agentWords }}</p>
        </section>

        <section class="detail-card">
          <h3>{{ ct('情境') }}</h3>
          <dl>
            <div><dt>{{ ct('使用者') }}</dt><dd>{{ r.ownerName }}</dd></div>
            <div><dt>Agent</dt><dd>{{ r.agentTitle }}<template v-if="r.agentArchived"> {{ ct('（已封存）') }}</template></dd></div>
            <div><dt>{{ ct('第幾代') }}</dt><dd>{{ r.generation }}</dd></div>
            <div><dt>{{ ct('時間') }}</dt><dd>{{ reportTime(r.at) }}</dd></div>
            <div v-if="r.messageExcerpt"><dt>{{ ct('當時的對話') }}</dt><dd>{{ r.messageExcerpt }}</dd></div>
          </dl>
        </section>

        <section class="detail-card">
          <h3>{{ ct('這個 Agent 目前的範圍') }}</h3>
          <f7-link class="scope-edit-link" @click="editScope">{{ ct('調整或收回範圍…') }}</f7-link>
          <dl>
            <div><dt>{{ ct('允許的資料夾') }}</dt><dd class="mono">{{ listOrNone(r.access?.allow) || ct('只有工作區') }}</dd></div>
            <div><dt>{{ ct('排除的資料夾') }}</dt><dd class="mono">{{ listOrNone(r.access?.exclude) || ct('無') }}</dd></div>
            <div><dt>{{ ct('允許的網站') }}</dt><dd class="mono">{{ listOrNone(r.access?.domains) || ct('無') }}</dd></div>
          </dl>
        </section>

        <section v-if="r.status === 'open'" class="detail-card action-card">
          <h3>{{ ct('處理') }}</h3>
          <p v-if="r.suggestion && r.kind !== 'digest'" class="suggestion">
            {{ r.suggestion.type === 'website' ? ct('建議開通的網站') : ct('建議開通的資料夾') }}：<code>{{ r.suggestion.value }}</code>
          </p>
          <p class="action-note">{{ ct('開通後這個 Agent 會重新連線，之後就能使用這個範圍。') }}</p>
          <!-- The suggested kind is the filled button; the other stays available. -->
          <template v-if="r.kind !== 'digest'">
            <f7-button :fill="r.suggestion?.type !== 'website'" round large :disabled="busy || r.agentArchived" @click="grant('folder')">{{ ct('開通資料夾…') }}</f7-button>
            <f7-button :fill="r.suggestion?.type === 'website'" round large :disabled="busy || r.agentArchived" @click="grant('website')">{{ ct('開通網站…') }}</f7-button>
          </template>
          <f7-button round large :disabled="busy" @click="resolve('dismissed')">{{ ct('略過') }}</f7-button>
        </section>

        <section v-else class="detail-card">
          <h3>{{ ct('處理結果') }}</h3>
          <dl>
            <div><dt>{{ ct('結果') }}</dt><dd>{{ meta.label }}</dd></div>
            <div v-if="r.granted"><dt>{{ ct('開通內容') }}</dt><dd class="mono">{{ r.granted.folder || r.granted.website }}</dd></div>
            <div v-if="r.resolvedBy"><dt>{{ ct('處理者') }}</dt><dd>{{ r.resolvedBy }}</dd></div>
            <div v-if="r.resolvedAt"><dt>{{ ct('處理時間') }}</dt><dd>{{ reportTime(r.resolvedAt) }}</dd></div>
          </dl>
          <f7-button round :disabled="busy" @click="resolve('reopen')">{{ ct('重新開啟') }}</f7-button>
        </section>

        <details class="technical-card">
          <summary>{{ ct('技術資訊') }}</summary>
          <dl>
            <div><dt>{{ ct('報告單') }}</dt><dd class="mono">{{ r.id }}</dd></div>
            <div><dt>Session</dt><dd class="mono">{{ r.sessionId }}</dd></div>
            <div v-if="r.messageId"><dt>{{ ct('訊息') }}</dt><dd class="mono">{{ r.messageId }}</dd></div>
          </dl>
        </details>
      </template>
    </div>
  </f7-page>
</template>

<script setup>
import { computed, ref } from 'vue';
import { f7 } from 'framework7-vue';
import { api } from '../js/api.js';
import { ct } from '../js/agent-i18n.js';
import { reportMeta, reportKind, reportTime, listOrNone, digestLine } from '../js/access-reports.js';

const props = defineProps({ f7route: { type: Object, default: () => ({}) } });
const id = props.f7route?.query?.id || '';
const r = ref(null);
const loading = ref(false);
const error = ref('');
const busy = ref(false);
const meta = computed(() => (r.value ? reportMeta(r.value) : {}));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    r.value = await api(`/access-reports/${encodeURIComponent(id)}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function act(path, body) {
  busy.value = true;
  try {
    r.value = await api(`/access-reports/${encodeURIComponent(id)}/${path}`, { method: 'POST', body: JSON.stringify(body) });
    return true;
  } catch (e) {
    f7.dialog.alert(e.message);
    return false;
  } finally {
    busy.value = false;
  }
}
// The suggestion comes from what the agent tried, so the admin sees it in an
// editable prompt before anything is granted; the server validates the result.
function grant(type) {
  const suggested = r.value?.suggestion?.type === type ? r.value.suggestion.value : '';
  const [prompt, title] = type === 'website'
    ? [ct('要讓這個 Agent 連線的網站（例如 api.github.com）'), ct('開通網站')]
    : [ct('要讓這個 Agent 使用的資料夾（以 / 或 ~/ 開頭）'), ct('開通資料夾')];
  f7.dialog.prompt(prompt, title, async (value) => {
    const entry = String(value || '').trim();
    if (!entry) return;
    if (await act('grant', type === 'website' ? { website: entry } : { folder: entry })) {
      f7.toast.create({ text: ct('已開通，Agent 會重新連線'), closeTimeout: 2000 }).open();
    }
  }, undefined, suggested);
}
// Narrowing or taking back a scope happens on the owner's user page, where every
// one of their agents' scopes can be set outright.
function editScope() {
  f7.views.get('#view-admin').router.navigate(`/user/?id=${encodeURIComponent(r.value.owner)}`);
}
function resolve(resolution) {
  return act('resolve', { resolution });
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
.detail-explanation {
  margin-bottom: 14px; padding: 18px; border-radius: 20px;
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  background: color-mix(in srgb, currentColor 10%, rgba(127, 127, 127, 0.06));
}
.detail-explanation > span { opacity: 0.7; font-size: 13px; }
.detail-explanation h3 { margin: 6px 0 8px; font-size: 20px; color: var(--f7-text-color, inherit); }
.detail-explanation p { margin: 0 0 6px; color: var(--f7-text-color, inherit); opacity: 0.85; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.detail-refusal { opacity: 0.7 !important; }
.detail-card {
  margin-bottom: 14px; padding: 8px 16px; border-radius: 20px; background: rgba(127, 127, 127, 0.12);
  box-shadow: rgba(255, 255, 255, 0.4) 2px 2px 2px -2px inset, rgba(255, 255, 255, 0.4) -2px -2px 2px -2px inset;
}
.detail-card h3 { margin: 10px 0 4px; font-size: 17px; }
.detail-card dl, .technical-card dl { margin: 0; }
.detail-card dl > div, .technical-card dl > div { display: grid; grid-template-columns: minmax(90px, 0.8fr) minmax(0, 1.6fr); gap: 14px; padding: 12px 0; border-bottom: 1px solid rgba(127, 127, 127, 0.18); }
.detail-card dl > div:last-child, .technical-card dl > div:last-child { border-bottom: 0; }
.detail-card dt, .technical-card dt { opacity: 0.55; }
.detail-card dd, .technical-card dd { margin: 0; text-align: right; overflow-wrap: anywhere; white-space: pre-line; }
.action-card { padding-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
.scope-edit-link { display: inline-block; margin: 2px 0 6px; font-size: 14px; }
.suggestion { margin: 6px 0 0; }
.suggestion code { overflow-wrap: anywhere; }
.action-note { margin: 0 0 4px; opacity: 0.6; font-size: 13px; }
.technical-card { margin-top: 6px; padding: 10px 16px; border-radius: 16px; background: rgba(127, 127, 127, 0.08); font-size: 13px; }
.technical-card summary { cursor: pointer; opacity: 0.7; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.report-open { color: #ff9f0a; }
.report-granted { color: #30d158; }
.report-dismissed { color: #8e8e93; }
.report-self { color: #64d2ff; }
.agent-reason p { margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.agent-reason h3 small { font-weight: 400; opacity: 0.6; }
.earlier-reasons { margin: 10px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.45; opacity: 0.7; overflow-wrap: anywhere; }
</style>
