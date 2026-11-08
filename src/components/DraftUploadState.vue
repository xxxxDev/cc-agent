<template>
 <!-- Where a file waiting in the box stands while its message is sent: waiting its turn, going
      up with its percent, up (a check), or failed. The browser counts only what it has handed
      to the network; on a phone that is often all of it at once, so from 99% the chip says
      處理中 until the server answers. -->
 <span v-if="item.state" class="draft-state" :class="'draft-state-'+item.state" :title="label" :aria-label="label">
  <template v-if="item.state==='uploading'"><f7-preloader :size="14"/><span class="draft-state-percent" aria-hidden="true">{{(item.percent||0)>=99?ct('處理中'):(item.percent||0)+'%'}}</span></template>
  <i v-else class="icon f7-icons" aria-hidden="true">{{icons[item.state]}}</i>
 </span>
</template>
<script setup>
import {computed} from 'vue';
import {ct} from '../js/agent-i18n.js';
const props=defineProps({item:{type:Object,required:true}});
const icons={waiting:'clock',done:'checkmark_alt_circle_fill',failed:'exclamationmark_circle_fill'};
const label=computed(()=>({waiting:ct('等待上傳'),uploading:ct('上傳中')+' '+(props.item.percent||0)+'%',done:ct('已上傳'),failed:ct('上傳失敗')})[props.item.state]||'');
</script>
<style>
/* Unscoped: the chips' own rules (chatPage.css, SplitCell.vue) reach every span inside. */
.draft-state {flex:none;display:inline-flex;align-items:center;gap:4px;min-width:auto !important;overflow:visible !important;color:var(--cc-color-text-secondary);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;}
.draft-state .icon {font-size:18px;}
.draft-state .preloader {--f7-preloader-color:currentColor;}
.draft-state-done {color:#34c759;}
.draft-state-failed {color:#ff3b30;}
.dark .draft-state-done {color:#30d158;}
.dark .draft-state-failed {color:#ff453a;}
.draft-failed {box-shadow:inset 0 0 0 1.5px #ff3b30;}
.dark .draft-failed {box-shadow:inset 0 0 0 1.5px #ff453a;}
</style>
