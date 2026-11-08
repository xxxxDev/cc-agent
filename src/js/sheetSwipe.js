// Phone sheets pushed as an iOS card: a popup with :swipe-to-close="sheetSwipe"
// :push="sheetSwipe", class sheet-swipe and a <div class="sheet-grabber"> (styled once in
// skin.css) closes with a finger pulled down from its top, and the page behind steps back as
// the card comes up. Framework7's own swipeToClose pulls the sheet only while its page is
// scrolled to the top, so a long list still scrolls.
// framework7-vue reads both only when the popup mounts, so the choice is made once: on
// wherever there is touch, off for a mouse, where a drag in a popup would close it.
import {onBeforeUnmount,watch} from 'vue';
import {askDiscard} from './profileSave.js';

export const sheetSwipe=typeof window!=='undefined'&&('ontouchstart' in window||(window.DocumentTouch&&document instanceof window.DocumentTouch))?'to-bottom':false;

// A sheet with something to lose (a form, Agent Profile) closes only through `request`, the
// sheet's own guarded close, which asks first about unsaved changes. Give the popup
// :close-by-backdrop-click="false" and its ✕ @click="request()"; this routes the other two
// ways out through `request` as well:
// - a tap on the backdrop while this sheet is open (framework7-vue reads
//   closeByBackdropClick only at mount, hence a handler of our own);
// - a pull down with `dirty()` true: Framework7 calls the popup's close right after the
//   element's popup:swipeclose, so that one call goes through `request` instead; on 繼續編輯
//   the sheet springs back, on 放棄修改 `request` closes it as from its ✕. framework7-vue's
//   own @popup:swipeclose never fires (it listens for swipeClose, Framework7 emits
//   swipeclose), hence the element's event.
// `popup` is the template ref of the f7-popup.
export function guardSheet(popup,{dirty,request}){
 const el=()=>popup.value?.$el;
 const onBackdrop=e=>{if(e.target?.classList?.contains('popup-backdrop')&&el()?.classList?.contains('modal-in'))request();};
 const onSwipe=e=>{const modal=e.currentTarget?.f7Modal;if(!dirty()||!modal)return;const close=modal.close;
  modal.close=function(){modal.close=close;modal.$el?.removeClass('swipe-close-to-bottom');request();return modal;};};
 document.addEventListener('click',onBackdrop);
 const stop=watch(el,(now,old)=>{old?.removeEventListener?.('popup:swipeclose',onSwipe);now?.addEventListener?.('popup:swipeclose',onSwipe);},{flush:'post',immediate:true});
 onBeforeUnmount(()=>{document.removeEventListener('click',onBackdrop);stop();el()?.removeEventListener?.('popup:swipeclose',onSwipe);});
}

// The guarded close of a form sheet: with unsaved changes it asks 繼續編輯/放棄修改, as
// Agent Profile does; `close` runs when the sheet may go.
export function closeAsking(dirty,close){
 return async()=>{if(dirty()&&!(await askDiscard()))return false;close();return true;};
}
