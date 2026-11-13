import {ref} from 'vue';

// A chat's scope-report card opens its reports in a popup over the chat, so the chat, its tab
// and the Admin tab's pages stay as they are. components/AccessReportPopup.vue, mounted once in App.vue, shows `reportCard`:
// the card's message, its `reports` as the chat has them.
export const reportCard = ref(null);
export function openReportCard(message) {
  if (message?.reports?.length) reportCard.value = message;
}
export function closeReportCard() {
  reportCard.value = null;
}
