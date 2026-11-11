<template>
  <Transition name="file-drop">
    <!-- The terminal beside the chat: two places to let go,
         each over its own part; the one under the pointer is framed, the other only named. -->
    <div v-if="show&&split" class="file-drop file-drop-split" aria-hidden="true" :data-target="to">
      <div class="file-drop-zone file-drop-chat" :class="{on:to==='chat'}" :style="{right:split.width+'px'}">
        <div v-if="to==='chat'" class="file-drop-frame"></div>
        <div class="file-drop-box">
          <div v-if="to==='chat'" class="file-drop-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg></div>
          <div class="file-drop-title">{{ ct('放到聊天室') }}</div>
          <div v-if="to==='chat'&&name" class="file-drop-sub">{{ ct('附加到給 {name} 的訊息，送出前可以再刪').replace('{name}', name) }}</div>
          <div v-if="to==='chat'&&count" class="file-drop-count">{{ ct('{count} 個檔案').replace('{count}', count) }}</div>
        </div>
      </div>
      <div class="file-drop-zone file-drop-terminal" :class="{on:to==='terminal',off:!terminalOk}" :style="{width:split.width+'px',top:split.top+'px'}">
        <div v-if="to==='terminal'" class="file-drop-frame"></div>
        <div class="file-drop-box">
          <div v-if="to==='terminal'" class="file-drop-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg></div>
          <div class="file-drop-title">{{ ct('放到終端機') }}</div>
          <div v-if="!terminalOk" class="file-drop-sub">{{ ct('這個 Agent 讀不到存放檔案的資料夾，檔案會放到聊天室') }}</div>
          <div v-else-if="to==='terminal'" class="file-drop-sub">{{ ct('存到 Agent 讀得到的地方，把路徑打進終端機，不會按 Enter') }}</div>
          <div v-if="to==='terminal'&&count" class="file-drop-count">{{ ct('{count} 個檔案').replace('{count}', count) }}</div>
        </div>
      </div>
    </div>
    <div v-else-if="show" class="file-drop" aria-hidden="true">
      <div class="file-drop-frame"></div>
      <div class="file-drop-box">
        <div class="file-drop-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg></div>
        <div class="file-drop-title">{{ ct('放開即可附加') }}</div>
        <div v-if="name" class="file-drop-sub">{{ ct('附加到給 {name} 的訊息，送出前可以再刪').replace('{name}', name) }}</div>
        <div v-if="count" class="file-drop-count">{{ ct('{count} 個檔案').replace('{count}', count) }}</div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
// The picture over a chat while files are dragged onto it (js/fileDrag.js says when).
import {ct} from '../js/agent-i18n.js';
import {computed} from 'vue';
// split: the terminal's column ({width, top} in px, at the page's right) when it is beside the
// chat; over: the part under the pointer; terminalOk: whether the terminal takes files.
const props = defineProps({show: Boolean, name: String, count: Number, split: Object, over: String, terminalOk: Boolean});
const to = computed(() => props.over === 'terminal' && props.terminalOk ? 'terminal' : 'chat');
</script>

<style scoped>
.file-drop {--file-drop-accent:#2f6fff;position:absolute;inset:0;z-index:700;display:flex;align-items:center;justify-content:center;pointer-events:none;
  background:color-mix(in srgb, var(--f7-page-bg-color, #111) 62%, transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:var(--f7-text-color, #fff);}
.file-drop-frame {position:absolute;inset:14px;border:2px dashed var(--file-drop-accent);border-radius:20px;background:rgba(47,111,255,.06);}
.file-drop-box {position:relative;display:flex;flex-direction:column;align-items:center;gap:10px;padding:0 24px;text-align:center;}
.file-drop-icon {width:76px;height:76px;border-radius:50%;background:var(--file-drop-accent);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(47,111,255,.35);}
.file-drop-title {font-size:22px;font-weight:600;margin-top:6px;}
.file-drop-sub {font-size:14px;opacity:.7;}
.file-drop-count {margin-top:4px;padding:6px 14px;border-radius:999px;background:color-mix(in srgb, var(--f7-text-color, #fff) 10%, transparent);font-size:13px;}
.file-drop-enter-active, .file-drop-leave-active {transition:opacity .15s ease;}
.file-drop-enter-active .file-drop-box {transition:transform .2s ease;}
.file-drop-enter-from, .file-drop-leave-to {opacity:0;}
.file-drop-enter-from .file-drop-box {transform:scale(.94);}
/* Split: no blur over the whole page, each part its own veil. */
.file-drop-split {background:none;backdrop-filter:none;-webkit-backdrop-filter:none;}
.file-drop-zone {position:absolute;top:0;bottom:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, var(--f7-page-bg-color, #111) 72%, transparent);transition:background .12s ease;}
.file-drop-zone.on {background:color-mix(in srgb, var(--f7-page-bg-color, #111) 58%, transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
.file-drop-chat {left:0;}
.file-drop-terminal {right:0;color:#fff;background:rgba(18,18,18,.78);}
.file-drop-terminal.on {background:rgba(18,18,18,.62);}
.file-drop-zone:not(.on) .file-drop-box {opacity:.6;}
.file-drop-zone:not(.on) .file-drop-title {font-size:17px;}
.file-drop-terminal.off .file-drop-title {text-decoration:line-through;}
.file-drop-zone .file-drop-sub {max-width:340px;}
@media (prefers-reduced-motion: reduce) {.file-drop-enter-active, .file-drop-leave-active, .file-drop-enter-active .file-drop-box {transition:none;}}
</style>
