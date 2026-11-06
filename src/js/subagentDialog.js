// The subagents' model and effort (issue #10): one dialog for the admin page's setting and
// for an agent's own, which adds whether it follows the admin page. Saved by the caller;
// the server checks.
import {f7} from 'framework7-vue';
import {ct} from './agent-i18n.js';
import {modelLabel,effortLabel} from './agent-models.js';

const MODELS=['claude-fable-5-1','claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'];
const EFFORTS=['low','medium','high','xhigh','max'];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);

// "Sonnet 5.5 · Medium", "Haiku 5.5 (locked) · Low", or "not set".
export function subagentLabel(s){
 if(!s||(!s.model&&!s.effort))return ct('不指定');
 return [s.model?modelLabel(s.model)+(s.lock?ct('（鎖定）'):''):ct('模型不指定'),s.effort?effortLabel(s.effort):ct('Effort 不指定')].join(' · ');
}

// own: undefined for the admin page; {follow:boolean} for one agent.
export function editSubagents({title,text,value,own,save}){
 const v={model:'',lock:false,effort:'',...(value||{})};
 const option=(id,label,sel)=>`<option value="${esc(id)}"${id===sel?' selected':''}>${esc(label)}</option>`;
 const models=option('',ct('不指定'),v.model)+MODELS.map(m=>option(m,modelLabel(m),v.model)).join('');
 const efforts=option('',ct('不指定'),v.effort)+EFFORTS.map(e=>option(e,effortLabel(e),v.effort)).join('');
 const dialog=f7.dialog.create({title:esc(title),text:esc(text),cssClass:'handoff-dialog subagent-dialog',
  content:`<div class="handoff-fields">
   ${own?`<label>${ct('設定來源')}<select class="sub-follow">${option('follow',ct('跟隨管理設定'),own.follow?'follow':'own')}${option('own',ct('自己設定'),own.follow?'follow':'own')}</select></label>`:''}
   <label>${ct('模型')}<select class="sub-model">${models}</select></label>
   <label class="handoff-ask-row">${ct('鎖定模型')}<span class="toggle"><input class="sub-lock" type="checkbox"${v.lock?' checked':''}><span class="toggle-icon"></span></span></label>
   <div class="sub-note">${ct('打開後 agent 不能另外換模型，所有子代理都用同一個模型。')}</div>
   <label>Effort<select class="sub-effort">${efforts}</select></label>
   <div class="sub-note">${ct('agent 仍可能為某一次另外調整 Effort。')}</div>
   <div class="handoff-error" role="alert"></div>
  </div>`,
  buttons:[{text:ct('取消')},{text:ct('保存'),strong:true,close:false,onClick:async d=>{
   const $=sel=>d.$el.find(sel),follow=own&&$('.sub-follow').val()==='follow';
   const model=String($('.sub-model').val()||''),next={model,lock:!!model&&$('.sub-lock').prop('checked'),effort:String($('.sub-effort').val()||'')};
   // Said inside this dialog: Framework7 holds another one back until this closes.
   try{await save(follow?null:next);d.close();}catch(e){$('.handoff-error').text(e.message||ct('保存失敗'));}
  }}],destroyOnClose:true});
 dialog.open();
 const $=sel=>dialog.$el.find(sel);
 // Following the admin page leaves the fields as they are there, not editable.
 const lockable=()=>{const off=own&&$('.sub-follow').val()==='follow';$('.sub-model,.sub-effort,.sub-lock').prop('disabled',off);$('.sub-lock').prop('disabled',off||!$('.sub-model').val());if(!$('.sub-model').val())$('.sub-lock').prop('checked',false);};
 $('.sub-follow,.sub-model').on('change',lockable);lockable();
 $('.handoff-ask-row .toggle').on('click',e=>{const box=$('.sub-lock')[0];if(e.target.tagName!=='INPUT'&&!box.disabled){e.preventDefault();box.checked=!box.checked;}});
}
