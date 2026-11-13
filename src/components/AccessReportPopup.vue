<!-- A chat's scope-report card, opened: the report in a pushed card over the chat, as the app's other sheets (js/sheetSwipe.js), so the
     chat, its scroll and its draft stay where they were and no tab or address changes. An admin
     sees the report itself and its actions (AccessReportDetail, as on the Admin tab); a member,
     or a report no longer kept, the card's own summary. Several reports in one card: one at a
     time, picked at the top. -->
<template>
  <f7-popup :opened="opened" :swipe-to-close="sheetSwipe" :push="sheetSwipe" class="report-popup" :class="{'sheet-swipe': sheetSwipe}" @popup:closed="closed">
    <div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true" />
    <f7-view><f7-page>
      <f7-navbar>
        <f7-nav-left><f7-link popup-close icon-only icon-f7="xmark" class="report-popup-close" :aria-label="ct('關閉報告單')" /></f7-nav-left>
        <f7-nav-title>{{ ct('報告單') }}</f7-nav-title>
      </f7-navbar>
      <template v-if="card">
        <div v-if="items.length > 1" class="report-popup-picks" role="tablist">
          <f7-button v-for="x in items" :key="x.id" small round :fill="x.id === current?.id" role="tab" :aria-selected="String(x.id === current?.id)" class="report-popup-pick" @click="pick = x.id">{{ plain(x.tool) || ct('未知工具') }}</f7-button>
        </div>
        <AccessReportDetail v-if="full" :key="current.id" :id="current.id" @edit-scope="editScope" @changed="changed" />
        <div v-else-if="current" class="page-col-medium report-summary" :data-report-id="current.id">
          <section class="summary-card">
            <span class="summary-kind">{{ kindOf(current) }}<template v-if="stateOf(current)"> · {{ stateOf(current) }}</template></span>
            <h3>{{ plain(current.tool) || ct('未知工具') }}</h3>
            <p v-if="current.line" class="mono">{{ plain(current.line) }}</p>
          </section>
          <section v-if="current.explanation" class="summary-card">
            <h4>{{ ct('Agent 說明') }}<small v-if="current.explanationCount > 1"> · {{ ct('共') }} {{ current.explanationCount }} {{ ct('次') }}</small></h4>
            <p>{{ plain(current.explanation.why) }}</p>
            <p v-if="current.explanation.instead">{{ labelled(ct('改用'), plain(current.explanation.instead)) }}</p>
          </section>
          <section v-else-if="current.agentWords" class="summary-card">
            <h4>{{ ct('Agent 當時寫的') }}</h4>
            <p>{{ plain(current.agentWords) }}</p>
          </section>
          <p v-if="!isAdmin" class="summary-note report-popup-notified">{{ current?.notified ? ct('已通知管理員') : ct('已記錄') }}</p>
        </div>
        <p v-if="card.more" class="summary-note report-popup-more">{{ labelled(ct('同一輪另有'), card.more + ' ' + ct('次')) }}</p>
      </template>
    </f7-page></f7-view>
  </f7-popup>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { f7 } from 'framework7-vue';
import { ct, labelled } from '../js/agent-i18n.js';
import { currentUser } from '../js/auth.js';
import { plain } from '../js/access-reports.js';
import { setActiveTab } from '../js/tab-session.js';
import { sheetSwipe } from '../js/sheetSwipe.js';
import { reportCard, closeReportCard } from '../js/reportPopup.js';
import AccessReportDetail from './AccessReportDetail.vue';

// `card` stays while the popup slides away, so its content does not vanish mid-close.
const card = ref(null);
const opened = ref(false);
const pick = ref('');
watch(reportCard, (m) => {
  if (!m) { opened.value = false; return; }
  card.value = m;
  pick.value = m.reports?.[0]?.id || '';
  opened.value = true;
});
function closed() {
  opened.value = false;
  card.value = null;
  closeReportCard();
}

const isAdmin = computed(() => currentUser.value?.role === 'admin');
const items = computed(() => card.value?.reports || []);
const current = computed(() => items.value.find((x) => x.id === pick.value) || items.value[0] || null);
// The report itself is an admin's, and only while it is still kept.
const full = computed(() => isAdmin.value && current.value && current.value.status !== 'gone');
const kindOf = (x) => (x.kind === 'permission' ? ct('權限請求被拒') : x.kind === 'classifier' ? ct('自動判斷擋下') : x.exact === false ? `${ct('被範圍擋下')} · ${ct('依文字判斷')}` : ct('被範圍擋下'));
const stateOf = (x) => (x.status === 'resolved' ? (x.resolution === 'granted' ? ct('已開通') : ct('已略過')) : x.explanation?.stillNeeded === false ? ct('Agent 說不需要') : '');

// What an admin did here shows on the card at once; the chat's next load brings the stored one.
function changed(r) {
  const x = items.value.find((item) => item.id === r?.id);
  if (!x) return;
  x.status = r.status;
  x.resolution = r.resolution ?? null;
  if (r.explanation) x.explanation = r.explanation;
}
// The owner's scope is edited on the Admin tab: the popup goes, that page opens there over
// what the tab showed, and its back returns to it.
function editScope(owner) {
  closeReportCard();
  setActiveTab('view-admin');
  f7.views.get('#view-admin')?.router?.navigate(`/user/?id=${encodeURIComponent(owner)}`);
}
</script>

<style scoped>
.report-popup-picks { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px 0; }
.report-popup-pick { flex: 0 0 auto; max-width: 100%; }
.report-summary { padding: 16px 16px 8px; }
.summary-card {
  margin-bottom: 14px; padding: 14px 16px; border-radius: 20px; background: rgba(127, 127, 127, 0.12);
  box-shadow: rgba(255, 255, 255, 0.4) 2px 2px 2px -2px inset, rgba(255, 255, 255, 0.4) -2px -2px 2px -2px inset;
}
.summary-kind { font-size: 13px; opacity: 0.7; }
.summary-card h3 { margin: 6px 0 6px; font-size: 20px; }
.summary-card h4 { margin: 0 0 6px; font-size: 15px; }
.summary-card h4 small { font-weight: 400; opacity: 0.6; }
.summary-card p { margin: 0 0 4px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.summary-note { margin: 0 16px 16px; font-size: 13px; opacity: 0.6; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
</style>
