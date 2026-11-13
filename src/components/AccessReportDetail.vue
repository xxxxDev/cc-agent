<!-- One scope report: what was refused, the agent's word, its scope and what to do about it.
     The Admin tab's report page and a chat's report popup both show it. The owner's scope is
     edited on the Admin tab: `edit-scope` with the owner. -->
<template>
  <div class="page-col-medium detail-wrap">
    <f7-block v-if="loading" class="detail-state"><f7-preloader /></f7-block>
    <f7-block v-else-if="error" class="detail-state detail-error">{{ error }}</f7-block>

    <template v-else-if="r">
      <section class="detail-hero">
        <i class="f7-icons detail-icon" :class="meta.cls">{{ meta.icon }}</i>
        <div>
          <h2>{{ meta.label }}</h2>
          <p>{{ plain(r.agentTitle) }} · {{ plain(r.ownerName) }}</p>
          <p v-if="notNeeded(r)" class="detail-not-needed">{{ ct('Agent 說不需要') }}</p>
          <p v-if="r.formerlySelfResolved" class="detail-former">{{ ct('原本標為 Agent 已自行解決，已改回待處理') }}</p>
        </div>
      </section>

      <section class="detail-explanation" :class="meta.cls">
        <span>{{ reportKind(r) }}</span>
        <h3 v-if="isNotice(r)">{{ digestLine(r) }}</h3>
        <template v-else>
          <h3>{{ plain(r.tool) || ct('未知工具') }}</h3>
          <p class="mono">{{ plain(r.detail) }}</p>
        </template>
        <p v-if="r.error" class="mono detail-refusal">{{ plain(r.error) }}</p>
        <!-- Reached through a symlink: both ends as Claude Code printed them, shortened or not. -->
        <dl v-if="r.symlink" class="detail-symlink">
          <div><dt>{{ ct('經由連結（symlink）') }}</dt><dd class="mono">{{ plain(r.symlink.from) }}</dd></div>
          <div><dt>{{ ct('實際位置') }}</dt><dd class="mono">{{ plain(r.symlink.to) }}</dd></div>
        </dl>
      </section>

      <!-- What was refused past the cap, or past the turn's limit, by tool and first line. -->
      <section v-if="r.kind === 'cap' && (r.recent?.length || r.first?.length)" class="detail-card refused-more">
        <h3>{{ ct('之後被擋下的') }}</h3>
        <ul class="mono"><li v-for="(line, i) in capLines(r)" :key="i">{{ line }}</li></ul>
      </section>
      <section v-if="r.overflow?.count" class="detail-card refused-more">
        <h3>{{ labelled(ct('同一輪另有'), `${r.overflow.count} ${ct('次')}`) }}</h3>
        <ul class="mono"><li v-for="(line, i) in overflowLines(r.overflow)" :key="i">{{ line }}</li></ul>
      </section>

      <!-- The agent's own word (explain_report), or what it wrote just before the call. -->
      <section v-if="r.explanation" class="detail-card agent-reason">
        <h3>{{ ct('Agent 說明') }}<small v-if="r.explanationCount > 1"> · {{ ct('共') }} {{ r.explanationCount }} {{ ct('次') }}</small></h3>
        <dl>
          <div><dt>{{ ct('為什麼') }}</dt><dd>{{ plain(r.explanation.why) }}</dd></div>
          <div v-if="r.explanation.instead"><dt>{{ ct('改用') }}</dt><dd>{{ plain(r.explanation.instead) }}</dd></div>
          <div><dt>{{ ct('仍需要') }}</dt><dd>{{ r.explanation.stillNeeded ? ct('是') : ct('Agent 說不需要') }}</dd></div>
        </dl>
        <!-- What it said before, shortened, newest last (explain_report keeps a few). -->
        <ol v-if="r.explanationHistory?.length" class="earlier-reasons">
          <li v-for="(e, i) in r.explanationHistory" :key="i">{{ reportTime(e.at) }} · {{ e.stillNeeded ? ct('仍需要') : ct('Agent 說不需要') }} · {{ plain(e.why) }}</li>
        </ol>
      </section>
      <section v-else-if="r.agentWords" class="detail-card agent-reason">
        <h3>{{ ct('Agent 當時寫的') }}</h3>
        <p>{{ plain(r.agentWords) }}</p>
      </section>

      <section class="detail-card">
        <h3>{{ ct('情境') }}</h3>
        <dl>
          <div><dt>{{ ct('使用者') }}</dt><dd>{{ plain(r.ownerName) }}</dd></div>
          <div><dt>Agent</dt><dd>{{ plain(r.agentTitle) }}<template v-if="r.agentArchived"> {{ ct('（已封存）') }}</template></dd></div>
          <div><dt>{{ ct('第幾代') }}</dt><dd>{{ r.generation }}</dd></div>
          <div><dt>{{ ct('時間') }}</dt><dd>{{ reportTime(r.at) }}</dd></div>
          <div v-if="r.messageExcerpt"><dt>{{ ct('當時的對話') }}</dt><dd>{{ plain(r.messageExcerpt) }}</dd></div>
        </dl>
      </section>

      <section class="detail-card">
        <h3>{{ ct('這個 Agent 目前的範圍') }}</h3>
        <f7-link class="scope-edit-link" @click="editScope">{{ ct('調整或收回範圍…') }}</f7-link>
        <dl>
          <div><dt>{{ ct('允許的資料夾') }}</dt><dd class="mono">{{ listOrNone(r.access?.allow) || ct('只有工作區') }}</dd></div>
          <div><dt>{{ ct('排除的資料夾') }}</dt><dd class="mono">{{ listOrNone(r.access?.exclude) || ct('無') }}</dd></div>
          <div><dt>{{ ct('允許的網站') }}</dt><dd class="mono">{{ listOrNone(r.access?.domains) || ct('無') }}</dd></div>
          <div class="web-note">{{ ct('讀取網頁只能連到這些網站，其他網站由 CC Agent 擋下。限制：Bash 照沙盒的網站清單，不擋解析到私有位址的名稱；網頁搜尋不受限；同一網站開頭加減 www. 的轉址不再檢查；網站可在檢查後改變解析位址；檢查逾時（15 秒）時照常執行。') }}</div>
        </dl>
      </section>

      <section v-if="r.status === 'open'" class="detail-card action-card">
        <h3>{{ ct('處理') }}</h3>
        <p v-if="r.suggestion && grantable(r)" class="suggestion">
          {{ r.suggestion.type === 'website' ? ct('建議開通的網站') : ct('建議開通的資料夾') }}：<code>{{ visible(r.suggestion.value) }}</code>
        </p>
        <p v-if="r.suggestion?.risky && grantable(r)" class="action-note risky-note">{{ ct('這個資料夾範圍太大，或含有 shell 或系統會讀取、執行的檔案，不會預先填入；真的要開通，請自己輸入。') }}</p>
        <!-- The auto-mode safety check's denial: a wider scope would not let it through, so
             there is nothing to grant from here. -->
        <p v-if="r.kind === 'classifier'" class="action-note classifier-note">{{ ct('這是 Claude Code 自動模式的安全判斷擋下的，開通範圍也不會放行。') }}</p>
        <p v-else-if="grantable(r)" class="action-note">{{ ct('開通後這個 Agent 會重新連線，之後就能使用這個範圍。') }}</p>
        <!-- The suggested kind is the filled button; the other stays available. -->
        <template v-if="grantable(r)">
          <!-- A refused read: reading is all it asked for, so read-only is the main choice. -->
          <f7-button v-if="readTool" fill round large class="grant-read-only" :disabled="busy || r.agentArchived" @click="grant('readOnly')">{{ ct('只開放讀取資料夾…') }}</f7-button>
          <f7-button :fill="!readTool && r.suggestion?.type !== 'website'" round large class="grant-folder" :disabled="busy || r.agentArchived" @click="grant('folder')">{{ ct('開通資料夾…') }}</f7-button>
          <f7-button :fill="r.suggestion?.type === 'website'" round large :disabled="busy || r.agentArchived" @click="grant('website')">{{ ct('開通網站…') }}</f7-button>
        </template>
        <f7-button round large :disabled="busy" @click="resolve('dismissed')">{{ ct('略過') }}</f7-button>
      </section>

      <section v-else class="detail-card">
        <h3>{{ ct('處理結果') }}</h3>
        <dl>
          <div><dt>{{ ct('結果') }}</dt><dd>{{ meta.label }}</dd></div>
          <div v-if="r.accessNow === 'missing'" class="access-missing">{{ ct('這次開通的項目目前不在 Agent 的範圍裡（可能之後收回了，或開通沒有存進去）') }}</div>
          <div v-if="r.granted"><dt>{{ ct('開通內容') }}</dt><dd class="mono">{{ r.granted.folder || r.granted.website || r.granted.readOnly }}<template v-if="r.granted.readOnly"> {{ ct('（唯讀）') }}</template></dd></div>
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
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { f7 } from 'framework7-vue';
import { api } from '../js/api.js';
import { ct, labelled } from '../js/agent-i18n.js';
import { isNotice, grantable, riskyFolder, reportMeta, reportKind, reportTime, listOrNone, digestLine, overflowLines, capLines, notNeeded, plain } from '../js/access-reports.js';

const props = defineProps({ id: { type: String, default: '' } });
// changed: the report as the server now has it, after an action here.
const emit = defineEmits(['edit-scope', 'changed']);
const r = ref(null);
const loading = ref(false);
const error = ref('');
const busy = ref(false);
const meta = computed(() => (r.value ? reportMeta(r.value) : {}));

async function load() {
  const id = props.id;
  loading.value = true;
  error.value = '';
  try {
    const got = await api(`/access-reports/${encodeURIComponent(id)}`);
    if (id === props.id) r.value = got;
  } catch (e) {
    if (id === props.id) error.value = e.message;
  } finally {
    if (id === props.id) loading.value = false;
  }
}
watch(() => props.id, (id) => { r.value = null; if (id) load(); }, { immediate: true });
// The report as this page showed it, and seenVersion, which tells the server this page sends
// it: the server acts only if the report is still so, else it answers that it changed (409).
const seen = () => ({ status: r.value?.status, labelAt: r.value?.explanation?.at || null, adminActedAt: r.value?.adminActedAt || null });
async function act(path, body) {
  busy.value = true;
  try {
    r.value = await api(`/access-reports/${encodeURIComponent(props.id)}/${path}`, { method: 'POST', body: JSON.stringify({ ...body, seen: seen(), seenVersion: 1 }) });
    emit('changed', r.value);
    return true;
  } catch (e) {
    f7.dialog.alert(e.message);
    return false;
  } finally {
    busy.value = false;
  }
}
// The suggestion is the target of the call Claude Code refused, so the admin sees it in an
// editable prompt, then a confirmation naming the agent, the exact value and what it may do
// there, before anything is granted; the server validates the result. One too
// broad, or one the shell or the system reads or runs (suggestion.risky), is not filled in.
// A control or format character (a newline, a right-to-left mark, a zero-width space) shown as
// its code, so what the admin reads is what would be granted.
const visible = (v) => String(v ?? '').replace(/[\p{Cc}\p{Cf}]/gu, (ch) => `\\u{${ch.codePointAt(0).toString(16)}}`);
const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LS'];
const readTool = computed(() => READ_TOOLS.includes(r.value?.tool) && r.value?.suggestion?.type !== 'website');
function grant(type) {
  const s = r.value?.suggestion;
  const suggested = s && !s.risky && (s.type === type || (type === 'readOnly' && s.type === 'folder')) ? s.value : '';
  const [prompt, title] = type === 'website'
    ? [ct('要讓這個 Agent 連線的網站（例如 api.github.com）'), ct('開通網站')]
    : type === 'readOnly'
      ? [ct('要讓這個 Agent 只能讀取的資料夾（以 / 或 ~/ 開頭）'), ct('只開放讀取資料夾')]
      : [ct('要讓這個 Agent 使用的資料夾（以 / 或 ~/ 開頭）'), ct('開通資料夾')];
  // safeDialog escapes the text and title and sets the suggestion as the input's value.
  f7.dialog.prompt(prompt, title, async (value) => {
    const entry = String(value || '').trim();
    if (!entry) return;
    // Where a typed folder leads on disk, when that is not what was typed: said in the
    // confirmation, for information; what was typed is what is granted (a link works for the
    // file tools, not for Bash, so the real path is the one to grant).
    let resolved = entry;
    if (type !== 'website') {
      try { resolved = (await api(`/access-reports/${encodeURIComponent(props.id)}/resolve-folder`, { method: 'POST', body: JSON.stringify({ folder: entry }) })).resolved || entry; }
      catch (e) { f7.dialog.alert(e.message); return; }
    }
    const what = type === 'website' ? ct('可以連線到這個網站') : type === 'readOnly' ? ct('可以讀取這個資料夾，但不能修改') : ct('可以讀取，也可以修改、新增、刪除這個資料夾裡的檔案');
    const text = ct('Agent「{agent}」{what}：{value}').replace('{agent}', () => plain(r.value?.agentTitle) || 'Agent').replace('{what}', () => what).replace('{value}', () => visible(entry))
      + (resolved !== entry ? `\n${ct('這是連結，實際位置是：')}${visible(resolved)}${ct('（照輸入的開通；Bash 只能用實際位置）')}` : '');
    // Too broad, or a folder whose files the shell, the system or a tool runs: said in the
    // confirmation, and only then sent as confirmed. One only the server knows (a folder on its
    // PATH) comes back as such and is asked once more.
    const risky = type !== 'website' && (riskyFolder(entry) || riskyFolder(resolved));
    const body = type === 'website' ? { website: entry } : type === 'readOnly' ? { readOnly: entry } : { folder: entry };
    f7.dialog.confirm(risky ? `${text}\n\n${ct('注意：這個資料夾範圍太大，或含有 shell、系統或工具會讀取、執行的檔案（例如 bin、hooks 或 .git）。')}` : text, ct('確認開通'), () => send(risky ? { ...body, confirmRisky: true } : body));
  }, undefined, suggested);
}
async function send(body) {
  busy.value = true;
  try {
    r.value = await api(`/access-reports/${encodeURIComponent(props.id)}/grant`, { method: 'POST', body: JSON.stringify({ ...body, seen: seen(), seenVersion: 1 }) });
    emit('changed', r.value);
    f7.toast.create({ text: ct('已開通，Agent 會重新連線'), closeTimeout: 2000 }).open();
  } catch (e) {
    if (e.code === 'risky' && !body.confirmRisky) f7.dialog.confirm(ct(e.message), ct('確認開通'), () => send({ ...body, confirmRisky: true }));
    else f7.dialog.alert(e.message);
  } finally {
    busy.value = false;
  }
}
// Narrowing or taking back a scope happens on the owner's user page, where every
// one of their agents' scopes can be set outright.
function editScope() {
  emit('edit-scope', r.value.owner);
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
.detail-not-needed { margin: 4px 0 0; color: #64d2ff; font-size: 13px; }
.detail-former { margin: 4px 0 0; opacity: 0.6; font-size: 12px; }
.refused-more ul { margin: 6px 0 4px; padding-left: 18px; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.detail-card dl, .technical-card dl { margin: 0; }
.detail-card dl > div, .technical-card dl > div { display: grid; grid-template-columns: minmax(90px, 0.8fr) minmax(0, 1.6fr); gap: 14px; padding: 12px 0; border-bottom: 1px solid rgba(127, 127, 127, 0.18); }
.detail-card dl > div:last-child, .technical-card dl > div:last-child { border-bottom: 0; }
.detail-card dt, .technical-card dt { opacity: 0.55; }
.detail-card dd, .technical-card dd { margin: 0; text-align: right; overflow-wrap: anywhere; white-space: pre-line; }
.action-card { padding-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
.scope-edit-link { display: inline-block; margin: 2px 0 6px; font-size: 14px; }
.suggestion { margin: 6px 0 0; }
.suggestion code { overflow-wrap: anywhere; }
.risky-note { color: #ff9f0a; }
.detail-symlink { margin: 10px 0 0; }
.access-missing { color: #ff9f0a; font-size: 13px; margin: 4px 0 8px; }
.web-note { opacity: 0.6; font-size: 13px; margin: -4px 0 6px; }
.detail-symlink dt { opacity: 0.7; font-size: 13px; }
.detail-symlink dd { margin: 2px 0 8px; word-break: break-all; }
.action-note { margin: 0 0 4px; opacity: 0.6; font-size: 13px; }
.technical-card { margin-top: 6px; padding: 10px 16px; border-radius: 16px; background: rgba(127, 127, 127, 0.08); font-size: 13px; }
.technical-card summary { cursor: pointer; opacity: 0.7; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.report-open { color: #ff9f0a; }
.report-granted { color: #30d158; }
.report-dismissed { color: #8e8e93; }
.agent-reason p { margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.agent-reason h3 small { font-weight: 400; opacity: 0.6; }
.earlier-reasons { margin: 10px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.45; opacity: 0.7; overflow-wrap: anywhere; }
</style>
