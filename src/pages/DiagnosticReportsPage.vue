<template>
  <!-- 診斷回報: what people sent from Agent Profile's 「回報診斷」, laid out as the scope
       reports' list (AccessReportsPage.vue). An admin's. -->
  <f7-page name="diagnostic-reports" class="page-large-static" ptr :ptr-mousewheel="true" @ptr:refresh="refresh" @page:afterin="load">
    <f7-navbar large>
      <f7-nav-left :back-link="true"></f7-nav-left>
      <f7-nav-title sliding>{{ ct('診斷回報') }}</f7-nav-title>
      <f7-nav-title-large>{{ ct('診斷回報') }}</f7-nav-title-large>
    </f7-navbar>

    <f7-block-footer>{{ ct('使用者在 Agent Profile 的「工程診斷資訊」按「回報診斷」送來的內容。可以標為已處理、刪除，或交給你的 agent。') }}</f7-block-footer>

    <div class="page-col-medium">
      <div class="report-filters">
        <label>
          <span>{{ ct('狀態') }}</span>
          <select v-model="filter">
            <option value="open">{{ ct('未處理') }}</option>
            <option value="handled">{{ ct('已處理') }}</option>
            <option value="">{{ ct('全部') }}</option>
          </select>
        </label>
      </div>

      <f7-block v-if="loading && !reports.length" class="report-state"><f7-preloader /></f7-block>
      <f7-block v-else-if="error" class="report-state report-error">{{ error }}</f7-block>
      <f7-block v-else-if="!shown.length" class="report-state report-muted">{{ ct('目前沒有診斷回報') }}</f7-block>

      <div v-else class="report-cards">
        <button v-for="r in shown" :key="r.id" type="button" class="report-card diagnostic-card" :data-id="r.id" @click="open(r)">
          <div class="report-card-head">
            <i class="f7-icons report-icon" :class="r.status === 'open' ? 'report-open' : 'report-handled'">{{ r.status === 'open' ? 'doc_text_search' : 'checkmark_seal_fill' }}</i>
            <div class="report-card-title">
              <strong>{{ r.agentTitle || 'Agent' }}</strong>
              <span>{{ r.fromName || ct('已刪除的使用者') }} · {{ reportTime(r.at) }}</span>
            </div>
            <span class="report-status" :class="r.status === 'open' ? 'report-open' : 'report-handled'">{{ r.status === 'open' ? ct('未處理') : ct('已處理') }}</span>
          </div>
          <div class="report-card-foot">
            <span class="mono">{{ r.build }}</span>
            <span>{{ sizeLabel(r.bytes) }}</span>
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
import { ct } from '../js/agent-i18n.js';
import { reportTime } from '../js/access-reports.js';

const reports = ref([]);
const loading = ref(false);
const error = ref('');
const filter = ref('open');
const shown = computed(() => reports.value.filter((r) => !filter.value || r.status === filter.value));
const sizeLabel = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    reports.value = (await api('/diagnostic-reports')).reports || [];
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
function open(r) {
  f7.views.get('#view-admin').router.navigate(`/diagnostic-report/?id=${encodeURIComponent(r.id)}`);
}
</script>

<style scoped>
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
.report-handled { color: #30d158; }
.report-card-foot { display: flex; gap: 12px; align-items: center; margin-top: 10px; opacity: 0.55; font-size: 12px; }
.report-card-foot .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.report-card-foot .f7-icons { margin-left: auto; font-size: 15px; }
</style>
