// One copy of the Agent-management settings for the whole app. The Admin tab and the
// conversation page both read these, so turning the chat/terminal switch on or
// off shows up in an open conversation at once instead of after a reload.
import {ref} from 'vue';
import {api} from './api.js';

export const compactThreshold = ref(5);
// What a handoff carries and whether one by hand asks first.
export const handoff = ref({recent: 12, ask: true, lazy: false, max: 50});
// The subagents' model and effort for every agent that does not set its own.
export const subagents = ref({model: '', lock: false, effort: ''});
// When every agent's Claude Code compacts, unless it has its own: null is Claude Code's default (issue #12).
export const autoCompact = ref(null);
export const autoCompactPresets = ref([200000, 300000, 400000, 500000, 700000]);
export const terminalSwitch = ref(false);
// The Transcript column's button; off until an admin switches it on.
export const transcriptSwitch = ref(false);
// Days a deleted agent is kept before it is purged, or null for never (the default).
export const archiveRetentionDays = ref(null);
// Days a checklist whose every item is done is kept after its last change, or null for never.
export const checklistRetentionDays = ref(null);
// The wrap-up check sent to an agent that finished a task: on or off,
// the minutes it sits idle first, and its words.
export const wrapUp = ref({enabled: false, minutes: 10, text: '', custom: false});
// The conversation page's buttons on a computer and a split cell's header, in the order an
// admin set on the Admin page; everyone reads it.
export const NAV_KEYS = ['usage', 'checklist', 'search', 'terminal', 'transcript', 'profile'];
export const navOrder = ref([...NAV_KEYS]);
const takeNavOrder = (v) => { if (!Array.isArray(v)) return; const next = [...new Set([...v.filter((k) => NAV_KEYS.includes(k)), ...NAV_KEYS])]; if (JSON.stringify(next) !== JSON.stringify(navOrder.value)) navOrder.value = next; };
// A button's place in that order, for its CSS order: 1 to 7.
export const navPlace = (key) => navOrder.value.indexOf(key) + 1;
// How many buttons a phone shows at the top right, 「⋯」 included: 1 to 3, 2 by default.
export const phoneNavCount = ref(2);
// A phone's own order: no Transcript there, the terminal first by default.
export const PHONE_KEYS = ['terminal', 'checklist', 'usage', 'search', 'profile'];
export const phoneNavOrder = ref([...PHONE_KEYS]);
const takePhoneOrder = (v) => { if (!Array.isArray(v)) return; const next = [...new Set([...v.filter((k) => PHONE_KEYS.includes(k)), ...PHONE_KEYS])]; if (JSON.stringify(next) !== JSON.stringify(phoneNavOrder.value)) phoneNavOrder.value = next; };
const takePhoneCount = (v) => { if ([1, 2, 3].includes(v) && v !== phoneNavCount.value) phoneNavCount.value = v; };
export const preferencesLoaded = ref(false);
export const scopedAgents = ref(null);

function absorb(preferences) {
  if (!preferences || typeof preferences !== 'object') return preferences;
  if (Number.isInteger(preferences.compactThreshold)) compactThreshold.value = preferences.compactThreshold;
  if (preferences.handoff && typeof preferences.handoff === 'object') handoff.value = preferences.handoff;
  if (preferences.subagents && typeof preferences.subagents === 'object') subagents.value = preferences.subagents;
  if (preferences.autoCompact === null || Number.isInteger(preferences.autoCompact)) autoCompact.value = preferences.autoCompact;
  if (Array.isArray(preferences.autoCompactPresets)) autoCompactPresets.value = preferences.autoCompactPresets;
  terminalSwitch.value = preferences.terminalSwitch === true;
  transcriptSwitch.value = preferences.transcriptSwitch === true;
  if (preferences.wrapUp && typeof preferences.wrapUp === 'object') wrapUp.value = preferences.wrapUp;
  archiveRetentionDays.value = Number.isInteger(preferences.archiveRetentionDays) ? preferences.archiveRetentionDays : null;
  checklistRetentionDays.value = Number.isInteger(preferences.checklistRetentionDays) ? preferences.checklistRetentionDays : null;
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
// The agents pinned at the top, in the order pinned.
export const listPins = ref([]);
export function absorbList(preferences) {
  autoSort.value = preferences?.autoSort === true;
  takeNavOrder(preferences?.navOrder);
  takePhoneCount(preferences?.phoneNavCount);
  takePhoneOrder(preferences?.phoneNavOrder);
  const nextPins = Array.isArray(preferences?.pins) ? preferences.pins.filter((id) => typeof id === 'string') : [];
  if (JSON.stringify(listPins.value) !== JSON.stringify(nextPins)) listPins.value = nextPins;
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
