// One copy of the Agent-management settings for the whole app. The Admin tab and the
// conversation page both read these, so turning the chat/terminal switch on or
// off shows up in an open conversation at once instead of after a reload.
import {ref} from 'vue';
import {api} from './api.js';

export const compactThreshold = ref(5);
export const terminalSwitch = ref(false);
// The Transcript column's button; off until an admin switches it on.
export const transcriptSwitch = ref(false);
// Days a deleted agent is kept before it is purged, or null for never (the default).
export const archiveRetentionDays = ref(null);
// The wrap-up check sent to an agent that finished a task: on or off,
// the minutes it sits idle first, and its words.
export const wrapUp = ref({enabled: false, minutes: 10, text: '', custom: false});
export const preferencesLoaded = ref(false);
export const scopedAgents = ref(null);

function absorb(preferences) {
  if (!preferences || typeof preferences !== 'object') return preferences;
  if (Number.isInteger(preferences.compactThreshold)) compactThreshold.value = preferences.compactThreshold;
  terminalSwitch.value = preferences.terminalSwitch === true;
  transcriptSwitch.value = preferences.transcriptSwitch === true;
  if (preferences.wrapUp && typeof preferences.wrapUp === 'object') wrapUp.value = preferences.wrapUp;
  archiveRetentionDays.value = Number.isInteger(preferences.archiveRetentionDays) ? preferences.archiveRetentionDays : null;
  scopedAgents.value = typeof preferences.scopedAgents === 'boolean' ? preferences.scopedAgents : null;
  preferencesLoaded.value = true;
  return preferences;
}

export async function loadAgentPreferences() {
  return absorb(await api('/preferences'));
}

export async function saveAgentPreferences(patch) {
  return absorb(await api('/preferences', {method: 'PATCH', body: JSON.stringify(patch)}));
}

// One's own Agents list: whether the latest conversation moves to the top. Off by
// default. Everyone's own, so not admin-only.
// Its groups, in order, titled like the sections of Settings.
export const autoSort = ref(false);
export const listGroups = ref([]);
export function absorbList(preferences) {
  autoSort.value = preferences?.autoSort === true;
  const nextGroups = Array.isArray(preferences?.groups) ? preferences.groups : [];
  if (JSON.stringify(listGroups.value) !== JSON.stringify(nextGroups)) listGroups.value = nextGroups;
  return preferences;
}
export async function loadListPreferences() {
  return absorbList(await api('/agent-list'));
}
export async function saveListPreferences(patch) {
  return absorbList(await api('/agent-list', {method: 'PATCH', body: JSON.stringify(patch)}));
}
