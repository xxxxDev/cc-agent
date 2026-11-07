<template>
 <!-- The line over a message naming what it answers: a hook, who wrote it, its first
      words on one line, and a chip for the others it answers. It sits right over the text bubble, its hook on the bubble's own edge: the
      left one on the left, the right one for the reader's own messages on the right. -->
 <div class="reply-quote" :class="{sent}" @click.stop>
  <div v-for="(q,i) in shown" :key="q.id" class="reply-quote-row" role="button" tabindex="0" :data-quote-id="q.id" :title="q.text" @click="$emit('jump',q.id,$event)" @keydown.enter="$emit('jump',q.id,$event)"><span v-if="q.who" class="reply-quote-who">{{q.who}}</span><span class="reply-quote-text">{{q.text}}</span><button v-if="i===0&&!expanded&&items.length>1" type="button" class="reply-quote-more" :aria-label="ct('顯示所有回覆的訊息')" @click.stop="$emit('expand')">{{ct('＋{n} 則').replace('{n}',items.length-1)}}</button></div>
 </div>
</template>
<script setup>
import {computed} from 'vue';
import {ct} from '../js/agent-i18n.js';
const props=defineProps({items:{type:Array,default:()=>[]},expanded:Boolean,sent:Boolean});
defineEmits(['jump','expand']);
const shown=computed(()=>props.items.slice(0,props.expanded?undefined:1));
</script>
<style scoped>
.reply-quote{display:flex;flex-direction:column;align-self:stretch;gap:2px;min-width:0;margin:0 0 4px;font-size:12.5px;line-height:18px;color:var(--cc-color-text-secondary);text-align:left}
.reply-quote-row{display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.reply-quote-row::before{content:'';flex:none;align-self:flex-end;width:18px;height:9px;margin-bottom:-1px;border:2px solid var(--cc-color-text-tertiary);border-right:0;border-bottom:0;border-top-left-radius:8px}
/* The reader's own message, on the right: the same line in a mirror, the hook on the
   bubble's right edge. */
.reply-quote.sent .reply-quote-row{justify-content:flex-end}
.reply-quote.sent .reply-quote-row::before{order:1;border-left:0;border-right:2px solid var(--cc-color-text-tertiary);border-top-left-radius:0;border-top-right-radius:8px}
.reply-quote-row:hover .reply-quote-text,.reply-quote-row:focus-visible .reply-quote-text{color:var(--f7-message-received-text-color)}
.reply-quote-who{flex:none;font-weight:600;color:#0a84ff}
.reply-quote-text{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.reply-quote-more{flex:none;width:auto;margin:0;padding:0 7px;border:0;border-radius:8px;background:rgba(127,127,127,.2);color:inherit;font:inherit;font-size:11px;line-height:18px;cursor:pointer}
</style>
<style>
/* Unscoped: a scoped :global(html.dark) .x compiles to html.dark alone. */
html.dark .reply-quote .reply-quote-who{color:#58a6ff}
</style>
