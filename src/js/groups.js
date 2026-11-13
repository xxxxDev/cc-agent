// Group chats, as the Groups tab shows them: the
// list, the room open now, and what the owner does in it. The server decides who
// gets a message (server/agentStore.js); the page only shows and sends.
import {ref} from 'vue';
import {api} from './api.js';

export const groups = ref([]);
export const room = ref(null);
// The group open on screen, told to the live socket so its changes come through.
export const viewingGroup = ref(null);

export async function loadGroups() { const r = await api('/groups'); groups.value = r.groups || []; return groups.value; }
// opening: the room was opened just now rather than refreshed.
export async function loadRoom(id, {viewing = false, opening = false} = {}) {
  const q = [viewing ? 'viewing=1' : '', opening ? 'open=1' : ''].filter(Boolean).join('&');
  const r = await api('/groups/' + encodeURIComponent(id) + (q ? '?' + q : ''));
  // Only the room on screen, or, with none told, the room already held (or none): an answer that
  // arrives after another room was opened never takes its place.
  if (viewingGroup.value ? viewingGroup.value === id : !room.value || room.value.id === id) room.value = r;
  return r;
}
export async function createGroup(body) { const r = await api('/groups', {method: 'POST', body: JSON.stringify(body)}); await loadGroups(); return r; }
export async function updateGroup(id, body) { const r = await api('/groups/' + encodeURIComponent(id), {method: 'PATCH', body: JSON.stringify(body)}); if (room.value?.id === id) room.value = r; await loadGroups(); return r; }
export async function reorderGroups(ids) { const r = await api('/groups/reorder', {method: 'POST', body: JSON.stringify({ids})}); groups.value = r.groups || groups.value; return groups.value; }
export async function removeGroup(id) { await api('/groups/' + encodeURIComponent(id), {method: 'DELETE'}); if (room.value?.id === id) room.value = null; await loadGroups(); }
export async function sendToGroup(id, text, mentions = []) {
  const r = await api('/groups/' + encodeURIComponent(id) + '/messages', {method: 'POST', body: JSON.stringify({text, mentions, requestId: 'g-' + crypto.randomUUID()})});
  if (room.value?.id === id) room.value = r;
  return r;
}
export async function changeGroupChecklist(id, body) { const r = await api('/groups/' + encodeURIComponent(id) + '/checklist', {method: 'POST', body: JSON.stringify(body)}); if (room.value?.id === id) room.value = r; return r; }
export const searchGroup = (id, q) => api('/groups/' + encodeURIComponent(id) + '/search', {method: 'POST', body: JSON.stringify({q})});
export async function commandInGroup(id, agentId, command) { const r = await api('/groups/' + encodeURIComponent(id) + '/command', {method: 'POST', body: JSON.stringify({agentId, command})}); if (room.value?.id === id) room.value = r; return r; }
