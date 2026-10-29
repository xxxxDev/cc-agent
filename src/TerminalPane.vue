<template><section class="terminal-pane">
 <!-- One slim line: the state, and right after it a small icon to attach again at any
      time, such as when the screen looks stuck. A full-width button took a band of
      the screen, and the note under the terminal is gone too. -->
 <div class="terminal-bar"><span class="terminal-status" :class="{on:status==='終端已連線'}" role="status">{{ct(status)}}</span><f7-link class="terminal-reattach" icon-only icon-f7="arrow_clockwise" :aria-label="ct('重新附接')" :title="ct('重新附接')" @click="connect(true)"/></div>
 <!-- Keys a phone keyboard does not have, for Claude Code's menus: Esc to back out,
       arrows to choose, Shift+Tab for the mode (a
       slash command opened the terminal and nothing could close its menu). They
       send without taking the focus, so the keyboard stays where it was. -->
  <div v-if="touch" class="terminal-keys" role="toolbar" :aria-label="ct('終端機按鍵')"><button v-for="k in KEYS" :key="k.label" type="button" class="terminal-key" :aria-label="k.name" @pointerdown.prevent @mousedown.prevent @click="press(k.seq)">{{k.label}}</button></div>
 <div ref="host" class="terminal-host"/></section></template>
<script setup>
import {ct} from './js/agent-i18n.js';
import {bindTerminalTouch} from './js/terminalTouch.js';
import {retryDelay,strikesAfterLoss,WEBGL_RETRY_MS} from './js/terminalRetry.js';
import {ref,onMounted,onUnmounted} from 'vue';
import {Terminal} from '@xterm/xterm';import {FitAddon} from '@xterm/addon-fit';import '@xterm/xterm/css/xterm.css';
const props=defineProps({conversationId:String});
const KEYS=[{label:'Esc',name:'Esc',seq:'\x1b'},{label:'Tab',name:'Tab',seq:'\t'},{label:'⇧Tab',name:'Shift+Tab',seq:'\x1b[Z'},{label:'↑',name:'Up',seq:'\x1b[A'},{label:'↓',name:'Down',seq:'\x1b[B'},{label:'←',name:'Left',seq:'\x1b[D'},{label:'→',name:'Right',seq:'\x1b[C'},{label:'^C',name:'Ctrl+C',seq:'\x03'}];
const touch=typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches;
function press(seq){if(ws?.readyState===1)ws.send(JSON.stringify({type:'input',data:seq}));}const host=ref(null),status=ref('正在附接終端…');let term,fit,ws,observer,cleanupTouch,disposed=false;
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
let retryTimer=0,retries=0,openedAt=0;
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
function onVisible(){if(disposed)return;if(document.hidden){if(touch&&ws){const old=ws;ws=null;clearTimeout(retryTimer);retryTimer=0;old.close();}return;}retries=0;loadWebgl();if(!ws||ws.readyState>1||silent())connect();else term?.refresh(0,term.rows-1);}
function connect(manual=false){if(disposed)return;if(manual)retries=0;const old=ws;ws=null;old?.close();clearTimeout(retryTimer);retryTimer=0;openedAt=0;term?.reset();status.value='正在附接終端…';lastHeard=Date.now();const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/terminal/${props.conversationId}`);ws=socket;let failed=false;
 socket.onopen=()=>{if(ws!==socket)return;openedAt=Date.now();status.value='終端已連線';resize();if(manual)term.focus();};
 socket.onmessage=e=>{if(ws!==socket)return;lastHeard=Date.now();const msg=JSON.parse(e.data);if(msg.type==='data')term.write(msg.data);else if(msg.type==='error')status.value=msg.message;};
 socket.onclose=()=>{if(ws!==socket)return;if(openedAt&&Date.now()-openedAt>STEADY_MS)retries=0;scheduleRetry(failed?'附接失敗，請確認登入與 Claude 狀態':'終端已離線');};socket.onerror=()=>{if(ws===socket)failed=true;};
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
onMounted(()=>{term=new Terminal({cursorBlink:true,fontSize:13,fontFamily:'Menlo, monospace',scrollback:5000,theme:{background:'#121212',foreground:'#ececec'},allowProposedApi:false});fit=new FitAddon();term.loadAddon(fit);term.open(host.value);
 loadWebgl();
 cleanupTouch=bindTerminalTouch(host.value,term);term.onData(data=>{if(ws?.readyState===1)ws.send(JSON.stringify({type:'input',data}));});observer=new ResizeObserver(resize);observer.observe(host.value);connect(true);
 watchdog=setInterval(checkLine,5000);document.addEventListener('visibilitychange',onVisible);window.addEventListener('focus',onVisible);});
onUnmounted(()=>{disposed=true;clearTimeout(resizeTimer);clearTimeout(retryTimer);clearTimeout(webglRetry);clearInterval(watchdog);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible);cleanupTouch?.();observer?.disconnect();ws?.close();try{webgl?.dispose();}catch{}webgl=null;term?.dispose();});
</script>

<style scoped>
.terminal-pane {display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;}
.terminal-pane > .block,.terminal-pane > .block-footer {flex-shrink:0;margin-top:8px;margin-bottom:8px;}
/* The bar belongs to the terminal, which is dark in both themes: in the light one
   it sat as a pale strip on top of it. */
.terminal-bar {flex-shrink:0;display:flex;align-items:center;gap:6px;padding:6px 16px;font-size:13px;background:#121212;color:rgba(255,255,255,.6);}
.terminal-status {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px;}
.terminal-status::before {content:'';flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:#8e8e93;}
.terminal-status.on::before {background:#34c759;}
.terminal-keys {flex-shrink:0;display:flex;gap:6px;padding:0 12px 6px;overflow-x:auto;scrollbar-width:none;background:#121212;}
.terminal-keys::-webkit-scrollbar {display:none;}
.terminal-key {flex:0 0 auto;width:auto;margin:0;display:inline-flex;align-items:center;justify-content:center;line-height:1;text-transform:none;min-width:34px;height:30px;padding:0 7px;border:1px solid rgba(255,255,255,.18);border-radius:7px;background:rgba(255,255,255,.08);color:#ececec;font:13px Menlo,monospace;touch-action:manipulation;-webkit-user-select:none;user-select:none;}
.terminal-key:active {background:rgba(255,255,255,.25);}
.terminal-reattach {flex:0 0 auto;width:auto;min-width:0;height:auto;padding:0;color:inherit;}
.terminal-reattach :deep(.icon) {font-size:14px;}
/* The rows fill the height in whole lines; what is left under the last one takes
   the terminal's own background, not the page's (a darker strip under the terminal). xterm's own viewport spans that space too,
   black by its stylesheet, and the GPU renderer never paints it the theme's colour,
   so it is set here as well (the strip was still there). */
.terminal-host {flex:1;min-height:0;overflow:hidden;touch-action:pan-x pinch-zoom;overscroll-behavior:contain;background:#121212;}
.terminal-host :deep(.xterm) {height:100%;}
.terminal-host :deep(.xterm-viewport) {background-color:#121212;}
</style>
