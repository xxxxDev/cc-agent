<template>
  <f7-page name="access-report">
    <!-- Opened over the reports list, from it or from a notification (navigation.js builds
         that stack), so back is the list. -->
    <f7-navbar :title="ct('報告單')" back-link="Back" />
    <AccessReportDetail :id="id" @edit-scope="editScope" />
  </f7-page>
</template>

<script setup>
import { f7 } from 'framework7-vue';
import { ct } from '../js/agent-i18n.js';
import AccessReportDetail from '../components/AccessReportDetail.vue';

const props = defineProps({ f7route: { type: Object, default: () => ({}) } });
const id = props.f7route?.query?.id || '';
function editScope(owner) {
  f7.views.get('#view-admin').router.navigate(`/user/?id=${encodeURIComponent(owner)}`);
}
</script>
