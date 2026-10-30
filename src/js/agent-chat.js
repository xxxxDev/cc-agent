import {agentIdFromUrl,agentUrl} from './agentUrl.js';
import * as agentPreferences from './agentPreferences.js';
import {embedded} from './embed.js';
import {openLiveConnection} from './live-connection.js';
import {createNotificationOpener} from './notification-open.js';
import {agentActivity} from './agentActivity.js';
import {measureComposer} from './conversationComposer.js';
import {useAttachmentDrafts} from './attachmentDrafts.js';
import {shouldSendOnEnter} from './chatKeyboard.js';
import {ct,generation} from './agent-i18n.js';
import {timeLocale} from './i18n.js';
import * as agentOperation from './agentOperation.js';
import * as status from './conversationStatus.js';
import {useSlashMenu} from './slashMenu.js';
import {useMentionMenu,caretToEnd} from './mentionMenu.js';
import {inSections} from './agentSections.js';
import {viewingGroup,groups as chatGroups,loadGroups} from './groups.js';
import {ref,computed,onMounted,onUnmounted,nextTick,watch} from 'vue';
import {secondClock} from './secondClock.js';
import {SOURCES} from './agent-models.js';
import {defaultAvatar} from './avatarShape.js';
import {f7} from 'framework7-vue';
import {currentUser as user,verifyAuth} from './auth.js';
import {api} from './api.js';
import {activeTab,setActiveTab} from './tab-session.js';
import {useTheme} from '../theme.js';
import {renderMarkdown,renderTypedMarkdown} from './markdown.js';
export function useAgentChat(){
const busy=ref(false),error=ref('');
let opening=0;
// The address mirrors the open agent but never adds a history entry. F7's own
// router stack is the only "back" this app has: the navbar back link and the
// edge swipe both go through it. Pushing entries meant an iOS edge swipe ran the
// system history-back AND F7's swipeback for one gesture, and any bookkeeping to
// reconcile the two stepped one entry too far — which is how a swipe could land on
// an empty conversation while the back link stayed fine. With nothing behind the
// page in history, the system gesture stays inert and F7 alone handles it.
// Only the chat tab's address is this file's to write; App.vue keeps every tab's
// address in step (src/js/appUrl.js), and a background clean-up here must not
// rewrite the address of a settings page someone is looking at.
function writeUrl(id){
 // A split-view cell keeps the address it was opened with.
 if(embedded)return;
 if(activeTab.value!=='view-chat')return;
 const path=id?agentUrl(id):'/';
 if(location.pathname+location.search!==path)history.replaceState(history.state,'',path);
}
// True only while select() is between clearing the old agent and installing the
// new one, so the orphan guard below never fights an in-flight open.
const selecting=ref(false);
// Every path that drops the selected agent must also leave the conversation
// route. Without this the page stays mounted with no agent: the navbar falls
// back to "Chat", the tabbar reappears and the page is empty.
// The deep link has to go with it, or a reload just reopens the agent we could
// not open. Replace rather than push: this is recovery, not navigation.
function exitConversationRoute(){writeUrl(null);const router=f7.views?.get('#view-chat')?.router;if(router?.currentRoute.url!=='/conversation/')return;const h=router.history||[];if(h.length>=2&&h[h.length-2]==='/')router.back();else router.back('/',{force:true});}
const {theme}=useTheme();
const menuConversation=ref(null),menuPoint=ref({clientX:0,clientY:0});
const preferenceThreshold=agentPreferences.compactThreshold;
// The conversation opens on the newest bubbles and grows upwards. A resumed agent
// can hold a thousand turns, and rendering them all made the page slow to open.
const MESSAGE_PAGE=10;
const MESSAGE_WINDOW_MAX=200;
const olderBusy=ref(false),foundMessage=ref(null),jumping=ref(false),searchOpen=ref(false),searchText=ref('');
const atBottom=ref(true);
// History that arrives above the reader must not play the arrival animation: ten
// bubbles sliding in over two seconds read as the page jumping.
const pagingBack=ref(false);
// The page request and the two layout frames share one run. Changing conversation or scroll container
// invalidates the old run so it cannot move the new conversation; a wheel burst and a touch gesture each load one page only.
let historyPageRun=0,wheelGestureUsed=false,wheelGestureTimer=0,touchHistoryGesture=null,touchHistoryRun=0;
const preferenceTerminalSwitch=agentPreferences.terminalSwitch;
// An admin's new agent starts on the newest Opus at medium, a member's on Sonnet at
// high; every new agent starts scoped, and full access is switched on by an admin.
const blankProfile=(forNew)=>{const admin=forNew&&user.value?.role==='admin';return {title:'',description:'',memory:'',model:admin?'claude-opus-5-5':'claude-sonnet-5-5',effort:admin?'medium':'high',...(admin?{access:{allow:[],exclude:[],domains:[]}}:{})};};
const newProfile=ref(blankProfile()),profileDraft=ref(blankProfile()),profileSaving=ref(false);
const editMode=ref(false),orderBusy=ref(false);
function toggleEdit(){editMode.value=!editMode.value;if(!editMode.value){chosenAgents.value=new Set();attempt(refresh);}}
// Every agent at once, from the edit mode of the list. Sequential, because each start launches a process; a failure is
// reported with the count that did work rather than stopping the rest.
const bulkBusy=ref('');
// Or only some: in edit mode an admin ticks agents, or a group's title for all its
// agents, and the two buttons act on those; with none ticked, on every agent as
// before.
const chosenAgents=ref(new Set());
const chosenList=computed(()=>conversations.value.filter(c=>chosenAgents.value.has(c.id)));
const isChosen=id=>chosenAgents.value.has(id);
function toggleChosen(id){const next=new Set(chosenAgents.value);if(next.has(id))next.delete(id);else next.add(id);chosenAgents.value=next;}
const groupAgentIds=group=>listRows.value.filter(r=>r.kind==='agent'&&r.group===group.id).map(r=>r.id);
const groupChosen=group=>{const ids=groupAgentIds(group);return ids.length>0&&ids.every(isChosen);};
// All of them at once, the ones the search shows.
const allChosen=computed(()=>filtered.value.length>0&&filtered.value.every(c=>chosenAgents.value.has(c.id)));
// Online or not online in one tap, instead of ticking each: the selection becomes exactly those the list shows; tapped again, none.
const presenceSet=online=>filtered.value.filter(c=>!!c.connected===online).map(c=>c.id);
function chosenByPresence(online){const ids=presenceSet(online),chosen=chosenAgents.value;return ids.length>0&&chosen.size===ids.length&&ids.every(id=>chosen.has(id));}
function chooseByPresence(online){chosenAgents.value=chosenByPresence(online)?new Set():new Set(presenceSet(online));}
function toggleAllChosen(){const next=new Set(chosenAgents.value);const all=allChosen.value;for(const c of filtered.value){if(all)next.delete(c.id);else next.add(c.id);}chosenAgents.value=next;}
function toggleGroupChosen(group){const all=groupChosen(group),next=new Set(chosenAgents.value);for(const id of groupAgentIds(group)){if(all)next.delete(id);else next.add(id);}chosenAgents.value=next;}
async function everyAgent(kind){
 if(bulkBusy.value)return;
 const chosen=chosenAgents.value;
 // Nothing ticked means every agent the list shows: this source's, as searched.
 const targets=(chosen.size?conversations.value.filter(c=>chosen.has(c.id)):filtered.value).filter(c=>c.mode==='claude');
 if(!targets.length)return;
 bulkBusy.value=kind;
 let done=0;const failed=[];
 for(const c of targets){
  // Restart is a pause and a start, so it also ends a turn still running; start alone refuses a busy agent.
  try{if(kind==='restart'&&!['stopped','error'].includes(c.phase))await api('/conversations/'+c.id+'/stop',{method:'POST',body:'{}'});
   await api('/conversations/'+c.id+'/'+(kind==='restart'?'start':kind),{method:'POST',body:'{}'});done+=1;}
  catch(e){failed.push(c.title+'：'+e.message);}
 }
 bulkBusy.value='';
 await attempt(refresh);
 const label=kind==='stop'?ct('已暫停'):kind==='restart'?ct('已送出重啟'):ct('已送出啟動');
 f7.toast.create({text:label+' '+done+'/'+targets.length,closeTimeout:2200}).open();
 if(failed.length)f7.dialog.alert(failed.join('\n'));
}
// Dialogs show plain text (js/safeDialog.js escapes it), a line break included.
const chosenNames=()=>chosenList.value.map(c=>c.title).join('、');
function pauseEveryAgent(){
 if(chosenList.value.length)f7.dialog.confirm(chosenNames()+'\n'+ct('執行中的回覆會中斷，聊天紀錄保留。'),ct('暫停選取的 Agent'),()=>everyAgent('stop'));
 else f7.dialog.confirm(ct('暫停所有 Agent？執行中的回覆會中斷，聊天紀錄保留。'),ct('全部暫停'),()=>everyAgent('stop'));
}
function restartEveryAgent(){
 if(chosenList.value.length)f7.dialog.confirm(chosenNames()+'\n'+ct('執行中的回覆會中斷，聊天紀錄保留。'),ct('重啟選取的 Agent'),()=>everyAgent('restart'));
 else f7.dialog.confirm(ct('重啟清單上的所有 Agent？執行中的回覆會中斷，聊天紀錄保留。'),ct('全部重啟'),()=>everyAgent('restart'));
}
function startEveryAgent(){
 if(chosenList.value.length)f7.dialog.confirm(chosenNames(),ct('啟動選取的 Agent'),()=>everyAgent('start'));
 else f7.dialog.confirm(ct('重新連線所有 Agent？'),ct('全部啟動'),()=>everyAgent('start'));
}
// The list is one sortable list with each group's title as a row in it, so an
// agent can be dragged past a title into that group, or into an empty one. The rows after the move say both the order and each
// agent's group: an agent belongs to the nearest title above it, or to none.
async function reorderChats({from,to}){if(orderBusy.value||search.value||from===to||mixed())return;const rows=[...listRows.value];rows.splice(to,0,rows.splice(from,1)[0]);await saveRows(rows);}
async function saveRows(rows){let group=null;const next=[],groups={};for(const row of rows){if(row.kind==='group'){group=row.id;continue;}if(row.kind==='slot')continue;next.push(row.agent);groups[row.id]=group;}
 // The other sources keep their own order after this one's.
 const shown=new Set(next.map(c=>c.id));next.push(...conversations.value.filter(c=>!shown.has(c.id)));orderBusy.value=true;const result=await attempt(()=>api('/conversations/reorder',{method:'POST',body:JSON.stringify({ids:next.map(c=>c.id),groups})}));if(result)conversations.value=result.conversations;orderBusy.value=false;if(!result){const latest=await attempt(()=>api('/conversations'));if(latest)conversations.value=latest.conversations;}}

function onChatsIn(){cancelHistoryPaging();if(selected.value){writeUrl(null);opening++;}selected.value=null;detail.value=null;terminalOpen.value=false;}
const terminalOpen=ref(false);
const conversations=ref([]),selected=ref(null),detail=ref(null),search=ref(''),draft=ref(''),scroll=ref(null);
// Unread counts in the list and the menu: the server's,
// except the agent open on screen, which is being read.
const unreadOf=a=>a&&!(selected.value===a.id&&conversationOnScreen())?(a.unread||0):0;
const unreadLabel=n=>n>99?'99+':n||null;
const unreadTotal=computed(()=>conversations.value.reduce((n,a)=>n+unreadOf(a),0));
const attachmentDrafts=useAttachmentDrafts(selected,user,busy,ct);
const {files,fileInput,pickFiles,dropFiles,pasteFiles,removeFile,chooseFiles,previewDraft}=attachmentDrafts;
const drafts=new Map();
watch(draft,text=>{if(selected.value)drafts.set(selected.value,text);},{flush:'sync'});
const wakingId=ref(null),waking=ref(false),wakeError=ref('');let wakeRun=0,disposed=false;
const newOpen=ref(false),infoOpen=ref(false),newTitle=ref(''),memoryDraft=ref('');
const operations=ref({}),operationErrors=ref({});
function activity(c){return agentActivity(c,operations.value[c?.id]);}
const agentLocked=computed(()=>!!activity(detail.value)&&!operationErrors.value[selected.value]);
const agentOperationError=computed(()=>operationErrors.value[selected.value]||'');
// The typing bubbles' lines come from js/conversationStatus.js, shared with the
// split view's cells.
const settlingAfterReply=computed(()=>(secondClock.value,status.settlingAfterReply(detail.value)));
const agentProgress=computed(()=>(secondClock.value,status.progressText(detail.value,{locked:agentLocked.value})));
const backgroundProgress=computed(()=>(secondClock.value,status.backgroundText(detail.value,{locked:agentLocked.value})));
const showViewSwitch=computed(()=>user.value?.role==='admin'&&detail.value?.mode==='claude');
// The chat/terminal switch is hidden until an admin turns it on on the Admin tab. The
// transcript inspector keeps its own condition, so hiding one never hides the other.
const showTerminalSwitch=computed(()=>showViewSwitch.value&&preferenceTerminalSwitch.value);
// The transcript inspector: an admin-only right column showing the raw material
// behind one bubble. Narrow screens never get it — the same content on a phone is
// unreadable, and the panel would take the whole conversation with it.
const WIDE='(min-width: 1024px)';
const inspectorOpen=ref(false),wideScreen=ref(typeof matchMedia==='function'?matchMedia(WIDE).matches:false);
const inspectId=ref(''),inspectData=ref(null),inspectBusy=ref(false),inspectError=ref('');
const inspectorVisible=computed(()=>inspectorOpen.value&&wideScreen.value&&showViewSwitch.value&&!terminalOpen.value&&!agentLocked.value);
const showInspectorButton=computed(()=>wideScreen.value&&showViewSwitch.value&&agentPreferences.transcriptSwitch.value);
let inspectRun=0;
async function inspect(message){
 if(!inspectorVisible.value||!message||message.role==='system')return;
 if(inspectId.value===message.id)return clearInspection();
 // Either bubble of an exchange resolves to the same turn; the server does that.
 const id=message.id;
 inspectId.value=id;inspectError.value='';inspectData.value=null;inspectBusy.value=true;
 const run=++inspectRun,agent=selected.value;
 try{const d=await api('/conversations/'+agent+'/messages/'+encodeURIComponent(id)+'/transcript');
  if(run===inspectRun&&selected.value===agent){inspectData.value=d;}}
 catch(e){if(run===inspectRun)inspectError.value=e.message;}
 finally{if(run===inspectRun)inspectBusy.value=false;}
}
function clearInspection(){inspectRun++;inspectId.value='';inspectData.value=null;inspectError.value='';inspectBusy.value=false;}
// Opening the panel chooses nothing: with no bubble selected it shows what the
// agent carries into every turn — its profile, memory, model and usage — and a
// bubble is only read when one is actually asked for. Clicking the chosen bubble
// again goes back to that view.
function toggleInspector(){
 inspectorOpen.value=!inspectorOpen.value;
 if(!inspectorOpen.value)clearInspection();
 else{profilePanelOpen.value=false;if(wideScreen.value)searchOpen.value=false;}
}
// Agent Profile on a desktop width opens in that same right column instead of a
// popup, beside the conversation; a phone, or the
// terminal view, keeps the popup. The column holds one panel at a time.
const profilePanelOpen=ref(false);
const profilePanelVisible=computed(()=>profilePanelOpen.value&&wideScreen.value&&!terminalOpen.value&&!!detail.value);
function openProfile(){
 if(!wideScreen.value||terminalOpen.value){infoOpen.value=true;return;}
 profilePanelOpen.value=!profilePanelOpen.value;
 if(profilePanelOpen.value&&inspectorOpen.value){inspectorOpen.value=false;clearInspection();}
 if(profilePanelOpen.value)searchOpen.value=false;
}
// Search on a desktop width opens in the same right column, not a popup; a phone, or the terminal view, keeps the popup.
const searchPanelVisible=computed(()=>searchOpen.value&&wideScreen.value&&!terminalOpen.value&&!!detail.value);
const searchPopupOpen=computed(()=>searchOpen.value&&!searchPanelVisible.value);
watch(searchPanelVisible,open=>{if(!open)return;profilePanelOpen.value=false;if(inspectorOpen.value){inspectorOpen.value=false;clearInspection();}nextTick(()=>document.querySelector('.search-panel .message-search-input input')?.focus());});
function toggleSearch(){searchOpen.value=!(searchOpen.value&&searchPanelVisible.value);}
// The agent's checklists: the same right column on a desktop width, a popup on a
// phone or beside the terminal.
const checklistOpen=ref(false);
const checklistPanelVisible=computed(()=>checklistOpen.value&&wideScreen.value&&!terminalOpen.value&&!!detail.value);
const checklistPopupOpen=computed(()=>checklistOpen.value&&!checklistPanelVisible.value&&!!detail.value);
watch(checklistPanelVisible,open=>{if(!open)return;profilePanelOpen.value=false;searchOpen.value=false;if(inspectorOpen.value){inspectorOpen.value=false;clearInspection();}});
watch(()=>[profilePanelOpen.value,searchPanelVisible.value,inspectorOpen.value],([p,s,i])=>{if((p||s||i)&&wideScreen.value)checklistOpen.value=false;});
function toggleChecklist(){checklistOpen.value=!checklistOpen.value;}
const usageRows=computed(()=>agentOperation.usageRows(detail.value?.usage));
const agentOperationTitle=computed(()=>agentOperation.operationTitle(activity(detail.value)));
const agentOperationSteps=computed(()=>{secondClock.value;const d=detail.value;return d?agentOperation.operationSteps(d,activity(d),operations.value[selected.value]):[];});
const agentOperationPercent=computed(()=>agentOperation.operationPercent(detail.value,activity(detail.value)));
function updateAgent(d){conversations.value=conversations.value.map(c=>c.id===d.id?{...c,...d}:c);if(selected.value===d.id)detail.value=d;}
async function runAgentOperation(id,kind,body={}){
 if(operations.value[id])return;
 const owner=user.value?.id,op={kind,generation:(detail.value?.id===id?detail.value:conversations.value.find(c=>c.id===id))?.generation};
 operations.value[id]=op;delete operationErrors.value[id];if(selected.value===id){infoOpen.value=false;profilePanelOpen.value=false;terminalOpen.value=false;}
 // Identify the operation across Vue reactive proxy reads.
 const token=Symbol();op.token=token;
 const current=()=>!disposed&&user.value?.id===owner&&operations.value[id]?.token===token;
 try{
  const d=await agentOperation.settleOperation(id,kind,body,{current,update:updateAgent});
  if(d?.lastError&&current())operationErrors.value[id]=d.lastError;
  return d||undefined;
 }catch(e){if(current())operationErrors.value[id]=e.message;}
 finally{if(current())delete operations.value[id];}
}

// The list keeps its groups and order; Recent sorts by activity. The last view looked
// at is remembered; a device that has none opens on All.
const SOURCE_KEY='cc-agent-list-source';
const storedSource=()=>{try{const value=localStorage.getItem(SOURCE_KEY);return value in SOURCES?value:'all';}catch{return 'all';}};
const listLoaded=ref(false);
const chosenSource=ref(storedSource());
const sourceOfAgent=c=>c.source||'native';
const listSources=computed(()=>['all','recent','native'].map(id=>({value:id,label:id==='all'?ct('全部'):id==='recent'?ct('最近活動'):SOURCES[id].name,icon:SOURCES[id].icon})));
const listSource=computed(()=>listSources.value.some(s=>s.value===chosenSource.value)?chosenSource.value:'all');
function chooseSource(id){if(orderBusy.value)return;chosenSource.value=id;chosenAgents.value=new Set();try{localStorage.setItem(SOURCE_KEY,id);}catch{}}
const mixed=()=>['all','recent'].includes(listSource.value);
const filtered=computed(()=>conversations.value.filter(c=>(mixed()||sourceOfAgent(c)===listSource.value)&&c.title.toLowerCase().includes(search.value.toLowerCase())));
// The list in its groups, as Settings is in sections: the agents in no group first and untitled, then each group in the
// owner's order. An empty group shows only while editing, so it can be filled or
// removed; a search shows only the groups with a match.
const listGroups=agentPreferences.listGroups;
function sourceSections(source){
 const groups=listGroups.value.filter(g=>(g.source||'native')===source),known=new Set(groups.map(g=>g.id)),items=filtered.value.filter(c=>sourceOfAgent(c)===source);
 const out=[{id:null,name:'',items:items.filter(c=>!c.listGroup||!known.has(c.listGroup))},...groups.map(g=>({id:g.id,name:g.name,items:items.filter(c=>c.listGroup===g.id)}))];
 return out.filter(section=>section.items.length||(section.id===null?!groups.length:editMode.value&&!search.value&&listSource.value!=='all'));
}
// All shows the source's title row and each saved group.
const byActivity=(a,b)=>String(b.activeAt||'').localeCompare(String(a.activeAt||''));
const sections=computed(()=>listSource.value==='recent'?[{id:null,name:'',items:[...filtered.value].sort(byActivity)}]:listSource.value!=='all'?sourceSections(listSource.value):['native'].flatMap(source=>{
 const own=sourceSections(source).filter(section=>section.items.length);
 return own.length?[{source,items:[]},...own]:[];
}));
// The same, as the rows of the one list: a title row per group, then its agents.
// An empty group has a slot in Edit mode, a row of its own to drop an agent on:
// the group's title alone, with a hint under it, was a target Framework7 split in
// half, and an agent let go on its lower half from below went above the group, or,
// from just above, stayed put. The slot is a
// position inside the group, as an agent's row would be.
// A group folds away under its title, remembered
// on this device; Edit and a search show every group open.
const COLLAPSED_KEY='cc-agent-collapsed-groups';
const collapsedGroups=ref((()=>{try{const v=JSON.parse(localStorage.getItem(COLLAPSED_KEY)||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}})());
function toggleGroupCollapse(id){const next=collapsedGroups.value.includes(id)?collapsedGroups.value.filter(x=>x!==id):[...collapsedGroups.value,id];collapsedGroups.value=next;try{localStorage.setItem(COLLAPSED_KEY,JSON.stringify(next));}catch{}}
const folded=section=>!!section.id&&!editMode.value&&!search.value&&collapsedGroups.value.includes(section.id);
const listRows=computed(()=>sections.value.flatMap(section=>section.source?[{kind:'source',id:'source:'+section.source,name:SOURCES[section.source].name,icon:SOURCES[section.source].icon}]:[...(section.id?[{kind:'group',id:section.id,name:section.name,empty:!section.items.length,collapsed:folded(section),members:section.items}]:[]),...(section.id&&!section.items.length&&editMode.value?[{kind:'slot',id:'slot:'+section.id,group:section.id}]:[]),...(folded(section)?[]:section.items).map((c,index)=>({kind:'agent',id:c.id,agent:c,group:section.id,last:index===section.items.length-1}))]));
// Group names are the owner's own text, and Framework7 action sheets take HTML.
const escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Edit mode holds the list still between polls, so a change here reloads it itself.
async function reloadList(){const r=await attempt(()=>api('/conversations'));if(r)conversations.value=r.conversations;}
const saveGroups=async groups=>{const saved=await attempt(()=>agentPreferences.saveListPreferences({groups}));if(saved)await reloadList();return saved;};
// Framework7 writes a prompt's starting text into HTML as it is, so it is escaped.
const askGroupName=(title,value,then)=>f7.dialog.prompt(ct('群組名稱'),title,name=>{name=String(name||'').trim();if(name)then(name);},()=>{},escapeHtml(value));
// A new group goes first, where it is seen without scrolling.
function addGroup(){const source='native';askGroupName(ct('新增群組'),'',name=>saveGroups([{name,source},...listGroups.value]));}
// In Edit mode a group is a block like an agent's row: its name is edited where it
// stands, a red button deletes it, and its handle drags it.
const editingGroup=ref(null);
function startGroupRename(group){editingGroup.value=group.id;}
function cancelGroupRename(){editingGroup.value=null;}
async function finishGroupRename(group,value){
 if(editingGroup.value!==group.id)return;   // cancelled, or already saved
 editingGroup.value=null;
 const name=String(value||'').trim();
 if(!name||name===group.name)return;
 await saveGroups(listGroups.value.map(g=>g.id===group.id?{...g,name:name.slice(0,40)}:g));
}
// A whole group was dragged to a new place (src/js/groupDrag.js): shown at once in
// its new place, then saved; a failed save puts the order back as it was.
async function moveGroups(order){
 const before=listGroups.value;
 const next=[...before].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
 listGroups.value=next;
 orderBusy.value=true;
 if(!await saveGroups(next))listGroups.value=before;
 orderBusy.value=false;
}
function deleteGroup(group){
 f7.dialog.confirm(ct('裡面的 Agent 會回到最上面，不會被刪除。'),ct('刪除群組')+'「'+escapeHtml(group.name)+'」',()=>saveGroups(listGroups.value.filter(g=>g.id!==group.id)));
}
const statusLabel=computed(()=>agentOperation.statusLabel(detail.value));
const awaitingReply=computed(()=>(secondClock.value,status.awaitingReply(detail.value)));
// The progress belongs in the typing bubble: that is where the eye already is,
// it says plainly that this reply is being written, and putting it there stops
// the bar from growing and shrinking the page on every turn. The bar is only the
// fallback for an agent busy with no message of the user's to answer — compaction
// shows its own shield — so exactly one of them is ever showing.
// Background work has a typing bubble of its own, above the reply's, so neither line has to carry both.
// Work with no message of the user's to answer, a start's initialization or a turn
// the agent began itself, has the typing bubble too, as a split-view cell already
// did; the bar under the navbar is gone.
const typingBubble=computed(()=>awaitingReply.value||!!agentProgress.value);
const progressInBubble=computed(()=>typingBubble.value?agentProgress.value:'');
const noteInBubble=computed(()=>typingBubble.value?(secondClock.value,status.progressNote(detail.value,{locked:agentLocked.value})):'');
const progressInBar=computed(()=>'');
// The agent's picture wherever it speaks, and its light as on the Agents list:
// working on an operation, online, or offline.
const agentAvatar=computed(()=>detail.value?.avatar||defaultAvatar(detail.value));
const presence=computed(()=>{const d=detail.value;if(!d)return 'offline';return activity(d)?'working':d.connected?'online':'offline';});
// The chat/terminal toggle lives in the navbar now; the subnavbar is only the progress line.
const showSubnavbar=computed(()=>!!progressInBar.value);
// A switch that disappears must not leave the terminal on screen.
watch(showTerminalSwitch,visible=>{if(!visible)terminalOpen.value=false;});
// The terminal replaces the conversation in the same scroller, so coming back
// rebuilt the bubbles at the top and the reader lost their place. Remember where they were before the switch — this runs
// before the DOM changes — and put them back once the bubbles and the composer
// are laid out again.
// The place is the bubble at the top of the view and how far down it sat, not a
// distance: anything added above while away (an older page, a new message) would
// otherwise shift the reader to an earlier bubble.
let chatPlace=null;
function takePlace(box){
 const top=box.getBoundingClientRect().top;
 const bubble=[...box.querySelectorAll('.message[data-message-id]')].find(el=>el.getBoundingClientRect().bottom>top+1);
 return {id:bubble?.dataset.messageId||null,offset:bubble?bubble.getBoundingClientRect().top-top:0,
  scrollTop:box.scrollTop,atBottom:box.scrollHeight-box.scrollTop-box.clientHeight<80};
}
function putBack(box,place){
 if(!place||place.atBottom){box.scrollTop=box.scrollHeight;return;}
 const bubble=place.id?box.querySelector(`.message[data-message-id="${CSS.escape(place.id)}"]`):null;
 if(bubble)box.scrollTop+=bubble.getBoundingClientRect().top-box.getBoundingClientRect().top-place.offset;
 else box.scrollTop=place.scrollTop;
}
// On a desktop the terminal opens as a column beside the conversation, which stays
// where it is; a divider between them sets their
// widths, and dragged far enough left it gives the terminal the whole width.
const terminalSide=computed(()=>terminalOpen.value&&wideScreen.value);
const chatHidden=ref(false);
// The terminal's share of the width, not its pixels: a width set on the full page
// was too wide in a split-view cell, and a cell started at 1:3 instead of 1:1. Cells keep their own share, starting at half.
const CHAT_MIN=360,TERMINAL_MIN=320,TERMINAL_SHARE_KEY=embedded?'cc-terminal-share-cell':'cc-terminal-share';
const terminalShare=ref((()=>{try{const n=Number(localStorage.getItem(TERMINAL_SHARE_KEY));return Number.isFinite(n)&&n>0&&n<1?n:.5;}catch{return .5;}})());
// Never so wide that less than CHAT_MIN is left for the conversation, whatever the window.
const terminalWidthCss=computed(()=>chatHidden.value?'100%':`max(${TERMINAL_MIN}px, min(${(terminalShare.value*100).toFixed(2)}%, calc(100% - ${CHAT_MIN}px)))`);
function startTerminalResize(event){
 const handle=event.currentTarget,pageEl=handle.closest('.chat-page');if(!pageEl)return;
 event.preventDefault();
 const box=pageEl.getBoundingClientRect();
 try{handle.setPointerCapture(event.pointerId);}catch{}
 document.body.classList.add('col-resizing');
 const move=e=>{
  const width=Math.round(box.right-e.clientX);
  if(box.width-width<CHAT_MIN){chatHidden.value=true;return;}
  chatHidden.value=false;terminalShare.value=Math.max(TERMINAL_MIN,width)/box.width;
 };
 const end=()=>{
  handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);
  document.body.classList.remove('col-resizing');
  try{localStorage.setItem(TERMINAL_SHARE_KEY,terminalShare.value.toFixed(4));}catch{}
 };
 handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
}
watch(terminalOpen,open=>{if(!open)chatHidden.value=false;});
watch(terminalOpen,(open,was)=>{
 // Beside the conversation the terminal hides nothing, so there is no place to keep.
 if(wideScreen.value){chatPlace=null;return;}
 const box=scroll.value;
 if(open&&!was){chatPlace=box?takePlace(box):null;return;}
 if(!open&&was){
  const place=chatPlace;chatPlace=null;
  nextTick(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
   const b=scroll.value;if(!b)return;
   putBack(b,place);
   atBottom.value=b.scrollHeight-b.scrollTop-b.clientHeight<80;
  })));
 }
},{flush:'pre'});
// Sending is open while Claude answers too: the message waits in line, as in its
// own terminal. Not while it compacts, which the server refuses.
const canSend=computed(()=>(draft.value.trim()||files.value.length)&&(detail.value?.phase==='ready'||(detail.value?.phase==='busy'&&!detail.value?.compacting))&&!busy.value&&!agentLocked.value);
async function attempt(fn){error.value='';try{return await fn();}catch(e){error.value=e.message;if(e.status===401){detail.value=null;selected.value=null;exitConversationRoute();}return null;}}
function conversationMenu(c,event){const rect=event.currentTarget.getBoundingClientRect();menuPoint.value={clientX:event.clientX||rect.left+rect.width/2,clientY:event.clientY||rect.top+rect.height/2};menuConversation.value=c;}
function renameConversation(c){f7.dialog.prompt(ct("輸入 Agent 名稱"),ct("重新命名"),async title=>{await attempt(()=>api('/conversations/'+c.id+'/rename',{method:'POST',body:JSON.stringify({title})}));const r=await attempt(()=>api('/conversations'));if(r)conversations.value=r.conversations;},()=>{},escapeHtml(c.title));}
function deleteConversation(c){const days=agentPreferences.archiveRetentionDays.value;f7.dialog.confirm(days?ct("停止此對話的 Claude 並從清單移除？紀錄會在本機保留")+' '+days+' '+ct("天後永久刪除，期間可在「已刪除的 Agent」復原。"):ct("停止此對話的 Claude 並從清單移除？紀錄會留在本機，可在「已刪除的 Agent」復原。"),ct("刪除 Agent"),async()=>{await attempt(async()=>{await api('/conversations/'+c.id+'/archive',{method:'POST',body:'{}'});if(selected.value===c.id){terminalOpen.value=false;selected.value=null;detail.value=null;draft.value='';}await refresh();const r=await api('/conversations');conversations.value=r.conversations;});});}
async function loadPreferences(){if(user.value?.role!=='admin')return;await agentPreferences.loadAgentPreferences();}
async function savePreferences(){if(await attempt(()=>agentPreferences.saveAgentPreferences({compactThreshold:preferenceThreshold.value})))f7.toast.create({text:ct("設定已保存"),closeTimeout:1800}).open();}
// On screen means the app is in front, on the Chats tab, with this conversation's
// page showing: then its replies need no push notification.
function conversationOnScreen(){
 if(typeof document==='undefined'||document.hidden)return false;
 const view=document.getElementById('view-chat');
 return !!view?.classList.contains('tab-active')&&view.querySelector('.page-current')?.dataset.name==='conversation';
}
function windowSize(){return Math.min(MESSAGE_WINDOW_MAX,Math.max(MESSAGE_PAGE,detail.value?.messages?.length||MESSAGE_PAGE));}
// The poll asks for the newest window and keeps whatever older pages the reader
// has opened above it: replacing the list outright would throw them back to the
// bottom mid-read. Without an overlap the local pages are stale, so they go.
function mergeMessages(local,fresh){
 if(!local?.length)return fresh;
 const oldest=fresh[0]?.id;
 const seam=oldest?local.findIndex(m=>m.id===oldest):-1;
 const combined=seam<0?fresh:[...local.slice(0,seam),...fresh];
 const byId=new Map(local.map(m=>[m.id,m]));
 const reused=combined.map(m=>{const prev=byId.get(m.id);return prev&&JSON.stringify(prev)===JSON.stringify(m)?prev:m;});
 return reused.length===local.length&&reused.every((m,i)=>m===local[i])?local:reused;
}
// Edit mode holds the rows still, their order and their groups, so a drag is not
// moved under the finger; each agent's state still comes in, so a pause or a start
// shows on its light at once rather than after Done.
function keepRows(local,fresh){const byId=new Map(fresh.map(c=>[c.id,c]));return local.filter(c=>byId.has(c.id)).map(c=>({...byId.get(c.id),listGroup:c.listGroup,listOrder:c.listOrder}));}
// Avoid redrawing unchanged conversations on each poll.
function reuseRows(prev,fresh){const byId=new Map(prev.map(c=>[c.id,c])),next=fresh.map(c=>{const old=byId.get(c.id);return old&&JSON.stringify(old)===JSON.stringify(c)?old:c;});return next.length===prev.length&&next.every((c,i)=>c===prev[i])?prev:next;}
// The list's groups are fetched with it, so a group made on another device shows up here too.
async function refresh(){if(!user.value)return;const owner=user.value.id;const [list,groups]=await Promise.all([api('/conversations'),api('/agent-list').catch(()=>null)]);if(user.value?.id!==owner)return;if(!orderBusy.value){if(groups)agentPreferences.absorbList(groups);const nextRows=reuseRows(conversations.value,editMode.value?keepRows(conversations.value,list.conversations):list.conversations);if(nextRows!==conversations.value)conversations.value=nextRows;listLoaded.value=true;}if(selected.value){const id=selected.value;const d=await api('/conversations/'+id+'?limit='+windowSize()+(conversationOnScreen()?'&viewing=1':''));if(user.value?.id===owner&&selected.value===id){
 const merged=mergeMessages(detail.value?.messages,d.messages||[]);
 const changed=merged.at(-1)?.id!==detail.value?.messages?.at(-1)?.id||merged.length!==detail.value?.messages?.length;
 const next={...d,messages:merged,hasOlder:merged.length>(d.messages||[]).length?(detail.value?.hasOlder??d.hasOlder):d.hasOlder};
 // An answer equal to what is shown is not assigned: a new object renders every message's Markdown again, which drops frames on a phone at each poll.
 if(JSON.stringify(next)!==JSON.stringify(detail.value))detail.value=next;
 if(changed&&atBottom.value)await bottom();}}}
const HISTORY_GESTURE_BLOCKED='a,button,input,textarea,select,option,pre,code,[contenteditable]:not([contenteditable="false"]),.md-scroll,.terminal-pane,.terminal-content';
const noVerticalOverflow=box=>box.scrollHeight<=box.clientHeight+1;
function nestedScroller(target,box){
 for(let el=target;el&&el!==box;el=el.parentElement){
  const style=getComputedStyle(el),vertical=/(auto|scroll|overlay)/.test(style.overflowY)&&el.scrollHeight>el.clientHeight+1;
  const horizontal=/(auto|scroll|overlay)/.test(style.overflowX)&&el.scrollWidth>el.clientWidth+1;
  if(vertical||horizontal)return true;
 }
 return false;
}
function historyGestureBlocked(target,box){
 const el=target?.nodeType===1?target:target?.parentElement;
 return !el||!box?.contains(el)||!!el.closest(HISTORY_GESTURE_BLOCKED)||nestedScroller(el,box);
}
function historyGestureReady(box,target){
 return box===scroll.value&&box?.isConnected&&!agentLocked.value&&!(terminalOpen.value&&!terminalSide.value)&&
  !olderBusy.value&&!pagingBack.value&&detail.value?.hasOlder&&detail.value.messages?.length&&
  noVerticalOverflow(box)&&!historyGestureBlocked(target,box);
}
function resetWheelGesture(){wheelGestureUsed=false;clearTimeout(wheelGestureTimer);wheelGestureTimer=0;}
function noteWheelEvent(){clearTimeout(wheelGestureTimer);wheelGestureTimer=setTimeout(resetWheelGesture,180);}
// One physical wheel or trackpad gesture can send several events. Only the first upward one may load,
// and only when the ten bubbles have no native scroll room. The listener stays passive,
// so normal scrolling still works when there is overflow.
function onHistoryWheel(event){
 noteWheelEvent();
 const box=event.currentTarget;
 if(wheelGestureUsed||event.ctrlKey||event.deltaY>=0||Math.abs(event.deltaX)>=Math.abs(event.deltaY))return;
 if(!historyGestureReady(box,event.target))return;
 wheelGestureUsed=true;loadOlder();
}
// On a touch screen, dragging a short list down is the same as scrolling to earlier messages. A second finger,
// or a mostly horizontal gesture, cancels the whole gesture.
function onHistoryTouchStart(event){
 touchHistoryGesture=null;const run=++touchHistoryRun;
 const box=event.currentTarget;if(event.touches?.length!==1||!historyGestureReady(box,event.target))return;
 const point=event.touches[0];touchHistoryGesture={run,box,target:event.target,id:selected.value,x:point.clientX,y:point.clientY,lastX:point.clientX,lastY:point.clientY,invalid:false};
}
function onHistoryTouchMove(event){
 const gesture=touchHistoryGesture;if(!gesture)return;
 if(event.touches?.length!==1){gesture.invalid=true;return;}
 const point=event.touches[0];gesture.lastX=point.clientX;gesture.lastY=point.clientY;
}
const touchPosition=box=>[box.scrollTop,document.scrollingElement?.scrollTop||0,window.visualViewport?.offsetTop||0,window.visualViewport?.height||0];
const sameTouchPosition=(a,b)=>a&&b&&a.every((value,index)=>Math.abs(value-b[index])<.5);
async function loadOlderAfterTouch(gesture){
 // The listener stays passive; after the finger lifts, the frame where the geometry is stable counts,
 // not a guessed delay. At most 45 frames are watched; a new gesture, conversation or container cancels at once.
 let previous=null,stable=0;
 for(let frame=0;frame<45;frame+=1){
  await layoutFrame();
  if(gesture.run!==touchHistoryRun||selected.value!==gesture.id||scroll.value!==gesture.box||!gesture.box.isConnected)return;
  const current=touchPosition(gesture.box);
  stable=sameTouchPosition(previous,current)?stable+1:0;previous=current;
  if(stable>=5){if(historyGestureReady(gesture.box,gesture.target))loadOlder();return;}
 }
}
function onHistoryTouchEnd(event){
 const gesture=touchHistoryGesture;touchHistoryGesture=null;if(!gesture||gesture.invalid||event.touches?.length)return;
 const point=event.changedTouches?.[0],x=point?.clientX??gesture.lastX,y=point?.clientY??gesture.lastY;
 const dx=x-gesture.x,dy=y-gesture.y;
 if(dy<48||dy<=Math.abs(dx)*1.25||selected.value!==gesture.id)return;
 loadOlderAfterTouch(gesture);
}
function onHistoryTouchCancel(){touchHistoryGesture=null;touchHistoryRun+=1;}
function cancelHistoryPaging(){
 historyPageRun+=1;touchHistoryRun+=1;olderBusy.value=false;pagingBack.value=false;touchHistoryGesture=null;resetWheelGesture();
}
function historyAnchor(box){
 const top=box.getBoundingClientRect().top;
 const bubble=[...box.querySelectorAll('.message[data-message-id]')].find(el=>el.getBoundingClientRect().bottom>top+1);
 return bubble?{id:bubble.dataset.messageId,offset:bubble.getBoundingClientRect().top-top}:null;
}
function restoreHistoryAnchor(box,anchor){
 if(!anchor)return;
 const bubble=box.querySelector(`.message[data-message-id="${CSS.escape(anchor.id)}"]`);if(!bubble)return;
 const delta=bubble.getBoundingClientRect().top-box.getBoundingClientRect().top-anchor.offset;
 const maximum=Math.max(0,box.scrollHeight-box.clientHeight);
 box.scrollTop=Math.max(0,Math.min(maximum,box.scrollTop+delta));
}
const layoutFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
// Until the reader's finger is off and the scroll has come to rest (a phone's
// momentum goes on after the finger lifts): only then is the reading place taken
// and the older page put above it. Taken when the request went out, the place was
// where the reader had been, and putting it back threw the view back each time
// (it jumps, and jumps again, on a phone).
function scrollSettled(box,{quiet=140,longest=2500}={}){
 return new Promise(resolve=>{
  let timer=null,touching=false;
  const finish=()=>{clearTimeout(timer);clearTimeout(limit);box.removeEventListener('scroll',moved);box.removeEventListener('touchstart',down);box.removeEventListener('touchend',up);box.removeEventListener('touchcancel',up);resolve();};
  const wait=()=>{clearTimeout(timer);if(!touching)timer=setTimeout(finish,quiet);};
  const moved=()=>wait(),down=()=>{touching=true;clearTimeout(timer);},up=()=>{touching=false;wait();};
  const limit=setTimeout(finish,longest);
  box.addEventListener('scroll',moved,{passive:true});box.addEventListener('touchstart',down,{passive:true});box.addEventListener('touchend',up,{passive:true});box.addEventListener('touchcancel',up,{passive:true});
  wait();
 });
}
// When a page is loaded backwards, the old bubbles themselves keep the reader's place. When the first ten bubbles
// have no overflow, a height difference would invent blank space; the place is kept by bubble id and position
// relative to the container instead, and clamped only when the browser cannot actually hold it.
async function loadOlder(){
 if(olderBusy.value||!detail.value?.hasOlder||!detail.value.messages?.length)return;
 const run=++historyPageRun,id=selected.value,first=detail.value.messages[0].id,box=scroll.value;
 if(!id||!box)return;
 let loadedOlder=false;
 const current=()=>run===historyPageRun&&selected.value===id&&detail.value&&scroll.value===box&&box.isConnected;
 error.value='';olderBusy.value=true;
 try{
  const page=await api('/conversations/'+id+'?before='+encodeURIComponent(first)+'&limit='+MESSAGE_PAGE);
  if(!current())return;
  const known=new Set(detail.value.messages.map(m=>m.id));
  const older=(page.messages||[]).filter(m=>!known.has(m.id));
  loadedOlder=older.length>0;
  pagingBack.value=true;
  await scrollSettled(box);
  if(!current())return;
  const anchor=historyAnchor(box);
  detail.value={...detail.value,messages:[...older,...detail.value.messages],hasOlder:page.hasOlder};
  await nextTick();
  if(!current())return;
  restoreHistoryAnchor(box,anchor);
  await layoutFrame();
  if(!current())return;
  restoreHistoryAnchor(box,anchor);
  await layoutFrame();
  if(!current())return;
  restoreHistoryAnchor(box,anchor);
 }catch(e){
  // After leaving a conversation, an old request cannot write its error into the new one; a failure in the current
  // conversation keeps the same sign-in recovery as attempt().
  if(current()){
   error.value=e.message;
   if(e.status===401){detail.value=null;selected.value=null;exitConversationRoute();}
  }
 }finally{
  if(run===historyPageRun){
   if(selected.value===id&&scroll.value===box&&box.isConnected){
    atBottom.value=box.scrollHeight-box.scrollTop-box.clientHeight<80;
    // Once earlier content is loaded the reader is in the history, even if short content can only clamp at the bottom;
    // a poll must not take it as still on the latest page and scroll to the bottom again.
    if(loadedOlder)atBottom.value=false;
   }
   pagingBack.value=false;olderBusy.value=false;
  }
 }
}
// A window resized, or a column opened beside the conversation, changes the
// scroller's size: one that sat at the newest bubble stays there (narrowing the window left the view further up each time).
// The scroll the browser fires for that clamp is the layout's, not the reader's.
let boxSize='',boxWatch=null;
const sizeOf=box=>box.clientWidth+'x'+box.clientHeight;
function boxResized(){
 const box=scroll.value;if(!box)return;
 const size=sizeOf(box);if(size===boxSize)return;boxSize=size;
 if(atBottom.value&&!(terminalOpen.value&&!terminalSide.value)&&!pagingBack.value&&!olderBusy.value)box.scrollTop=box.scrollHeight;
}
watch(scroll,box=>{boxWatch?.disconnect();boxWatch=null;boxSize=box?sizeOf(box):'';if(box&&typeof ResizeObserver!=='undefined'){boxWatch=new ResizeObserver(boxResized);boxWatch.observe(box);}},{flush:'post'});
// The reader's position drives two things: whether a new reply scrolls the view,
// and whether the jump-to-latest button is offered.
function onMessagesScroll(event){
 const box=event?.target;if(!box)return;
 // The terminal shares this scroller; its position says nothing about the
 // conversation, and reading it here loaded older pages behind the terminal.
 if(terminalOpen.value&&!terminalSide.value)return;
 if(box===scroll.value&&sizeOf(box)!==boxSize){boxResized();return;}
 atBottom.value=box.scrollHeight-box.scrollTop-box.clientHeight<80;
 // Start loading before the reader reaches the top, so a prepend during a phone's momentum scroll does not jump.
 // The anchor correction itself moves the container over two layout frames, so further loads are held off throughout.
 if(!pagingBack.value&&!olderBusy.value&&!noVerticalOverflow(box)&&box.scrollTop<400)loadOlder();
}
// Back to the newest bubbles, whatever was loaded above them.
async function toLatest(){
 const id=selected.value;if(!id)return;
 cancelHistoryPaging();
 await attempt(async()=>{
  const d=await api('/conversations/'+id+'?open=1&limit='+MESSAGE_PAGE);
  if(selected.value===id)detail.value=d;
 });
 atBottom.value=true;
 await bottom();
}
// What was said, in one's own conversations or in one of them; the server does the looking, over every page.
async function searchMessages(q,conversationId){
 return api('/conversations/search',{method:'POST',body:JSON.stringify({q,...(conversationId?{conversationId}:{})})});
}
// A conversation opened at one message a search found: older pages come in until
// it is there, then it is brought into view and marked for a moment. The pages stay
// joined to the newest, so the poll and the way back to the latest work as ever.
async function showMessage(conversationId,messageId){
 jumping.value=true;
 try{return await jumpTo(conversationId,messageId);}finally{jumping.value=false;}
}
// The page scrolls to the newest bubbles once it has slid in, unless a search is
// taking the reader to an older one: that slide ends after the jump.
function enterConversation(){if(!jumping.value&&!foundMessage.value)bottom();}
async function jumpTo(conversationId,messageId){
 if(selected.value!==conversationId)await select(conversationId);
 const id=conversationId;
 if(selected.value!==id||!detail.value)return false;
 // From here the reader is going somewhere older: no poll pulls them to the bottom.
 jumpSeq++;atBottom.value=false;
 // A page the reader's scrolling asked for keeps their distance from the bottom
 // when it lands, which would undo this jump: let it land first, and hold it off.
 for(let n=0;n<100&&olderBusy.value;n++)await new Promise(resolve=>setTimeout(resolve,50));
 olderBusy.value=true;pagingBack.value=true;
 try{
  for(let n=0;n<50&&detail.value?.hasOlder&&!detail.value.messages.some(m=>m.id===messageId);n++){
   const first=detail.value.messages[0]?.id;if(!first)break;
   const page=await attempt(()=>api('/conversations/'+id+'?before='+encodeURIComponent(first)+'&limit='+MESSAGE_WINDOW_MAX));
   if(!page||selected.value!==id||!detail.value)return false;
   const known=new Set(detail.value.messages.map(m=>m.id));
   detail.value={...detail.value,messages:[...(page.messages||[]).filter(m=>!known.has(m.id)),...detail.value.messages],hasOlder:page.hasOlder};
  }
  // On a phone the page may still be sliding in, its bubbles not drawn yet.
  let box=null,el=null;
  for(let n=0;n<60&&!el;n++){
   await nextTick();
   box=scroll.value;el=box?.querySelector(`.message[data-message-id="${CSS.escape(messageId)}"]`);
   if(!el)await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!box||!el)return false;
  jumpSeq++;atBottom.value=false;
  box.closest('.page')?.dispatchEvent(new CustomEvent('conversation:unpin'));
  box.scrollTop+=el.getBoundingClientRect().top-box.getBoundingClientRect().top-box.clientHeight/3;
 }finally{
  olderBusy.value=false;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{pagingBack.value=false;}));
 }
 foundMessage.value=messageId;
 setTimeout(()=>{if(foundMessage.value===messageId)foundMessage.value=null;},2600);
 return true;
}
// The agent being opened, while its page loads: a second request for it (a
// notification seen by the worker's message and again on waking) is the same tap.
const openingId=ref(null);
// A cover over the Agents list while a conversation named by a notification or the
// address is on its way, so the list is not seen first. Up from the start when the address names an agent; gone once the
// conversation is shown, or after a while whatever happens.
// The app starts under this cover and leaves it once it has looked for a tapped
// notification (the list is only the first screen when
// nothing else was asked for); it comes back while the app is away on the list, for
// a tap that raises it.
const directOpening=ref(false);
// The Agents tab opens on its start page (routes.js) and leaves it once the first
// look for a tapped notification is over, for the list or that conversation.
const atStart=ref(true);
// Left only once someone is signed in: the eight-second fallback firing behind the
// sign-in screen used to spend the start page's one exit, and the Agents tab then
// stayed on its spinner after signing in. Whether
// to leave is read from the router, not from the flag alone, for the same reason.
function leaveStart(){
 const router=f7.views?.get('#view-chat')?.router;
 if(!router){if(atStart.value)setTimeout(leaveStart,100);return;}
 if(router.currentRoute.path!=='/start/'){atStart.value=false;return;}
 if(!user.value)return;
 if(router.allowPageChange===false){setTimeout(leaveStart,50);return;}
 atStart.value=false;router.navigate('/',{reloadAll:true,animate:false});
}
setTimeout(leaveStart,8000);
let uncoverTimer=null;
// Until the first look for a tapped notification is over, waking and focus do not
// lift the cover: on a cold start the focus that comes with it lifted it after 0.7 s
// while the list was still loading, and the empty list showed first.
let startupLooking=true;
function uncoverSoon(ms){clearTimeout(uncoverTimer);uncoverTimer=setTimeout(()=>{if(!startupLooking&&!openingId.value&&!selecting.value)directOpening.value=false;},ms);}
// Leaving a conversation for the list ends any opening still on its way: it came
// back after the reader had gone back and pulled them into a blank conversation.
function cancelOpening(){opening+=1;openingId.value=null;selecting.value=false;directOpening.value=false;}
// The conversation's back control: always the Agents list, however it was opened
// (a notification, an @, a group), with nothing stacked in between.
function toList(){
 cancelOpening();writeUrl(null);
 const router=f7.views?.get('#view-chat')?.router;if(!router)return;
 const h=router.history||[];
 if(h.length>=2&&h[h.length-2]==='/')router.back();else router.back('/',{force:true});
}
// A tap on a notification (or an address naming the agent) shows the conversation
// straight away, loading, with no slide in from the list; a tap on the list slides in once the conversation has loaded.
async function toConversation(router,run,animate){
 if(router.currentRoute.url==='/conversation/')return true;
 // From the start page, the conversation takes its place; back then goes to the list.
 const fromStart=router.currentRoute.path==='/start/';
 if(fromStart)atStart.value=false;
 // Only the list below a conversation: back and the edge swipe then go there.
 else if(router.currentRoute.path!=='/'){
  router.back('/',{force:true,animate:false});
  for(let n=0;n<40&&(router.currentRoute.path!=='/'||router.allowPageChange===false);n++)await new Promise(resolve=>setTimeout(resolve,25));
  if(run!==opening)return false;
 }
 // A navigate while the router is still busy (starting up, or a page change under
 // way) is dropped; the cover then came off over the list. Asked again until the conversation is the current page.
 for(let n=0;n<60&&router.currentRoute.url!=='/conversation/';n++){
  if(router.allowPageChange!==false)router.navigate('/conversation/',fromStart?{reloadAll:true,animate:false}:{animate});
  await new Promise(resolve=>setTimeout(resolve,50));
  if(run!==opening)return false;
 }
 return router.currentRoute.url==='/conversation/';
}
async function select(id,{direct=false}={}){
 if(id&&id===openingId.value)return;
 const run=++opening,owner=user.value?.id;if(!owner)return;
 openingId.value=id;
 // Its unread count goes the moment it is tapped, not once the page is on screen a
 // second or two later; the server marks it read with
 // the same request (viewing=1), so a list refresh in between does not bring it back.
 const row=conversations.value.find(c=>c.id===id);if(row?.unread)row.unread=0;
 cancelHistoryPaging();
 setActiveTab('view-chat');terminalOpen.value=false;clearInspection();detail.value=null;selected.value=null;selecting.value=true;
 if(direct){
  directOpening.value=true;
  const router=f7.views?.get('#view-chat')?.router;
  if(router&&!(await toConversation(router,run,false))){if(run===opening)directOpening.value=false;return;}
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(run===opening)directOpening.value=false;}));
 }
 try{
  const d=await attempt(()=>api('/conversations/'+encodeURIComponent(id)+'?open=1&viewing=1&limit='+MESSAGE_PAGE));
  if(run!==opening||user.value?.id!==owner)return;
  if(!d){selected.value=null;writeUrl(null);exitConversationRoute();return;}
  // Auth/installation gate can mount the F7 view after the request completes.
  for(let n=0;n<100&&!f7.views?.get('#view-chat')?.router;n++)await new Promise(resolve=>setTimeout(resolve,50));
  if(run!==opening||user.value?.id!==owner)return;
  const router=f7.views?.get('#view-chat')?.router;if(!router)return;
  selected.value=id;detail.value=d;draft.value=drafts.get(id)||'';
  writeUrl(id);
  if(!(await toConversation(router,run,true)))return;
  await bottom();
 }finally{if(run===opening){selecting.value=false;openingId.value=null;directOpening.value=false;}}
}
async function restoreUrl(){
 const id=agentIdFromUrl(location.href);
 if(id){await select(id,{direct:true});return;}
 opening++;selected.value=null;detail.value=null;terminalOpen.value=false;
 exitConversationRoute();
}
// Last-resort self-heal: the conversation page is mounted but no agent is
// selected and nothing is loading one, so this route can no longer recover on
// its own. Backing out is what the user would otherwise have to force by hand.
function recoverOrphanedConversation(){if(!selected.value&&!selecting.value)exitConversationRoute();}
// A jump to a searched message outranks a scroll to the newest that was already on
// its way: a poll or the typing bubble asked for the bottom a moment before the jump
// landed, and finished after it, so the first tap seemed to do nothing. Each jump moves this on; a bottom from before it is dropped.
let jumpSeq=0;
async function bottom(){const seq=jumpSeq;await nextTick();if(seq!==jumpSeq)return;if(scroll.value){measureComposer(scroll.value.closest('.page'));scroll.value.scrollTop=scroll.value.scrollHeight;}}
// A typing bubble that appears, changes its line or goes away changes the list's
// height as a new message does, so a reader at the bottom stays there: it sat half
// under the composer.
// Each is watched for its own value: one getter returning a fresh array fired on every
// poll, which pulled a reader who had scrolled up a little back down.
watch([typingBubble,progressInBubble,noteInBubble,backgroundProgress,()=>detail.value?.terminalPrompt?.key],()=>{if(atBottom.value&&(!terminalOpen.value||terminalSide.value))bottom();},{flush:'post'});
function openNewChat(){newProfile.value=blankProfile(true);error.value='';wakeError.value='';newOpen.value=true;loadPreferences().catch(()=>{});}
async function create(){
 if(waking.value||busy.value)return;
 waking.value=true;busy.value=true;wakeError.value='';const run=++wakeRun;
 try{const c=await api('/conversations',{method:'POST',body:JSON.stringify(newProfile.value),signal:AbortSignal.timeout(120000)});if(run!==wakeRun)return;newOpen.value=false;await select(c.id);}
 catch(e){if(run===wakeRun){wakeError.value=e.message;f7.dialog.alert(e.message,ct('新增 agent'));}}
 finally{if(run===wakeRun){busy.value=false;waking.value=false;}}
}
function closeNew(){wakeRun++;waking.value=false;newOpen.value=false;}

// A draft naming one of Claude Code's own commands runs in the agent's terminal
// instead (js/slashMenu.js); the terminal opens beside the chat to show what it
// printed. Only an admin has the terminal, so only an admin's draft goes there.
const slash=useSlashMenu({draft,conversationId:selected});
// "@" names another agent, for this one to reach across sessions.
// Group chats too, first: the agent may then speak in the one named.
const mention=useMentionMenu({draft,agents:computed(()=>user.value?.role!=='admin'?[]:[...chatGroups.value.map(g=>({id:g.id,title:g.name,group:true,section:ct('群聊')})),...inSections(conversations.value.filter(c=>c.id!==selected.value),listGroups.value).map(c=>({id:c.id,title:c.title,avatar:c.avatar,source:c.source,provider:c.provider,section:c.section})),...(detail.value?.peerLink?.targets||[]).map(t=>({id:'peer:'+t.pairId+':'+t.agentId,title:t.to,avatar:t.icon||undefined,section:ct('另一台電腦')}))])});
const mentionCaret=()=>caretToEnd(scroll.value?.closest('.page'));
function pickMention(item){mention.complete(item,mentionCaret);}
async function runSlashCommand(id,text){
 busy.value=true;
 await attempt(async()=>{
  await api('/conversations/'+id+'/command',{method:'POST',body:JSON.stringify({command:text.trim()})});
  if(drafts.get(id)===text)drafts.delete(id);if(selected.value===id&&draft.value===text)draft.value='';
  if(showTerminalSwitch.value&&selected.value===id)terminalOpen.value=true;
  await refresh();await bottom();
 });
 busy.value=false;
}
function composerKeydown(e){if(slash.onKeydown(e,send))return;if(mention.onKeydown(e,mentionCaret))return;if(e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey)enterSend(e);}
async function send(){if(!canSend.value)return;if(!files.value.length&&user.value?.role==='admin'&&detail.value?.mode==='claude'&&await slash.resolveTerminal(draft.value))return runSlashCommand(selected.value,draft.value);const id=selected.value,text=draft.value,items=[...files.value],requestId=attachmentDrafts.requestId(id,text,items);busy.value=true;await attempt(async()=>{const attachmentIds=await attachmentDrafts.upload(id,items);await api('/conversations/'+id+'/messages',{method:'POST',body:JSON.stringify({text,requestId,attachmentIds,mentions:mention.current.value.map(m=>m.id)})});attachmentDrafts.sent(id,items);if(drafts.get(id)===text)drafts.delete(id);if(selected.value===id&&draft.value===text)draft.value='';await refresh();await bottom();});busy.value=false;}

function enterSend(e){if(!shouldSendOnEnter(e,f7.device))return;e.preventDefault();send();}
async function action(name,body={}){
 const id=selected.value;
 if(['compact','rotate','start'].includes(name))return runAgentOperation(id,name,body);
 if(operations.value[id])return;
 return attempt(async()=>{const owner=user.value?.id;const d=await api('/conversations/'+id+'/'+name,{method:'POST',body:JSON.stringify(body)});if(user.value?.id!==owner)return;updateAgent(d);await refresh();return d;});
}
// Esc for the web page: stops the reply being written, keeps the agent and the
// conversation, and lets the next message go straight in.
const interrupting=ref(false);
const canInterrupt=computed(()=>detail.value?.mode==='claude'&&detail.value?.phase==='busy'&&!detail.value?.compacting&&!settlingAfterReply.value);
async function interruptTurn(){
 if(interrupting.value||!canInterrupt.value)return;
 interrupting.value=true;
 try{await action('interrupt');}finally{interrupting.value=false;}
}
// Esc on the keyboard stops it too, as in Claude Code's own terminal, beside the
// stop button. Not while composing in an input
// method, whose Esc cancels the composition; not with a dialog, popup or preview
// open, which Esc closes; and not in the terminal, which passes Esc to Claude.
const MODAL_OPEN='.dialog.modal-in,.popup.modal-in,.sheet-modal.modal-in,.popover.modal-in,.actions-modal.modal-in,[aria-modal="true"]';
// Each conversation keeps its own search: another agent's words and results do not
// follow the reader into this one. Kept for the
// session only.
const searchByConversation=new Map();
watch(selected,(next,prev)=>{if(prev)searchByConversation.set(prev,searchText.value);searchText.value=next?searchByConversation.get(next)||'':'';searchOpen.value=false;});
// Cmd+F on a Mac, Ctrl+F elsewhere, opens the search, as a desktop browser's own
// find does: a conversation's search on its page,
// the Agents list's search box on the list. Ctrl+F stays the terminal's own on a Mac.
const onMac=typeof navigator!=='undefined'&&/mac|iphone|ipad/i.test(navigator.userAgentData?.platform||navigator.platform||'');
function onFind(event){
 if(event.key?.toLowerCase()!=='f'||event.shiftKey||event.altKey||event.isComposing||(onMac?!event.metaKey||event.ctrlKey:!event.ctrlKey||event.metaKey))return;
 if(event.target?.closest?.('.terminal-pane'))return;
 const current=document.querySelector('#view-chat.tab-active .page-current, #view-chat .page-current');
 if(current?.dataset.name==='conversation'&&selected.value&&!embedded){
  event.preventDefault();
  if(searchOpen.value)document.querySelector('.search-panel .message-search-input input, .message-search-popup .message-search-input input')?.focus();
  else if(!document.querySelector(MODAL_OPEN))searchOpen.value=true;
 }else if(current?.dataset.name==='chats'&&!document.querySelector(MODAL_OPEN)){
  const input=current.querySelector('.agent-search input');
  if(input){event.preventDefault();input.focus();input.select?.();}
 }
}
function onEscape(event){
 if(event.key!=='Escape'||event.isComposing||event.keyCode===229||event.defaultPrevented)return;
 if(!canInterrupt.value||interrupting.value)return;
 if(!document.querySelector('#view-chat .page-current[data-name="conversation"]')||document.querySelector(MODAL_OPEN))return;
 if(event.target?.closest?.('.terminal-pane'))return;
 event.preventDefault();interruptTurn();
}
// Copying code from the bubbles lives with the bubbles, in components/MessageList.vue.
function pause(){f7.dialog.confirm(ct("暫停會中斷執行中的回覆。聊天紀錄仍會保留。"),ct("暫停執行"),()=>action('stop'));}
// A pause and a start, so it also ends a turn still running; the session and chat are kept.
function restart(){f7.dialog.confirm(ct("重啟會中斷執行中的回覆，並接回同一個 session。聊天紀錄仍會保留。"),ct("重啟"),async()=>{if(await action('stop'))await action('start');});}
// From a row's swipe on the Agents list, for that agent rather than the open one.
// Pausing one that is answering asks first, as the pause in its profile does.
async function listAgentAction(c,kind){await attempt(async()=>{await api('/conversations/'+c.id+'/'+kind,{method:'POST',body:'{}'});await refresh();});}
function pauseAgent(c){const go=()=>listAgentAction(c,'stop');if(c.phase==='busy')f7.dialog.confirm(ct("暫停會中斷執行中的回覆。聊天紀錄仍會保留。"),ct("暫停執行")+'「'+c.title+'」',go);else go();}
function startAgent(c){return listAgentAction(c,'start');}
function handoff(){f7.dialog.confirm(ct("保存記憶與近期討論，接續到新的 Claude session？"),ct("接續對話"),()=>action('rotate'));}
// Bring the turns that happened outside this page (the owner's terminal, a
// session driven by a channel plugin) into the conversation. Pressing it twice adds nothing, and it
// takes back an imported bubble later recognised as start-up rather than a turn.
// The counts come with the answer: the page holds only a window of bubbles.
async function importHistory(){
 const d=await action('import-history');
 if(!d)return;
 const {added=0,removed=0}=d.imported||{};
 const text=[added>0&&ct('已補上 session 裡的對話')+'（'+added+'）',removed>0&&ct('已移除不是對話的內容')+'（'+removed+'）'].filter(Boolean).join('，')||ct('沒有可補的對話');
 f7.toast.create({text,closeTimeout:2200}).open();
 if(added>0)await bottom();
}
// The agent's own picture, cut to a small square first (js/agentOperation.js).
async function uploadAvatar(file){
 const id=detail.value?.id;if(!file||!id)return;
 const d=await attempt(async()=>api('/conversations/'+id+'/avatar',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await agentOperation.squarePicture(file)}));
 if(d){updateAgent(d);f7.toast.create({text:ct('Agent 圖像已更新'),closeTimeout:1800}).open();}
}
function resetAvatar(){
 const id=detail.value?.id;if(!id)return;
 f7.dialog.confirm(ct('改回預設的 Agent 圖示？'),ct('還原預設圖像'),async()=>{const d=await attempt(()=>api('/conversations/'+id+'/avatar',{method:'DELETE'}));if(d)updateAgent(d);});
}
async function saveMemory(){if(await action('memory',{text:memoryDraft.value}))f7.toast.create({text:ct("記憶已保存"),closeTimeout:1800}).open();}
const profileForSave=()=>agentOperation.followSetting(profileDraft.value);
async function saveProfile(){if(profileSaving.value)return;profileSaving.value=true;const r=await action('profile',profileForSave());profileSaving.value=false;if(r){profileDraft.value={...profileDraft.value,profileVersion:r.profileVersion};infoOpen.value=false;f7.toast.create({text:ct('設定已保存'),closeTimeout:1800}).open();}}
// The draft is taken when Agent Profile opens, in either form, and again when the
// open panel moves to another agent — never on the 1.2 s refresh, which would undo typing.
watch(()=>[infoOpen.value||profilePanelVisible.value,detail.value?.id],([open,id],[wasOpen,wasId]=[])=>{if(open&&detail.value&&(!wasOpen||id!==wasId)){profileDraft.value=agentOperation.profileDraftOf(detail.value);memoryDraft.value=detail.value.memory||'';error.value='';}},{immediate:true});
const time=s=>new Date(s).toLocaleTimeString(timeLocale(),{hour:'2-digit',minute:'2-digit'});
// The conversation the page was opened on — a notification, or an address someone
// kept — read once at load: the address is rewritten as the user moves around, so
// reading it after sign-in could find it already replaced.
let launchAgentId=typeof location!=='undefined'?agentIdFromUrl(location.href):null;
// Whether the first load after signing in is through, so an agent opened now stays
// open. Before that, a notification's agent waits for it: opened while the app was
// still starting, it was dropped or undone, and a tap on a notification left the
// reader on the Agents list.
let signedIn=false;
async function openNotification(){const id=launchAgentId;launchAgentId=null;if(id&&user.value)await select(id,{direct:true});}
// A tapped notification (js/notification-open.js): the address the worker posted, or
// left in its cache for an app reopened from the background. What it opens is ours.
// A tap left in the cache, once signed in:
async function openPendingNotification(url){
 const id=agentIdFromUrl(url);
 // The agent open in the Agents tab is not on screen from another tab: a tap on its
 // notification from the Groups tab stayed there.
 if(id&&(id!==selected.value||activeTab.value!=='view-chat'))await attempt(()=>select(id,{direct:true}));
 else{const group=groupIdFromUrl(url);if(group)openGroup(group);}
}
// A group's notification: the Groups tab, that group's room.
function groupIdFromUrl(href){try{const g=new URL(href,location.origin).searchParams.get('group');return g&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g)?g:null;}catch{return null;}}
// The Groups tab has two pages, the list and one room, as the Agents tab has the
// list and one conversation: a room opens over the
// list, another room takes its place, and back is always the list.
function openGroup(group){
 setActiveTab('view-groups');
 const router=f7.views?.get('#view-groups')?.router;if(!router)return;
 if(router.currentRoute.path==='/group/'&&router.currentRoute.query?.id===group)return;
 const url='/group/?id='+encodeURIComponent(group);
 if(router.currentRoute.path==='/group/'){router.navigate(url,{reloadCurrent:true});return;}
 if(router.currentRoute.path!=='/groups/')router.back('/groups/',{force:true,animate:false});
 router.navigate(url);
}
function toGroups(){
 const router=f7.views?.get('#view-groups')?.router;if(!router)return;
 const h=router.history||[];
 if(h.length>=2&&h[h.length-2]==='/groups/')router.back();else router.back('/groups/',{force:true});
}
// A notification tapped while the app is already open: the service worker posts
// the address here.
async function openPostedNotification(target){
 const id=agentIdFromUrl(target.href);
 if(id){if(user.value&&signedIn){launchAgentId=null;await attempt(()=>select(id,{direct:true}));}else launchAgentId=id;return;}
 const group=groupIdFromUrl(target.href);
 if(group&&user.value&&signedIn){openGroup(group);return;}
 // Anything else a notification points at (a scope report) is a normal load.
 if(target.search&&target.search!==location.search)location.replace(target.href);
}

const notifications=createNotificationOpener({fromMessage:openPostedNotification,fromCache:openPendingNotification,canOpen:()=>!!user.value});
// Coming back to the front, the cover over a page that will open a conversation; the
// notification opener looks for a tap at the same moments (it listens itself).
function onAppVisible(){
 if(document.visibilityState==='hidden'){if(!embedded&&user.value&&activeTab.value==='view-chat'&&!selected.value){clearTimeout(uncoverTimer);directOpening.value=true;}return;}
 uncoverSoon(700);
}
// Some builds raise a backgrounded home-screen app with focus alone.
function onAppFocus(){if(directOpening.value)uncoverSoon(700);}
let poll,fetching=false,live=null,liveChanged=false,lastRefresh=0,lastView='',lastViewAt=0;
// With the live socket up the page fetches when the server says something changed,
// and once in a while regardless; without it, every tick as before.
const LIVE_SAFETY_MS=20000;
async function tick(){
 if(fetching||!user.value||document.hidden)return;
 if(live?.connected()){
  // The group open on the Groups tab is what is watched there (groups.js).
  const inGroup=activeTab.value==='view-groups'&&!!viewingGroup.value;
  const id=inGroup?viewingGroup.value:selected.value||null,onScreen=inGroup?!document.hidden:!!id&&conversationOnScreen(),key=id+':'+onScreen;
  if(key!==lastView||Date.now()-lastViewAt>2000){live.view(id,onScreen);lastView=key;lastViewAt=Date.now();}
  if(!liveChanged&&Date.now()-lastRefresh<LIVE_SAFETY_MS)return;
 }
 liveChanged=false;fetching=true;lastRefresh=Date.now();
 try{await attempt(refresh);}finally{fetching=false;}
 if(liveChanged)tick();
}
watch(user,async(next,prev)=>{if(next?.id===prev?.id)return;signedIn=false;opening++;cancelHistoryPaging();closeNew();busy.value=false;operations.value={};operationErrors.value={};drafts.clear();conversations.value=[];listLoaded.value=false;agentPreferences.listGroups.value=[];selected.value=null;detail.value=null;draft.value='';terminalOpen.value=false;// No one yet is also the moment before the sign-in check answers: the cover stays
// (it shows only to someone signed in), for the look that follows it.
if(!next)return;
// The start page is left eight seconds after signing in however the first load is
// going: a request that never answers would otherwise keep the app on the spinner,
// and the eight seconds counted from load may pass before anyone is signed in.
const giveUp=setTimeout(()=>{if(user.value?.id===next.id){startupLooking=false;uncoverSoon(0);leaveStart();}},8000);
try{await attempt(loadPreferences);await attempt(agentPreferences.loadListPreferences);await attempt(refresh);await nextTick();if(user.value?.id!==next.id)return;signedIn=true;if(next.role==='admin')loadGroups().catch(()=>{});await openNotification();await notifications.look();}finally{clearTimeout(giveUp);if(user.value?.id===next.id){startupLooking=false;uncoverSoon(0);leaveStart();}}},{immediate:true});
let unwatchWidth;
onMounted(()=>{
 const query=matchMedia(WIDE);const track=()=>{wideScreen.value=query.matches;if(!query.matches)clearInspection();};
 query.addEventListener('change',track);unwatchWidth=()=>query.removeEventListener('change',track);track();
 window.addEventListener('popstate',restoreUrl);notifications.start();
 document.addEventListener('visibilitychange',onAppVisible);window.addEventListener('focus',onAppFocus);document.addEventListener('keydown',onEscape);document.addEventListener('keydown',onFind);
 // The same word goes to the Schedules page, which has no socket of its own.
 // The build it names goes to the update check (js/live-connection.js).
 live=openLiveConnection({onSignedOut:()=>verifyAuth(),tracksPresence:()=>!!user.value,onChanged:()=>{liveChanged=true;tick();if(user.value?.role==='admin')loadGroups().catch(()=>{});window.dispatchEvent(new Event('cc-agent-changed'));}});
 poll=setInterval(tick,1200);});
onUnmounted(()=>{boxWatch?.disconnect();document.removeEventListener('keydown',onEscape);document.removeEventListener('keydown',onFind);window.removeEventListener('popstate',restoreUrl);notifications.stop();document.removeEventListener('visibilitychange',onAppVisible);window.removeEventListener('focus',onAppFocus);unwatchWidth?.();disposed=true;cancelHistoryPaging();operations.value={};clearInterval(poll);live?.close();live=null;wakeRun++;});

return {unreadOf,unreadLabel,unreadTotal,mixedList:computed(mixed),chosenByPresence,chooseByPresence,atStart,directOpening,toGroups,openingId,toList,cancelOpening,toggleGroupCollapse,openGroup,mention,pickMention,checklistOpen,checklistPanelVisible,checklistPopupOpen,toggleChecklist,typingBubble,searchPanelVisible,searchPopupOpen,toggleSearch,enterConversation,searchOpen,searchText,foundMessage,searchMessages,showMessage,noteInBubble,pauseAgent,startAgent,allChosen,toggleAllChosen,slash,composerKeydown,chosenList,isChosen,toggleChosen,groupChosen,toggleGroupChosen,terminalSide,chatHidden,terminalWidthCss,startTerminalResize,moveGroups,listRows,sections,listGroups,listSources,listSource,chooseSource,addGroup,editingGroup,startGroupRename,cancelGroupRename,finishGroupRename,deleteGroup,uploadAvatar,resetAvatar,autoSort:agentPreferences.autoSort,backgroundProgress,agentAvatar,presence,embedded,recoverOrphanedConversation,activity,progressInBubble,progressInBar,showViewSwitch,showTerminalSwitch,showSubnavbar,usageRows,olderBusy,pagingBack,atBottom,loadOlder,onMessagesScroll,onHistoryWheel,onHistoryTouchStart,onHistoryTouchMove,onHistoryTouchEnd,onHistoryTouchCancel,toLatest,
 inspectorOpen,inspectorVisible,showInspectorButton,profilePanelOpen,profilePanelVisible,openProfile,wideScreen,inspectId,inspectData,inspectBusy,inspectError,inspect,toggleInspector,clearInspection,agentLocked,agentOperationTitle,agentOperationSteps,agentOperationPercent,agentOperationError,newProfile,profileDraft,profileSaving,saveProfile,files,fileInput,pickFiles,dropFiles,pasteFiles,removeFile,chooseFiles,previewDraft,ct,generation,user,busy,error,theme,menuConversation,menuPoint,preferenceThreshold,editMode,orderBusy,toggleEdit,bulkBusy,pauseEveryAgent,startEveryAgent,restartEveryAgent,reorderChats,onChatsIn,terminalOpen,conversations,selected,detail,search,draft,scroll,newOpen,infoOpen,newTitle,memoryDraft,filtered,statusLabel,awaitingReply,canSend,conversationMenu,renameConversation,deleteConversation,savePreferences,wakingId,waking,wakeError,closeNew,openNewChat,create,select,bottom,send,enterSend,action,interrupting,canInterrupt,interruptTurn,pause,restart,handoff,importHistory,saveMemory,time,renderMarkdown,renderTypedMarkdown};
}
