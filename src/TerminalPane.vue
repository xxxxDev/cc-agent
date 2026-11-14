<template><section class="terminal-pane" :style="bg?{'--terminal-bg':bg}:null">
 <!-- One slim line: the state, and right after it a small icon to attach again at any
      time, such as when the screen looks stuck. A full-width button took a band of
      the screen, and the note under the terminal is gone too. -->
 <!-- In the terminal page's tabs (TerminalTabs.vue) the line names the tab and its folder,
      and says the state only while the line is not up. -->
 <div class="terminal-bar" :class="{focused}"><span class="terminal-status" :class="{on:status==='終端已連線'}" role="status"><template v-if="label"><b class="terminal-label">{{label}}</b><span v-if="status!=='終端已連線'||path!==label" class="terminal-path">{{status==='終端已連線'?path:ct(status)}}</span></template><template v-else>{{ct(status)}}</template></span><f7-link class="terminal-reattach" icon-only icon-f7="arrow_clockwise" :aria-label="ct('重新附接')" :title="ct('重新附接')" @click="connect(true)"/><f7-link v-if="choosable" class="terminal-choose" icon-only icon-f7="arrow_right_arrow_left" :aria-label="ct('切換這格的分頁')" :title="ct('切換這格的分頁')" @click.stop="emit('choose',$event)"/></div>
 <div ref="host" class="terminal-host"/>
 <!-- Keys a phone keyboard does not have, for Claude Code's menus: Esc to back out,
       arrows to choose, Shift+Tab for the mode (a
       slash command opened the terminal and nothing could close its menu). They
       send without taking the focus, so the keyboard stays where it was. Under the
       terminal, so they sit right above the keyboard: keys named in words and arrows as
       arrows in one capsule, and a round button that brings the keyboard up or puts it
       away. -->
  <!-- The chat's own box over the keys, its text typed into the terminal on send: for
       writing a longer line, or with the phone's own dictation and correction, before it
       goes. -->
  <ChatComposer v-if="touch&&composing" ref="composer" class="terminal-compose" editor-id="" v-model:value="draft" :placeholder="ct('訊息或指令')" :status="uploading?ct('附件上傳中…'):''"><template #before-inner><div v-if="files.length" class="attachment-drafts" :aria-label="ct('附件')"><DraftPictures :files="files" :removable="!uploading" @remove="removeFile"/><div v-if="!files.every(isDraftPicture)" class="attachment-draft-files"><template v-for="file in files" :key="file.key"><div v-if="!isDraftPicture(file)" class="attachment-chip"><span :title="file.name">{{file.name}} <small>{{file.size<1024?file.size+' B':(file.size/1024).toFixed(1)+' KB'}}</small></span><f7-link v-if="!uploading" icon-only icon-f7="xmark_circle_fill" :aria-label="ct('移除附件')+' '+file.name" @click="removeFile(file.key)"/></div></template></div></div></template><template v-if="!shell" #inner-start><f7-link icon-only icon-f7="plus" class="terminal-compose-attach" :class="{disabled:!acceptFiles||uploading}" :aria-disabled="!acceptFiles||uploading" :aria-label="ct('加入附件')" @click="chooseFiles"/><input ref="filePicker" type="file" multiple hidden @change="filesChosen"/></template><template #inner-end><f7-link v-if="uploading" icon-only class="disabled composer-sending" aria-disabled="true" :aria-label="ct('附件上傳中…')"><SpinnerIcon/></f7-link><f7-link v-else icon-only icon-f7="arrow_up" class="terminal-compose-send" :class="{disabled:!canSendDraft}" :aria-disabled="!canSendDraft" :aria-label="ct('送進終端機')" @click="sendDraft"/></template></ChatComposer>
  <div v-if="touch" class="terminal-keys" role="toolbar" :aria-label="ct('終端機按鍵')"><div class="terminal-keys-box"><div ref="keyPages" class="terminal-keys-track" @scroll.passive="pageScrolled"><div v-for="(row,p) in KEY_PAGES" :key="p" class="terminal-keys-page"><button v-for="k in row" :key="k.label" type="button" class="terminal-key" :class="{arrow:k.icon}" :aria-label="k.name" :title="k.name" :data-key="k.label" @pointerdown.prevent @mousedown.prevent @click="press(k.seq)"><f7-icon v-if="k.icon" :f7="k.icon" :size="15"/><template v-else><span v-if="k.mod" class="terminal-key-mod">{{k.mod}}</span>{{k.text}}</template></button></div></div><div class="terminal-keys-dots" aria-hidden="true"><span v-for="(row,p) in KEY_PAGES" :key="p" :class="{on:p===keyPage}"/></div></div><button type="button" class="terminal-round terminal-keyboard" :aria-label="ct(typing?'收起鍵盤':'叫出鍵盤')" :title="ct(typing?'收起鍵盤':'叫出鍵盤')" @pointerdown.prevent @mousedown.prevent @click="toggleKeyboard"><f7-icon :f7="typing?'keyboard_chevron_compact_down':'keyboard'" :size="18"/></button><button type="button" class="terminal-round terminal-compose-toggle" :class="{on:composing}" :aria-pressed="composing" :aria-label="ct('用輸入框打字')" :title="ct('用輸入框打字')" @pointerdown.prevent @mousedown.prevent @click="toggleCompose"><f7-icon :f7="composing?'square_pencil_fill':'square_pencil'" :size="18"/></button></div>
</section></template>
<script setup>
import {ct} from './js/agent-i18n.js';
import {bindTerminalTouch} from './js/terminalTouch.js';
import {retryDelay,strikesAfterLoss,WEBGL_RETRY_MS} from './js/terminalRetry.js';
import {terminalTheme} from './js/terminalTheme.js';
import {terminalTheme as themeChoice} from './js/agentPreferences.js';
import {ref,computed,onMounted,onUnmounted,watch,nextTick} from 'vue';
import ChatComposer from './components/ChatComposer.vue';
import DraftPictures from './components/DraftPictures.vue';
import SpinnerIcon from './components/SpinnerIcon.vue';
import {isDraftPicture} from './js/pictureFiles.js';
import {Terminal} from '@xterm/xterm';import {FitAddon} from '@xterm/addon-fit';import '@xterm/xterm/css/xterm.css';
// shell: one of the shells opened in the terminal page's tabs, by number; none is Claude's own.
const props=defineProps({conversationId:String,acceptFiles:Boolean,shell:{type:Number,default:null},label:String,path:String,focused:Boolean,choosable:Boolean,autofocus:{type:Boolean,default:true}});
// A picture or file pasted here goes to the terminal as its path (the page
// keeps it, ConversationPage.vue), not to the chat's message box. Text
// copied from an office document also carries a picture of itself: there the text is meant,
// and xterm pastes it as before.
// choose: in a split, the switch at the pane's right asks which tab to show in it (TerminalTabs.vue).
const emit=defineEmits(['files','choose']);
function pasteFiles(e){if(!props.acceptFiles)return;const data=e.clipboardData,list=Array.from(data?.files||[]);if(!list.length)return;const types=Array.from(data.types||[]);if(types.includes('text/plain')&&(types.includes('text/html')||types.includes('text/rtf')))return;e.preventDefault();e.stopPropagation();emit('files',list);}
// Text typed at Claude's prompt as a paste (bracketed when Claude asked for it, as a desktop
// terminal pastes a dropped file's path), never with Enter. False when the line is not open.
// With the chat's box open, a path dropped or pasted goes into the box with the rest of the
// line; the box's own attachments go in when it is sent.
function paste(text){if(!text)return false;
 // The box's own attachments, sent: their paths go in after its words, then Enter.
 if(pending!==null){const words=pending;pending=null;uploading.value=false;clearTimeout(uploadTimer);if(!term||ws?.readyState!==1)return false;term.paste((words?words+' ':'')+text);ws.send(JSON.stringify({type:'input',data:'\r'}));files.value=[];return true;}
 if(composing.value){draft.value+=(draft.value&&!/\s$/.test(draft.value)?' ':'')+text;nextTick(()=>composerEditor()?.focus());return true;}
 if(!term||ws?.readyState!==1)return false;term.paste(text);return true;}
function focus(){term?.focus();}
defineExpose({paste,focus});
const KEYS=[{label:'Esc',name:'Esc',text:'esc',seq:'\x1b'},{label:'Tab',name:'Tab',text:'tab',seq:'\t'},{label:'⇧Tab',name:'Shift+Tab',mod:'⇧',text:'tab',seq:'\x1b[Z'},{label:'↑',name:'Up',icon:'chevron_up',seq:'\x1b[A'},{label:'↓',name:'Down',icon:'chevron_down',seq:'\x1b[B'},{label:'←',name:'Left',icon:'chevron_left',seq:'\x1b[D'},{label:'→',name:'Right',icon:'chevron_right',seq:'\x1b[C'},{label:'^C',name:'Ctrl+C',text:'^C',seq:'\x03'}];
// A second page of keys, swiped to.
const KEY_PAGES=[KEYS,[{label:'Home',name:'Home',text:'home',seq:'\x1b[H'},{label:'End',name:'End',text:'end',seq:'\x1b[F'},{label:'PgUp',name:'Page Up',text:'pgup',seq:'\x1b[5~'},{label:'PgDn',name:'Page Down',text:'pgdn',seq:'\x1b[6~'}]];
const keyPages=ref(null),keyPage=ref(0);
function pageScrolled(){const t=keyPages.value;if(t?.clientWidth)keyPage.value=Math.round(t.scrollLeft/t.clientWidth);}
// The chat's box over the keys: what is written there goes in as one paste and Enter.
const composing=ref(false),draft=ref(''),composer=ref(null);
const composerEditor=()=>composer.value?.$el?.querySelector('.chat-editor');
function toggleCompose(){composing.value=!composing.value;if(composing.value)nextTick(()=>composerEditor()?.focus());}
// Attachments from the box's ＋, as the chat's, in Claude's terminal only: a shell has no
// set way to take a file. The page puts them where the
// terminal can read them (ConversationPage.vue filesToTerminal) and hands back their paths.
// They wait in the box as the chat's do, thumbnails and chips, until it is sent.
const filePicker=ref(null),uploading=ref(false),files=ref([]);let uploadTimer=0,pending=null,fileCount=0;
function chooseFiles(){if(props.acceptFiles&&!uploading.value)filePicker.value?.click();}
function filesChosen(e){const list=Array.from(e.target.files||[]);e.target.value='';for(const file of list)files.value.push({key:'t'+(++fileCount),name:file.name,size:file.size,file});}
function removeFile(key){files.value=files.value.filter(f=>f.key!==key);}
const canSendDraft=computed(()=>!uploading.value&&(!!draft.value.trim()||files.value.length>0));
function sendDraft(){const text=draft.value;if(!canSendDraft.value||ws?.readyState!==1||!term)return;
 // With attachments: up first; the page hands their paths back through paste(). A send none
 // of whose files went up keeps the words in the box.
 if(files.value.length){pending=text.trim();draft.value='';uploading.value=true;clearTimeout(uploadTimer);uploadTimer=setTimeout(()=>{if(pending!==null){draft.value=pending;pending=null;}uploading.value=false;},120000);emit('files',files.value.map(f=>f.file));return;}
term.paste(text);ws.send(JSON.stringify({type:'input',data:'\r'}));draft.value='';nextTick(()=>composerEditor()?.focus());}
// Whether the keyboard is up: the page's own reading of the screen (js/conversationViewport.js
// marks it conversation-keyboard),
// not the terminal's text field having the focus, which on a phone it has with no keyboard
// shown.
const typing=ref(false);let keyboardWatch;
// Up: put away. Down: brought up, from this tap; a field that kept the focus without a
// keyboard is let go first, or a phone does not bring one up for it.
function toggleKeyboard(){const field=host.value?.querySelector('.xterm-helper-textarea');if(!field)return;if(typing.value){field.blur();return;}if(document.activeElement===field)field.blur();term?.focus();}
const touch=typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches;
function press(seq){if(ws?.readyState===1)ws.send(JSON.stringify({type:'input',data:seq}));}const host=ref(null),status=ref('正在附接終端…'),bg=ref('');let term,fit,ws,observer,cleanupTouch,disposed=false;
// The view follows every change of size at once, and Claude is told the new size
// once it settles: a divider dragged across the screen would otherwise make Claude
// redraw its whole screen for every step of the drag.
let resizeTimer;
function resize(){if(!term||!host.value?.clientWidth||!host.value?.clientHeight)return;fit.fit();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(ws?.readyState===1)ws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows}));},150);}
// A connection can die without a word: a phone puts the app away, a computer
// sleeps, a network changes, and the page kept the last screen as if still attached
// (the terminal sometimes stops updating). The
// server speaks at least every 15 s; nothing for 40 s means the line is gone, and
// the pane attaches again. Coming back to the front, it checks at once, and redraws
// a screen whose line is fine.
const QUIET_MS=40000;
let lastHeard=0,watchdog;
const silent=()=>Date.now()-lastHeard>=QUIET_MS;
// A socket that closed never came back on its own: the watchdog below only tests a
// live one, so the pane waited for the reader to leave the page and return. Retry
// while the page is visible, backing off, and start the budget over on return to the
// page or when a line that held a while drops. Data is no sign of a good line: an attach
// that prints an error (no such session) and exits sends some, and would retry every second for good.
const STEADY_MS=5000;
// A line refused before it opened (the agent stopped: the server answers 409, which a
// page cannot read from a WebSocket, so any refusal counts) keeps its spent budget on a
// return to the window: each return tries once, not eight times with an audit line
// each. A reattach tapped by the reader starts it over.
let retryTimer=0,retries=0,openedAt=0,refused=false;
function scheduleRetry(reason){
 if(disposed||retryTimer||document.hidden)return;
 const delay=retryDelay(retries);
 if(delay===null){status.value=`${reason}，可重新附接`;return;}
 retries++;
 status.value=`${reason}，正在重新連線…`;
 retryTimer=setTimeout(()=>{retryTimer=0;if(!disposed&&!document.hidden)connect();},delay);
}
function checkLine(){if(!disposed&&!document.hidden&&ws?.readyState===1&&silent())connect();}
// A phone put away lets go of its line: the screen kept streaming to a page nobody
// sees. Back in front, the pane has no line and attaches again.
function onVisible(){if(disposed)return;if(document.hidden){if(touch&&ws){const old=ws;ws=null;clearTimeout(retryTimer);retryTimer=0;old.close();}return;}if(!refused)retries=0;loadWebgl();if(!ws||ws.readyState>1||silent())connect();else term?.refresh(0,term.rows-1);}
// focus: the keyboard goes here once the line is up; not for a pane opened beside the one
// being typed in (TerminalTabs.vue).
function connect(manual=false,focus=manual){if(disposed)return;if(manual)retries=0;const old=ws;ws=null;old?.close();clearTimeout(retryTimer);retryTimer=0;openedAt=0;term?.reset();status.value='正在附接終端…';lastHeard=Date.now();const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/terminal/${props.conversationId}${props.shell?'/sh/'+props.shell:''}`);ws=socket;let failed=false;
 socket.onopen=()=>{if(ws!==socket)return;openedAt=Date.now();status.value='終端已連線';resize();if(focus)term.focus();};
 socket.onmessage=e=>{if(ws!==socket)return;lastHeard=Date.now();const msg=JSON.parse(e.data);if(msg.type==='data')term.write(msg.data);else if(msg.type==='error')status.value=msg.message;};
 socket.onclose=()=>{if(ws!==socket)return;refused=!openedAt;if(openedAt&&Date.now()-openedAt>STEADY_MS)retries=0;scheduleRetry(failed?'附接失敗，請確認登入與 Claude 狀態':'終端已離線');};socket.onerror=()=>{if(ws===socket)failed=true;};
}
// Backgrounding a phone can drop its GPU context and leave scrolling on the slow
// DOM renderer. Retry on return, at most twice, then keep the DOM fallback stable.
let webgl,webglLoading=false,webglAttempts=0,webglSince=0,webglRetry=0;
// A context that lasted a while was a good device with a bad moment, not a device
// without WebGL: give it a fresh budget. Waiting for the next visibility event left
// the pane on the slow renderer until the reader left the page, so retry here.
function scheduleWebgl(){if(disposed||webglRetry)return;webglRetry=setTimeout(()=>{webglRetry=0;if(!disposed&&!document.hidden)loadWebgl();},WEBGL_RETRY_MS);}
// Drawn on the GPU where the device allows it: Claude's screen redraws in bursts,
// which the DOM renderer draws slower, most of all on a phone. Anything wrong with
// WebGL, at the start or later, leaves the DOM renderer drawing.
async function loadWebgl(){
 if(disposed||!term||webgl||webglLoading||webglAttempts>=3)return;
 webglLoading=true;webglAttempts++;
 try{const {WebglAddon}=await import('@xterm/addon-webgl');if(disposed||!term)return;
  const addon=new WebglAddon();webgl=addon;addon.onContextLoss(()=>{if(webgl!==addon)return;webgl=null;webglAttempts=strikesAfterLoss(webglAttempts,Date.now()-webglSince);try{addon.dispose();}catch{}scheduleWebgl();});term.loadAddon(addon);webglSince=Date.now();
 }catch{const addon=webgl;webgl=null;try{addon?.dispose();}catch{}if(webglAttempts<3)scheduleWebgl();}finally{webglLoading=false;}
}
// The computer's own terminal colours and size once they are known (js/terminalTheme.js), or
// CC Agent's own, as the Admin page chooses.
const OWN={theme:{background:'#121212',foreground:'#ececec'},fontSize:13};
function applyTheme(t){if(disposed||!term||!t?.theme)return;term.options.theme={...t.theme};term.options.fontSize=t.fontSize||OWN.fontSize;bg.value=t===OWN?'':t.theme.background||'';resize();}
function followChoice(){if(themeChoice.value==='cc-agent')applyTheme(OWN);else terminalTheme().then(t=>{if(themeChoice.value!=='cc-agent')applyTheme(t||OWN);});}
watch(themeChoice,()=>followChoice());
onMounted(()=>{followChoice();term=new Terminal({cursorBlink:true,fontSize:13,fontFamily:'Menlo, monospace',scrollback:5000,theme:{background:'#121212',foreground:'#ececec'},allowProposedApi:false});fit=new FitAddon();term.loadAddon(fit);term.open(host.value);
 loadWebgl();
 cleanupTouch=bindTerminalTouch(host.value,term);const page=host.value.closest('.page');if(page&&touch){const read=()=>{typing.value=page.classList.contains('conversation-keyboard');};read();keyboardWatch=new MutationObserver(read);keyboardWatch.observe(page,{attributes:true,attributeFilter:['class']});}host.value.addEventListener('paste',pasteFiles,true);term.onData(data=>{if(ws?.readyState===1)ws.send(JSON.stringify({type:'input',data}));});
 // Shift+Enter is a new line in Claude Code: xterm sends a bare Enter for both, so it goes as
 // Esc+Enter (what Option+Enter sends), which Claude Code reads as a line break. Not while an input
 // method is composing.
 term.attachCustomKeyEventHandler(e=>{if(props.shell||e.key!=='Enter'||!e.shiftKey||e.ctrlKey||e.altKey||e.metaKey||e.isComposing)return true;if(e.type==='keydown'&&ws?.readyState===1)ws.send(JSON.stringify({type:'input',data:'\x1b\r'}));return false;});observer=new ResizeObserver(resize);observer.observe(host.value);connect(true,props.autofocus);
 watchdog=setInterval(checkLine,5000);document.addEventListener('visibilitychange',onVisible);window.addEventListener('focus',onVisible);});
onUnmounted(()=>{disposed=true;keyboardWatch?.disconnect();host.value?.removeEventListener('paste',pasteFiles,true);clearTimeout(resizeTimer);clearTimeout(retryTimer);clearTimeout(webglRetry);clearInterval(watchdog);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible);cleanupTouch?.();observer?.disconnect();ws?.close();try{webgl?.dispose();}catch{}webgl=null;term?.dispose();});
</script>

<style scoped>
.terminal-pane {display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;}
.terminal-pane > .block,.terminal-pane > .block-footer {flex-shrink:0;margin-top:8px;margin-bottom:8px;}
/* The bar belongs to the terminal, which is dark in both themes: in the light one
   it sat as a pale strip on top of it. */
.terminal-bar {flex-shrink:0;display:flex;align-items:center;gap:6px;padding:6px 16px;font-size:13px;background:var(--terminal-bg,#121212);color:rgba(255,255,255,.6);}
.terminal-status {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px;}
.terminal-status::before {content:'';flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:#8e8e93;}
.terminal-status.on::before {background:#34c759;}
/* Under the terminal: above the keyboard while it is up; while not, down in the home
   indicator's band, which the page leaves to this row (chatPage.css), as a phone's own
   bars sit, with no room left under it. */
.terminal-keys {flex-shrink:0;display:flex;align-items:center;gap:8px;padding:8px 12px max(8px, calc(var(--f7-safe-area-bottom,env(safe-area-inset-bottom,0px)) - 8px));background:var(--terminal-bg,#121212);}
.terminal-keys-box {flex:1;min-width:0;position:relative;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;}
.terminal-keys-track {display:flex;height:44px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain;}
.terminal-keys-page {flex:0 0 100%;display:flex;align-items:center;padding:0 4px;box-sizing:border-box;scroll-snap-align:start;}
.terminal-keys-dots {position:absolute;left:0;right:0;bottom:2px;display:flex;justify-content:center;gap:4px;pointer-events:none;}
.terminal-keys-dots span {width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.16);}
.terminal-keys-dots span.on {background:rgba(255,255,255,.5);}
.terminal-compose-toggle.on {background:rgba(255,255,255,.2);}
.terminal-compose .attachment-drafts {display:flex;flex-direction:column;gap:8px;padding:8px 12px;}
.terminal-compose .attachment-draft-files {display:flex;gap:8px;overflow-x:auto;}
.terminal-compose .attachment-chip {display:flex;align-items:center;gap:8px;flex:0 0 auto;max-width:260px;border-radius:16px;padding:8px 10px;background:rgba(255,255,255,.08);color:#ececec;}
.terminal-compose .attachment-chip span {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.terminal-compose .attachment-chip small {display:block;color:rgba(255,255,255,.55);}
/* The chat's box, in the terminal's column rather than at the foot of a page. */
.terminal-compose {position:relative !important;left:auto !important;right:auto !important;bottom:auto !important;flex-shrink:0;}
.terminal-keys-track::-webkit-scrollbar {display:none;}
.terminal-key {flex:1 0 auto;width:auto;margin:0;display:inline-flex;align-items:center;justify-content:center;line-height:1;text-transform:none;min-width:26px;height:32px;padding:0 4px;border:0;border-radius:999px;background:transparent;color:rgba(255,255,255,.85);font:13px Menlo,monospace;touch-action:manipulation;-webkit-user-select:none;user-select:none;}
/* The keys centred in the capsule, the page dots in the gap under them. ⇧ in the system
   face: Menlo's is a thin outline set low. */
.terminal-key-mod {font:600 14px/1 -apple-system,system-ui,sans-serif;margin-right:1px;position:relative;top:-1px;}
.terminal-key:active {background:rgba(255,255,255,.18);}
.terminal-round {flex:0 0 auto;width:44px;height:44px;margin:0;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:rgba(255,255,255,.85);touch-action:manipulation;}
.terminal-round:active {background:rgba(255,255,255,.18);}
.terminal-label {flex:0 0 auto;font-weight:600;color:rgba(255,255,255,.85);}
.terminal-path {min-width:0;overflow:hidden;text-overflow:ellipsis;font-family:Menlo,monospace;font-size:12px;}
.terminal-bar.focused .terminal-label {color:#fff;}
/* At the pane's right, a switch for the tab it shows. */
.terminal-choose {flex:0 0 auto;margin-left:auto;width:auto;min-width:0;height:auto;padding:0 2px;color:inherit;}
.terminal-choose :deep(.icon) {font-size:15px;}
.terminal-reattach {flex:0 0 auto;width:auto;min-width:0;height:auto;padding:0;color:inherit;}
.terminal-reattach :deep(.icon) {font-size:14px;}
/* The rows fill the height in whole lines; what is left under the last one takes
   the terminal's own background, not the page's (a darker strip under the terminal). xterm's own viewport spans that space too,
   black by its stylesheet, and the GPU renderer never paints it the theme's colour,
   so it is set here as well (the strip was still there). */
.terminal-host {flex:1;min-height:0;overflow:hidden;touch-action:pan-x pinch-zoom;overscroll-behavior:contain;background:var(--terminal-bg,#121212);}
.terminal-host :deep(.xterm) {height:100%;}
.terminal-host :deep(.xterm-viewport) {background-color:var(--terminal-bg,#121212);}
</style>
