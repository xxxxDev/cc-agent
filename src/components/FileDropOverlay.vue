<template>
  <Transition name="file-drop">
    <div v-if="show" class="file-drop" aria-hidden="true">
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
defineProps({show: Boolean, name: String, count: Number});
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
@media (prefers-reduced-motion: reduce) {.file-drop-enter-active, .file-drop-leave-active, .file-drop-enter-active .file-drop-box {transition:none;}}
</style>
