// A handoff by hand carries the number of recent messages set on the admin page; with
// asking on, the owner may change it for this one (issue #9). The conversation page
// and a split-view cell both ask through here.
import {f7} from 'framework7-vue';
import {ct,handoffCount} from './agent-i18n.js';

export function askHandoff(setting,go){
 const s={recent:12,ask:true,max:50,...(setting||{})};
 if(!s.ask){f7.dialog.confirm(ct('保存記憶並帶上最近的訊息，接續到新的 Claude session？')+'（'+handoffCount(s.recent)+'）',ct('接續對話'),()=>go({recent:s.recent}));return;}
 f7.dialog.prompt(ct('保存記憶並接續到新的 Claude session。要帶上最近幾則訊息？')+'（0～'+s.max+'）',ct('接續對話'),value=>{
  const text=String(value??'').trim(),recent=Number(text);
  if(!/^\d+$/.test(text)||recent>s.max){f7.dialog.alert(ct('請輸入 0 到 ')+s.max,ct('接續對話'));return;}
  go({recent});
 },()=>{},String(s.recent));
}
