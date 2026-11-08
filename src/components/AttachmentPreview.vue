<template>
 <!-- Not an image, nothing to preview: a small centred dialog with the name and a
      download, not a whole-screen popup. A dialog
      sizes and centres itself on a phone and a desktop alike, which a sheet did not. -->
 <!-- An image opens in a viewer sized to the picture itself: a wide screenshot
      spans the screen instead of sitting small in a square box with empty space
      above and below it, and a click shows it at full size to read. -->
 <Teleport to="body">
  <div v-if="file&&(isImage||isText||isMedia)" class="image-viewer" role="dialog" aria-modal="true" :aria-label="file.name" @click.self="closeOutside">
   <div class="image-panel" :class="{'audio-panel':isAudio,'video-panel':isVideo,'text-panel':isText,'html-panel':asPage,'text-sized':isText&&!!textSize}" :style="isText&&textSize?{'--tw':textSize.width+'px','--th':textSize.height+'px'}:null">
    <!-- A text panel is resized like a window: any edge or corner, the size kept for
         the next file. A double click goes back
         to the default. -->
    <template v-if="isText"><span v-for="edge in EDGES" :key="edge" class="text-resize" :class="'edge-'+edge" :data-edge="edge" aria-hidden="true" @pointerdown.prevent.stop="startResize($event,edge)" @dblclick.stop="resetSize"></span></template>
    <header class="image-bar">
     <span class="image-name" :title="file.name">{{file.name}}</span>
     <small class="image-size">{{file.size<1024?file.size+' B':(file.size/1024).toFixed(1)+' KB'}}</small>
     <small v-if="siblings.length>1" class="image-count">{{place+1}} / {{siblings.length}}</small>
     <template v-if="isImage&&!isText"><a class="image-action image-zoom-out" href="#" :class="{disabled:pinch.scale<=1}" :aria-label="ct('縮小')" :title="ct('縮小')" @click.prevent="zoomStep(-1)"><i class="icon f7-icons">minus_magnifyingglass</i></a><a class="image-action image-zoom-in" href="#" :class="{disabled:pinch.scale>=MAX_ZOOM}" :aria-label="ct('放大')" :title="ct('放大')" @click.prevent="zoomStep(1)"><i class="icon f7-icons">plus_magnifyingglass</i></a></template>
     <!-- An .html file opens as the page it is; the source is one click away. A file not sent yet has no address to frame. -->
     <a v-if="isHtml" class="image-action html-toggle" href="#" :aria-label="asPage?ct('看原始碼'):ct('看網頁')" :title="asPage?ct('看原始碼'):ct('看網頁')" @click.prevent="htmlSource=!htmlSource"><i class="icon f7-icons">{{asPage?'chevron_left_slash_chevron_right':'globe'}}</i></a>
     <a v-if="!file.local" class="image-action external" :href="url" :download="file.name" target="_blank" rel="noopener" :aria-label="ct('下載檔案')" :title="ct('下載檔案')" @click="onSave"><i class="icon f7-icons">arrow_down_circle</i></a>
     <a class="image-action image-close" href="#" :aria-label="ct('關閉')" :title="ct('關閉')" @click.prevent="close"><i class="icon f7-icons">xmark</i></a>
    </header>
    <!-- A text file shows what it says, a markdown file set as the bubbles set it. -->
    <div v-if="isText" class="text-stage">
     <f7-preloader v-if="loading"/>
     <p v-else-if="error" role="alert">{{error}}</p>
     <!-- The page runs in a frame with no origin of its own: the server's sandbox
          header and this attribute both keep it from this site's login and data. -->
     <iframe v-else-if="asPage" :key="url" class="html-frame" :src="url+'/page'" sandbox="allow-scripts" referrerpolicy="no-referrer" :title="file.name"></iframe>
     <template v-else>
      <div v-if="isMarkdown" class="text-md" v-html="renderMarkdown(text)" @click="onTextClick"></div>
      <pre v-else-if="isDiff" class="text-plain text-diff"><span v-for="(d,i) in diffLines" :key="i" :class="d.kind&&'diff-'+d.kind">{{d.line}}</span></pre>
      <pre v-else class="text-plain">{{text}}</pre>
      <p v-if="cut" class="text-cut">{{ct('只顯示開頭一部分，完整內容請下載檔案')}}</p>
     </template>
    </div>
    <template v-if="siblings.length>1"><button type="button" class="image-step prev" :disabled="place<=0" :aria-label="ct('上一個檔案')" @click.stop="step(-1)"><i class="icon f7-icons">chevron_left</i></button><button type="button" class="image-step next" :disabled="place>=siblings.length-1" :aria-label="ct('下一個檔案')" @click.stop="step(1)"><i class="icon f7-icons">chevron_right</i></button></template>
    <div v-if="isVideo" class="video-stage">
     <f7-preloader v-if="loading"/>
     <video v-else-if="imageUrl&&!error" :key="imageUrl" :src="imageUrl" controls autoplay playsinline preload="auto" @error="error=ct('無法播放此影片')"></video>
     <p v-else-if="error" role="alert">{{error}}</p>
    </div>
    <div v-else-if="isAudio" class="audio-stage">
     <f7-preloader v-if="loading"/>
     <audio v-else-if="imageUrl&&!error" :key="imageUrl" :src="imageUrl" controls autoplay preload="auto" @error="error=ct('無法播放此音訊')"></audio>
     <p v-else-if="error" role="alert">{{error}}</p>
    </div>
    <div v-else-if="!isText" ref="stage" class="image-stage" :class="{actual,pinched:pinch.scale>1}" @touchstart="touchStart" @touchmove="touchMove" @touchend="touchEnd" @touchcancel="touchEnd" @wheel="wheelZoom" @pointerdown="mouseDown">
     <f7-preloader v-if="loading"/>
     <img v-else-if="imageUrl&&!error" :src="imageUrl" :alt="file.name" :class="{zoomable}"
      :title="actual||pinch.scale>1?ct('縮回畫面大小'):ct('點一下放大')" :style="[size?{'--w':size.width+'px','--h':size.height+'px'}:null,pinch.scale!==1||pinch.x||pinch.y?{transform:`translate(${pinch.x}px,${pinch.y}px) scale(${pinch.scale})`}:null]" @load="measure" @click="imageClick" @error="error=ct('無法預覽此圖片')"/>
     <p v-else-if="error" role="alert">{{error}}</p>
    </div>
   </div>
  </div>
 </Teleport>
</template>
<script setup>
import {ref,reactive,computed,watch,nextTick,onBeforeUnmount,Teleport} from 'vue';
import {f7} from 'framework7-vue';
import {ct} from '../js/agent-i18n.js';
import {renderMarkdown} from '../js/markdown.js';
import {saveFile as keepFile,sharesFiles} from '../js/saveFile.js';
const props=defineProps({file:Object,conversationId:String});
const imageUrl=ref(''),loading=ref(false),error=ref('');let controller;
// A file chosen but not sent yet is previewed from the device itself (file.local): nothing is fetched and there is nothing to download.
const url=computed(()=>props.file&&!props.file.local?'/api/conversations/'+(props.file.conversationId||props.conversationId)+'/attachments/'+props.file.id:'');
const IMAGE=/\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif)$/i;
const isImage=computed(()=>!!props.file&&IMAGE.test(props.file.name));
// An audio attachment, played in place. The type comes from the name, the bytes from the server.
const AUDIO_TYPES={mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',wav:'audio/wav',ogg:'audio/ogg',oga:'audio/ogg',opus:'audio/ogg',flac:'audio/flac'};
const AUDIO=/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
const isAudio=computed(()=>!!props.file&&AUDIO.test(props.file.name));
// Video a browser plays by itself, played in place the same way. A .mov is offered as MP4: that is what a phone's recording holds, and
// a browser refuses the QuickTime type by name.
const VIDEO_TYPES={mp4:'video/mp4',m4v:'video/mp4',mov:'video/mp4',webm:'video/webm',ogv:'video/ogg'};
const VIDEO=/\.(mp4|m4v|mov|webm|ogv)$/i;
const isVideo=computed(()=>!!props.file&&VIDEO.test(props.file.name));
const isMedia=computed(()=>isAudio.value||isVideo.value);
// Text worth reading in place: notes, logs, data, diffs, and code or config files.
const TEXT=/\.(md|markdown|txt|text|log|csv|tsv|json|jsonl|ya?ml|diff|patch|toml|ini|conf|cfg|xml|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|vue|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|bash|sql|env|gitignore|dockerfile)$/i,TEXT_LIMIT=1<<20;
const isDiff=computed(()=>!!props.file&&/\.(diff|patch)$/i.test(props.file.name));
// A diff's lines, each with the kind that colours it.
const diffLines=computed(()=>isDiff.value?text.value.split('\n').map(line=>({line,kind:/^(\+\+\+|---)\s/.test(line)||/^diff |^index /.test(line)?'file':line.startsWith('@@')?'hunk':line.startsWith('+')?'add':line.startsWith('-')?'del':''})):[]);
const isText=computed(()=>!!props.file&&TEXT.test(props.file.name));
const isMarkdown=computed(()=>!!props.file&&/\.(md|markdown)$/i.test(props.file.name));
// The server shows a page up to 8 MB; a larger one stays source.
const isHtml=computed(()=>!!props.file&&!props.file.local&&/\.html?$/i.test(props.file.name)&&!(props.file.size>8*1024*1024));
const htmlSource=ref(false),asPage=computed(()=>isHtml.value&&!htmlSource.value);
// Each file opens as its page again.
watch(()=>props.file?.id,()=>{htmlSource.value=false;});
const text=ref(''),cut=ref(false);
// The text panel's own size, when the owner has dragged one. The panel stays
// centred, so an edge follows the pointer and the opposite edge moves with it.
const SIZE_KEY='cc-agent-text-preview-size',EDGES=['n','s','e','w','ne','nw','se','sw'],MIN_W=320,MIN_H=220;
const textSize=ref((()=>{try{const v=JSON.parse(localStorage.getItem(SIZE_KEY)||'null');return v&&v.width>0&&v.height>0?v:null;}catch{return null;}})());
const room=()=>({width:window.innerWidth-32,height:window.innerHeight-32});
const clampSize=({width,height})=>{const r=room();return {width:Math.round(Math.max(Math.min(MIN_W,r.width),Math.min(width,r.width))),height:Math.round(Math.max(Math.min(MIN_H,r.height),Math.min(height,r.height)))};};
function startResize(event,edge){
 const panel=event.currentTarget.closest('.image-panel');if(!panel)return;
 const box=panel.getBoundingClientRect(),start={x:event.clientX,y:event.clientY,width:box.width,height:box.height};
 const sx=edge.includes('e')?2:edge.includes('w')?-2:0,sy=edge.includes('s')?2:edge.includes('n')?-2:0;
 document.body.classList.add('text-resizing');document.body.dataset.resizeEdge=edge;
 const move=e=>{textSize.value=clampSize({width:start.width+sx*(e.clientX-start.x),height:start.height+sy*(e.clientY-start.y)});};
 const end=()=>{resizedAt=Date.now();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);document.body.classList.remove('text-resizing');delete document.body.dataset.resizeEdge;try{if(textSize.value)localStorage.setItem(SIZE_KEY,JSON.stringify(textSize.value));}catch{}};
 window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
}
function resetSize(){textSize.value=null;try{localStorage.removeItem(SIZE_KEY);}catch{}}
// A code block's copy button, as in the bubbles.
function onTextClick(event){
 const button=event.target.closest?.('.md-copy');if(!button)return;
 event.preventDefault();const pre=button.parentElement?.querySelector('pre');if(!pre)return;
 navigator.clipboard?.writeText(pre.textContent.replace(/\n$/,'')).then(()=>f7.toast.create({text:ct('已複製'),closeTimeout:1400}).open(),()=>{});
}
const emit=defineEmits(['close','change']);
// The other files of the same bubble that open here, to step through with the
// arrows, the keyboard or a swipe. A file that
// only downloads is left out of the row.
const previewable=f=>!!f&&(IMAGE.test(f.name)||TEXT.test(f.name)||AUDIO.test(f.name)||VIDEO.test(f.name));
const siblings=computed(()=>(props.file?.group||[]).filter(previewable));
const place=computed(()=>siblings.value.findIndex(f=>f.id===props.file?.id));
function step(d){const next=siblings.value[place.value+d];if(next){actual.value=false;resetZoom();emit('change',{...next,group:props.file.group});}}
let swipe=null;
function swipeStart(e){swipe=!actual.value&&pinch.scale===1&&e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;}
function swipeEnd(e){if(!swipe)return;const t=e.changedTouches[0],dx=t.clientX-swipe.x,dy=t.clientY-swipe.y;swipe=null;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)step(dx<0?1:-1);}
// Two fingers zoom the picture, as in Photos: the
// point between them stays under them; one finger moves a zoomed picture; a double
// tap zooms in there, or back out. A swipe only changes the file at full view.
const stage=ref(null),pinch=reactive({scale:1,x:0,y:0});
const MAX_ZOOM=5;
let gesture=null,lastTap=0;
const mid=t=>({x:(t[0].clientX+t[1].clientX)/2,y:(t[0].clientY+t[1].clientY)/2});
const gap=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
// Where the picture's centre sits unzoomed: the point the transform is measured from.
function centre(){const r=(stage.value?.querySelector('img')||stage.value)?.getBoundingClientRect();return r?{x:r.left+r.width/2-pinch.x,y:r.top+r.height/2-pinch.y}:{x:0,y:0};}
function resetZoom(){pinch.scale=1;pinch.x=0;pinch.y=0;gesture=null;}
// Zoom to s keeping the screen point p where it is.
function zoomAt(s,p,from=pinch){const c=centre(),k=s/from.scale;pinch.x=p.x-c.x-(p.x-c.x-from.x)*k;pinch.y=p.y-c.y-(p.y-c.y-from.y)*k;pinch.scale=s;}
function touchStart(e){
 if(e.touches.length===2){e.preventDefault();swipe=null;gesture={kind:'pinch',gap:gap(e.touches),mid:mid(e.touches),scale:pinch.scale,x:pinch.x,y:pinch.y};return;}
 if(e.touches.length!==1)return;
 const t=e.touches[0];
 if(pinch.scale>1){gesture={kind:'pan',x:t.clientX,y:t.clientY,px:pinch.x,py:pinch.y};return;}
 swipeStart(e);
}
function touchMove(e){
 if(!gesture)return;
 e.preventDefault();
 if(gesture.kind==='pinch'&&e.touches.length===2){
  const s=Math.min(MAX_ZOOM,Math.max(1,gesture.scale*gap(e.touches)/gesture.gap)),m=mid(e.touches),c=centre(),k=s/gesture.scale;
  pinch.x=m.x-c.x-(gesture.mid.x-c.x-gesture.x)*k;pinch.y=m.y-c.y-(gesture.mid.y-c.y-gesture.y)*k;pinch.scale=s;
 }else if(gesture.kind==='pan'&&e.touches.length===1){pinch.x=gesture.px+e.touches[0].clientX-gesture.x;pinch.y=gesture.py+e.touches[0].clientY-gesture.y;}
}
function touchEnd(e){
 const was=gesture;
 if(gesture&&e.touches.length===0){gesture=null;if(pinch.scale<1.02)resetZoom();}
 else if(gesture?.kind==='pinch'&&e.touches.length===1){gesture={kind:'pan',x:e.touches[0].clientX,y:e.touches[0].clientY,px:pinch.x,py:pinch.y};}
 if(!was)swipeEnd(e);
 // A double tap: in to 2.5x at that point, or back out.
 if(e.touches.length===0&&e.changedTouches.length===1&&!(was&&was.kind==='pinch')){
  const now=Date.now(),t=e.changedTouches[0];
  if(now-lastTap<300){lastTap=0;if(pinch.scale>1)resetZoom();else zoomAt(2.5,{x:t.clientX,y:t.clientY});}else lastTap=now;
 }
}
// A trackpad pinch arrives as a wheel with ctrl held; on a computer a plain wheel
// zooms too, unless the picture is at its actual size and scrolls (a computer could not zoom at all).
function wheelZoom(e){if(!e.ctrlKey&&actual.value)return;e.preventDefault();const s=Math.min(MAX_ZOOM,Math.max(1,pinch.scale*Math.exp(-e.deltaY/100)));if(s===1){resetZoom();return;}zoomAt(s,{x:e.clientX,y:e.clientY});}
const actual=ref(false),size=ref(null),zoomable=ref(false);
// A mouse: the wheel zooms where it points, drag pans a zoomed picture, and the
// buttons in the bar step in and out; a click still shows the actual size. A touch
// keeps its own gestures.
let dragged=false,mouseDrag=null;
function mouseDown(e){
 dragged=false;
 if(e.pointerType!=='mouse'||e.button!==0||pinch.scale<=1)return;
 e.preventDefault();mouseDrag={x:e.clientX,y:e.clientY,px:pinch.x,py:pinch.y};
 const move=m=>{if(!mouseDrag)return;const dx=m.clientX-mouseDrag.x,dy=m.clientY-mouseDrag.y;if(Math.abs(dx)+Math.abs(dy)>3)dragged=true;pinch.x=mouseDrag.px+dx;pinch.y=mouseDrag.py+dy;};
 const up=()=>{mouseDrag=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);};
 window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
}
// A mouse click enlarges the picture where it was clicked, to its own size or twice
// when it already shows at that, and a second click goes back; dragging moves it
// (a click always showed the top left corner).
function imageClick(e){
 if(dragged){dragged=false;return;}
 if(e.pointerType!=='mouse'){if(pinch.scale===1)toggle();return;}
 if(pinch.scale>1||actual.value){actual.value=false;resetZoom();return;}
 const own=size.value?size.value.width/e.target.clientWidth:1;
 zoomAt(Math.min(MAX_ZOOM,own>1.2?own:2),{x:e.clientX,y:e.clientY});
}
function zoomStep(dir){const s=Math.min(MAX_ZOOM,Math.max(1,pinch.scale*(dir>0?1.5:1/1.5)));if(s<=1.01){resetZoom();return;}actual.value=false;zoomAt(s,centre());}
function close(){actual.value=false;resetZoom();emit('close');}
// A drag that ends outside the panel ends in a click on the backdrop: not a close.
let resizedAt=0;
function closeOutside(){if(Date.now()-resizedAt>300)close();}
function onKey(event){if(!props.file||!(isImage.value||isText.value||isMedia.value))return;if(event.key==='Escape')close();else if(siblings.value.length>1&&(event.key==='ArrowLeft'||event.key==='ArrowRight')&&!event.target?.closest?.('input,textarea,[contenteditable]')){event.preventDefault();step(event.key==='ArrowLeft'?-1:1);}}
if(typeof window!=='undefined'){window.addEventListener('keydown',onKey);window.addEventListener('resize',measure);}
// A Mac screenshot holds twice the screen's pixels and says so in its pHYs chunk
// (144 dpi). Drawn pixel for pixel it came out about twice the size it had on
// screen, blurred and filling the window like a broken page. Its size on screen is the pixels divided by that density.
async function pngSize(blob){
 try{
  const b=new DataView(await blob.slice(0,1<<18).arrayBuffer());
  if(b.byteLength<24||b.getUint32(0)!==0x89504e47)return null;
  let width=0,height=0,density=1;
  for(let at=8;at+8<=b.byteLength;at+=12+b.getUint32(at)){
   const type=b.getUint32(at+4);
   if(type===0x49484452){width=b.getUint32(at+8);height=b.getUint32(at+12);}                      // IHDR
   else if(type===0x70485973&&at+17<=b.byteLength&&b.getUint8(at+16)===1){                          // pHYs, per metre
    const dpi=b.getUint32(at+8)*0.0254;if(dpi>=100&&dpi<=600)density=Math.round(dpi/72*4)/4;}
   else if(type===0x49444154)break;                                                                 // IDAT: no more metadata
  }
  return width&&height?{width:width/density,height:height/density}:null;
 }catch{return null;}
}
// The picture's own size, or the pixels themselves when it gives none; only a
// picture shrunk to fit has a larger size to show on a click.
function measure(event){
 const img=event?.target instanceof HTMLImageElement?event.target:document.querySelector('.image-viewer .image-stage img');
 if(!img)return;
 if(!size.value&&img.naturalWidth)size.value={width:img.naturalWidth,height:img.naturalHeight};
 nextTick(()=>{if(!actual.value&&size.value)zoomable.value=img.clientWidth+1<size.value.width||img.clientHeight+1<size.value.height;});
}
function toggle(){if(actual.value||zoomable.value)actual.value=!actual.value;}
const escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// A download, or on an iPhone home-screen app the share sheet (saveFile.js).
function saveFile(){keepFile(url.value,props.file.name,{confirm:askShare});}
function onSave(event){if(!sharesFiles())return;event.preventDefault();saveFile();}
function askShare(run){f7.dialog.create({title:escapeHtml(props.file.name),text:ct('檔案準備好了'),buttons:[{text:ct('取消')},{text:ct('儲存或分享'),bold:true,onClick:run}]}).open();}
let dialog=null;
watch(()=>props.file,file=>{
 dialog?.close();dialog=null;
 if(!file||isImage.value||isText.value||isMedia.value)return;
 const size=file.size<1024?file.size+' B':(file.size/1024).toFixed(1)+' KB';
 dialog=f7.dialog.create({
  cssClass:'attachment-dialog',
  title:escapeHtml(file.name),
  text:escapeHtml(size),
  buttons:file.local?[{text:ct('關閉'),bold:true}]:[{text:ct('下載檔案'),bold:true,onClick:saveFile},{text:ct('關閉')}],
  on:{closed(){dialog=null;emit('close');}},
 }).open();
});
function cleanup(){controller?.abort();controller=null;if(imageUrl.value)URL.revokeObjectURL(imageUrl.value);imageUrl.value='';size.value=null;zoomable.value=false;text.value='';cut.value=false;}
watch([()=>props.file,()=>props.conversationId],async()=>{
 cleanup();error.value='';loading.value=false;
 if(!isImage.value&&!isText.value&&!isMedia.value)return;
 const current=new AbortController();controller=current;loading.value=true;
 if(isMedia.value){
  try{let blob=props.file.local;if(!blob){const r=await fetch(url.value,{credentials:'include',signal:current.signal});if(!r.ok)throw new Error();blob=await r.blob();}if(controller!==current)return;imageUrl.value=URL.createObjectURL(new Blob([blob],{type:(isVideo.value?VIDEO_TYPES:AUDIO_TYPES)[props.file.name.split('.').pop().toLowerCase()]}));}
  catch(e){if(controller===current&&!current.signal.aborted)error.value=ct(isVideo.value?'無法播放此影片':'無法播放此音訊');}
  finally{if(controller===current)loading.value=false;}
  return;
 }
 if(isText.value){
  // Only the first megabyte: a large log would otherwise be read whole to show a page of it.
  try{let blob=props.file.local;if(!blob){const r=await fetch(url.value,{credentials:'include',signal:current.signal});if(!r.ok)throw new Error();blob=await r.blob();}const shown=await blob.slice(0,TEXT_LIMIT).text();if(controller!==current)return;text.value=shown;cut.value=blob.size>TEXT_LIMIT;}
  catch(e){if(controller===current&&!current.signal.aborted)error.value=ct('無法預覽此檔案');}
  finally{if(controller===current)loading.value=false;}
  return;
 }
 try{let blob=props.file.local;if(!blob){const r=await fetch(url.value,{credentials:'include',signal:current.signal});if(!r.ok)throw new Error();blob=await r.blob();}const own=await pngSize(blob);if(controller!==current)return;size.value=own;
 // An SVG served as plain bytes shows only when the blob says what it is; it is still drawn in an <img>, so scripts in it never run.
 imageUrl.value=URL.createObjectURL(/\.svg$/i.test(props.file.name)&&blob.type!=='image/svg+xml'?new Blob([blob],{type:'image/svg+xml'}):blob);}
 catch(e){if(controller===current&&!current.signal.aborted)error.value=ct('無法預覽此圖片');}
 finally{if(controller===current)loading.value=false;}
},{immediate:true});
onBeforeUnmount(()=>{cleanup();dialog?.close();window.removeEventListener('keydown',onKey);window.removeEventListener('resize',measure);});
</script>
<style scoped>
/* A screenshot of this app must not melt into the app behind it: a darker backdrop
   and an edge round the panel. */
.image-viewer {position:fixed;inset:0;z-index:13600;display:flex;align-items:center;justify-content:center;padding:max(16px,var(--f7-safe-area-top,0px)) 16px max(16px,var(--f7-safe-area-bottom,0px));box-sizing:border-box;background:rgba(0,0,0,.86);}
.image-panel {display:flex;flex-direction:column;max-width:100%;max-height:100%;min-width:min(320px,100%);border-radius:16px;overflow:hidden;background:var(--f7-page-bg-color,#121212);border:1px solid color-mix(in srgb,currentColor 18%,transparent);box-shadow:0 10px 40px rgba(0,0,0,.45);}
.image-bar {display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;min-width:0;}
.image-name {flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
.image-size {flex:0 0 auto;color:var(--cc-color-text-secondary);}
.image-count {flex:0 0 auto;font-variant-numeric:tabular-nums;color:var(--cc-color-text-secondary);}
.image-panel {position:relative;}
.image-step {position:absolute;top:50%;z-index:3;width:40px;height:40px;margin-top:-20px;border:0;border-radius:20px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;}
.image-step.prev {left:8px;}
.image-step.next {right:8px;}
.image-step:disabled {opacity:0;pointer-events:none;}
.image-step .icon {font-size:20px;}
.image-action {flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:17px;color:inherit;background:color-mix(in srgb,currentColor 10%,transparent);}
.image-action .icon {font-size:18px;}
/* Close stands apart from download, so a tap meant for one does not hit the other. */
.image-close {margin-left:14px;position:relative;}
.image-close::before {content:'';position:absolute;left:-8px;top:8px;bottom:8px;width:1px;background:color-mix(in srgb,currentColor 22%,transparent);}
/* Fitted: the picture's own size (--w, --h), shrunk at its proportions when the
   screen is smaller, so the panel wraps it with no bands and never blows it up.
   Actual size: its own size even past the screen, scrolling. */
.audio-panel {min-width:min(420px,100%);}
.audio-stage {display:flex;align-items:center;justify-content:center;padding:20px 16px 24px;min-height:64px;}
.audio-panel:has(.image-step) .audio-stage {padding-left:56px;padding-right:56px;}
.audio-stage audio {width:100%;}
.video-stage {display:flex;align-items:center;justify-content:center;min-height:120px;background:#000;}
.video-stage video {display:block;max-width:min(100%,calc(100vw - 32px));max-height:calc(100vh - 32px - 54px - var(--f7-safe-area-top,0px) - var(--f7-safe-area-bottom,0px));}
.video-stage p {color:#fff;padding:20px 16px;}
.image-stage {display:flex;align-items:center;justify-content:center;min-height:120px;overflow:auto;max-height:calc(100vh - 32px - 54px - var(--f7-safe-area-top,0px) - var(--f7-safe-area-bottom,0px));}
.image-stage img {display:block;max-width:min(var(--w,100vw),calc(100vw - 32px));max-height:min(var(--h,100vh),calc(100vh - 32px - 54px - var(--f7-safe-area-top,0px) - var(--f7-safe-area-bottom,0px)));width:auto;height:auto;}
.image-stage img.zoomable {cursor:zoom-in;}
@media (hover:hover) and (pointer:fine){.image-stage img {cursor:zoom-in;}}
@media (hover:hover) and (pointer:fine){.image-stage.pinched img {cursor:grab;}.image-stage.pinched img:active {cursor:grabbing;}}
.image-action.disabled {opacity:.35;pointer-events:none;}
.image-stage:has(img) {min-height:0;}
.image-stage.actual {justify-content:flex-start;align-items:flex-start;}
.image-stage img {touch-action:none;transform-origin:center;will-change:transform;}
/* Enlarged, the stage takes all the room the window has: a wide strip of a picture
   is not cut to the band it fitted in. The panel is centred, so the stage's centre,
   which the zoom is measured from, stays where it was. */
.image-stage.pinched {overflow:hidden;width:calc(100vw - 32px);height:calc(100vh - 32px - 54px - var(--f7-safe-area-top,0px) - var(--f7-safe-area-bottom,0px));}
.image-stage.actual img {max-width:var(--w,none);max-height:var(--h,none);cursor:zoom-out;}
.image-stage p {margin:16px;}
/* A text file: a reading-width panel, its text scrolling inside it. */
/* A text file: a large reading panel by default, its text scrolling inside it;
   once dragged, the owner's size (--tw, --th), never past the screen. */
.image-panel.text-panel {position:relative;width:min(980px,100%);height:min(86vh,100%);}
.image-panel.text-panel.text-sized {width:min(var(--tw),100%);height:min(var(--th),100%);}
.text-stage {flex:1 1 auto;overflow:auto;padding:4px 22px 22px;min-height:0;box-sizing:border-box;-webkit-user-select:text;user-select:text;}
.text-resize {position:absolute;z-index:2;touch-action:none;}
.text-resize.edge-n,.text-resize.edge-s {left:14px;right:14px;height:10px;cursor:ns-resize;}
.text-resize.edge-n {top:-3px;}
.text-resize.edge-s {bottom:-3px;}
.text-resize.edge-e,.text-resize.edge-w {top:14px;bottom:14px;width:10px;cursor:ew-resize;}
.text-resize.edge-e {right:-3px;}
.text-resize.edge-w {left:-3px;}
.text-resize.edge-ne,.text-resize.edge-nw,.text-resize.edge-se,.text-resize.edge-sw {width:16px;height:16px;}
.text-resize.edge-ne {top:-3px;right:-3px;cursor:nesw-resize;}
.text-resize.edge-sw {bottom:-3px;left:-3px;cursor:nesw-resize;}
.text-resize.edge-nw {top:-3px;left:-3px;cursor:nwse-resize;}
.text-resize.edge-se {bottom:-3px;right:-3px;cursor:nwse-resize;}
/* A grip in the bottom-right corner shows the panel can be resized. */
.text-resize.edge-se::after {content:'';position:absolute;right:6px;bottom:6px;width:9px;height:9px;border-right:2px solid color-mix(in srgb,currentColor 35%,transparent);border-bottom:2px solid color-mix(in srgb,currentColor 35%,transparent);border-bottom-right-radius:3px;}
.text-stage .preloader {display:block;margin:40px auto;}
/* An .html file as a page: the frame fills the panel, on white as a browser shows it. */
.html-panel .text-stage {padding:0;overflow:hidden;display:flex;}
.html-frame {flex:1 1 auto;width:100%;height:100%;border:0;background:#fff;border-radius:0 0 12px 12px;}
/* While the panel is being resized the frame would swallow the pointer. */
body.text-resizing .html-frame {pointer-events:none;}
.text-plain {margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.55;}
/* A diff reads as one: added lines green, removed red, hunks and files marked. */
.text-diff span {display:block;min-height:1.55em;padding:0 6px;margin:0 -6px;}
.text-diff .diff-add {background:rgba(46,160,67,.18);color:#7ee787;}
.text-diff .diff-del {background:rgba(248,81,73,.16);color:#ffa198;}
.text-diff .diff-hunk {color:#79c0ff;}
.text-diff .diff-file {color:var(--cc-color-text-secondary);font-weight:600;}
.text-cut {margin:14px 0 0;color:var(--cc-color-text-secondary);font-size:13px;}
/* Markdown as the bubbles set it (MessageList.vue). */
.text-md {font-size:15px;line-height:1.55;overflow-wrap:anywhere;}
.text-md :deep(> :first-child) {margin-top:0;}
.text-md :deep(p) {margin:0 0 .7em;}
.text-md :deep(:is(h1,h2,h3,h4,h5,h6)) {margin:1.1em 0 .45em;line-height:1.3;font-weight:700;}
.text-md :deep(h1) {font-size:1.35em;}
.text-md :deep(h2) {font-size:1.2em;}
.text-md :deep(h3) {font-size:1.08em;}
.text-md :deep(:is(h1,h2)) {padding-bottom:.25em;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent);}
.text-md :deep(:is(ul,ol)) {margin:0 0 .7em;padding-left:1.35em;}
.text-md :deep(li) {margin:.18em 0;}
.text-md :deep(li > p) {margin:0;}
.text-md :deep(code) {font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;padding:.14em .4em;border-radius:6px;background:color-mix(in srgb,currentColor 13%,transparent);}
.text-md :deep(.md-code) {position:relative;}
.text-md :deep(pre) {margin:0 0 .7em;padding:12px 44px 12px 14px;border-radius:10px;background:color-mix(in srgb,currentColor 8%,transparent);border:1px solid color-mix(in srgb,currentColor 12%,transparent);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;}
.text-md :deep(pre code) {padding:0;border-radius:0;background:none;}
.text-md :deep(.md-copy) {position:absolute;top:6px;right:6px;display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:color-mix(in srgb,currentColor 12%,transparent);color:inherit;opacity:.75;cursor:pointer;}
.text-md :deep(.md-copy .icon) {font-size:16px;}
.text-md :deep(blockquote) {margin:0 0 .7em;padding:.1em 0 .1em .85em;border-left:3px solid color-mix(in srgb,currentColor 35%,transparent);color:color-mix(in srgb,currentColor 75%,transparent);}
.text-md :deep(hr) {height:1px;margin:1em 0;border:0;background:color-mix(in srgb,currentColor 22%,transparent);}
.text-md :deep(a) {color:inherit;text-decoration:underline;text-underline-offset:2px;}
.text-md :deep(.md-scroll) {overflow-x:auto;margin:0 0 .7em;}
.text-md :deep(table) {border-collapse:collapse;}
.text-md :deep(:is(th,td)) {padding:6px 10px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);text-align:left;}
</style>
<style>
/* While resizing, the text under the pointer is not selected and the cursor stays. */
body.text-resizing, body.text-resizing * {-webkit-user-select:none !important;user-select:none !important;}
body.text-resizing[data-resize-edge=n], body.text-resizing[data-resize-edge=n] *, body.text-resizing[data-resize-edge=s], body.text-resizing[data-resize-edge=s] * {cursor:ns-resize !important;}
body.text-resizing[data-resize-edge=e], body.text-resizing[data-resize-edge=e] *, body.text-resizing[data-resize-edge=w], body.text-resizing[data-resize-edge=w] * {cursor:ew-resize !important;}
body.text-resizing[data-resize-edge=ne], body.text-resizing[data-resize-edge=ne] *, body.text-resizing[data-resize-edge=sw], body.text-resizing[data-resize-edge=sw] * {cursor:nesw-resize !important;}
body.text-resizing[data-resize-edge=nw], body.text-resizing[data-resize-edge=nw] *, body.text-resizing[data-resize-edge=se], body.text-resizing[data-resize-edge=se] * {cursor:nwse-resize !important;}
</style>
