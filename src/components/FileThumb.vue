<template>
 <!-- One row's picture on the file list: the server's still, then (a picture) the file itself, then
      the kind's icon. Its own component, so a still that fails changes this row alone: with a
      thousand files, one shared list of failures drew every row again for each, and the
      iPhone page froze. -->
 <span class="fp-icon" :class="{thumb:!!src}" aria-hidden="true"><img v-if="src" :src="src" alt="" loading="lazy" decoding="async" @error="tries++"/><f7-icon v-else :f7="icon" :size="22"/></span>
</template>
<script setup>
import {ref,computed} from 'vue';
import {PICTURE} from '../js/pictureFiles.js';
const props=defineProps({file:Object,url:String});
const tries=ref(0);
const name=computed(()=>props.file?.name||'');
const picture=computed(()=>PICTURE.test(name.value)&&!/\.svg$/i.test(name.value));
const src=computed(()=>{
 if(props.file?.removed)return '';
 if(!picture.value&&!/\.(mp4|m4v|mov|webm|heic|heif)$/i.test(name.value))return '';
 return tries.value===0?props.url+'/thumb':tries.value===1&&picture.value?props.url:'';
});
const icon=computed(()=>{const n=name.value;
 return PICTURE.test(n)?'photo':/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(n)?'music_note':/\.(mp4|m4v|mov|webm|ogv)$/i.test(n)?'film':/\.(zip|gz|tgz|bz2|xz|7z|rar|tar)$/i.test(n)?'archivebox':/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|html?)$/i.test(n)?'doc_text':'doc';});
</script>
<style scoped>
.fp-icon{flex:0 0 44px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--cc-color-text-secondary,inherit)}
.fp-icon.thumb{border-radius:8px;overflow:hidden;background:var(--cc-glass-fill-subtle,rgba(127,127,127,.15))}
.fp-icon.thumb img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
:global(.fp-row.removed) .fp-icon{opacity:.45}
</style>
