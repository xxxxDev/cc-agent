<template>
 <!-- Pictures waiting in the box show as small square thumbnails, an ✕ on each to take it off,
      the row scrolling sideways when it runs over.
      While the message goes, each draws where its upload stands, as the chips do. -->
 <div v-if="pictures.length" class="draft-pictures">
  <div v-for="file in pictures" :key="file.key" class="draft-picture" :class="{'draft-failed':file.state==='failed'}">
   <!-- Opening the preview leaves the editor and the keyboard as they are. -->
   <button type="button" class="draft-picture-open" :title="file.name" :aria-label="ct('預覽')+' '+file.name" @mousedown.prevent @click="open(file)">
    <img v-if="urls[file.key]" :src="urls[file.key]" :alt="file.name" draggable="false" @error="broken(file)"/>
   </button>
   <span v-if="file.state" class="draft-picture-state" :class="'draft-picture-'+(file.state==='uploading'&&(file.percent||0)>=99?'processing':file.state)" role="status" :aria-label="label(file)">
    <template v-if="file.state==='uploading'"><f7-preloader :size="22"/><span class="draft-picture-percent" aria-hidden="true">{{(file.percent||0)>=99?ct('處理中'):(file.percent||0)+'%'}}</span></template>
    <span v-else-if="file.state==='done'" class="draft-picture-check" aria-hidden="true"><i class="icon f7-icons">checkmark_alt</i></span>
    <i v-else class="icon f7-icons" aria-hidden="true">{{file.state==='failed'?'exclamationmark_circle_fill':'clock'}}</i>
   </span>
   <button v-if="removable" type="button" class="draft-picture-remove" :disabled="disabled" :aria-label="ct('移除附件')+' '+file.name" @mousedown.prevent @click="$emit('remove',file.key)"><i class="icon f7-icons">xmark</i></button>
  </div>
 </div>
</template>
<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue';
import {ct} from '../js/agent-i18n.js';
import {isDraftPicture} from '../js/pictureFiles.js';
// files: the box's drafts (attachmentDrafts.js); only the pictures show here, the rest stay chips.
// removable: the ✕ shows (not while a message is being sent); disabled: it does nothing.
const props=defineProps({files:{type:Array,default:()=>[]},removable:{type:Boolean,default:true},disabled:{type:Boolean,default:false}});
const emit=defineEmits(['open','remove']);
const pictures=computed(()=>props.files.filter(isDraftPicture));
// Each thumbnail is drawn from the file on the device, through an object URL let go once the
// picture leaves the box (taken off, sent, a thumbnail that could not be drawn) or the box goes.
// An SVG is drawn from a blob typed image/svg+xml in an <img>, so nothing in it runs.
const urls=ref({});
function sync(){
 const live=new Set(pictures.value.map(f=>f.key)),next={...urls.value};let changed=false;
 for(const key of Object.keys(next))if(!live.has(key)){URL.revokeObjectURL(next[key]);delete next[key];changed=true;}
 for(const f of pictures.value)if(!next[f.key]){next[f.key]=URL.createObjectURL(/\.svg$/i.test(f.name)?new Blob([f.file],{type:'image/svg+xml'}):f.file);changed=true;}
 if(changed)urls.value=next;
}
watch(()=>pictures.value.map(f=>f.key).join('\n'),sync,{immediate:true});
onBeforeUnmount(()=>{for(const u of Object.values(urls.value))URL.revokeObjectURL(u);urls.value={};});
// One the browser cannot draw (a HEIC outside Safari) goes back to its chip.
function broken(file){file.thumbFailed=true;}
// Opened in the chat's preview, stepping through this box's pictures, as a sent message's do.
const shown=f=>({id:f.key,name:f.name,size:f.size,local:f.file});
function open(file){emit('open',{...shown(file),group:pictures.value.map(shown)});}
const label=f=>f.state==='uploading'?((f.percent||0)>=99?ct('處理中'):ct('上傳中')+' '+(f.percent||0)+'%'):({waiting:ct('等待上傳'),done:ct('已上傳'),failed:ct('上傳失敗')})[f.state]||'';
</script>
<style>
/* Unscoped, as the chips' rows are (chatPage.css, SplitCell.vue). */
.draft-pictures {display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;flex:none;max-width:100%;padding:2px 0;scrollbar-width:none;}
.draft-pictures::-webkit-scrollbar {display:none;}
.draft-picture {position:relative;flex:0 0 68px;width:68px;height:68px;border-radius:14px;overflow:hidden;background:var(--cc-glass-fill-subtle);}
.draft-picture-open {display:block;width:100%;height:100%;margin:0;padding:0;border:0;background:none;cursor:pointer;}
.draft-picture-open img {display:block;width:100%;height:100%;object-fit:cover;}
.draft-picture.draft-failed {box-shadow:none;}
.draft-picture.draft-failed::after {content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 2px #ff3b30;pointer-events:none;}
.dark .draft-picture.draft-failed::after {box-shadow:inset 0 0 0 2px #ff453a;}
/* Where its upload stands, over the picture: a check once up, a spinner and percent (處理中
   from 99%) while it goes, a clock while it waits, a red mark when it failed. */
.draft-picture-state {position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;pointer-events:none;color:#fff;font-size:12px;line-height:14px;font-weight:500;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px rgba(0,0,0,.5);}
.draft-picture-waiting,.draft-picture-uploading,.draft-picture-processing {background:rgba(0,0,0,.32);}
.draft-picture-state .preloader {--f7-preloader-color:#fff;}
.draft-picture-waiting .icon {font-size:24px;}
.draft-picture-check {display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#34c759;box-shadow:0 1px 3px rgba(0,0,0,.3);}
.dark .draft-picture-check {background:#30d158;}
.draft-picture-check .icon {font-size:15px;font-weight:700;color:#fff;}
.draft-picture-failed {background:rgba(0,0,0,.32);}
.draft-picture-failed .icon {font-size:26px;color:#ff3b30;text-shadow:none;}
.dark .draft-picture-failed .icon {color:#ff453a;}
/* A small ✕ in the corner; its target reaches past the circle. Framework7 gives an icon-only
   button in the messagebar the text box's height as its least size, hence !important. */
.draft-picture > .draft-picture-remove {position:absolute;top:4px;right:4px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:20px;height:20px;min-width:0 !important;min-height:0 !important;margin:0;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
.draft-picture-remove::before {content:'';position:absolute;inset:-6px;}
.draft-picture-remove .icon {font-size:11px;font-weight:700;}
.draft-picture-remove:disabled {opacity:.5;cursor:default;}
@media (hover:hover) and (pointer:fine) {.draft-picture-remove:not(:disabled):hover {background:rgba(0,0,0,.75);}}
</style>
