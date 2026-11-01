<template>
 <!-- Claude's login from the chat:
      asks for it when it is gone, then the address and the code, with no terminal. -->
 <div class="message schedule-card login-card" :class="{done}" :data-message-id="message.id" :data-login-state="state">
  <div class="login-head"><f7-icon :f7="done?'checkmark_circle':'lock'" :size="15"/><span class="login-name">{{name}}</span><span class="login-time">{{time}}</span></div>
  <template v-if="state==='done'">
   <div class="login-text">{{resendable?ct('登入完成，剛才沒完成的訊息可以重送。'):ct('登入完成。')}}</div>
   <p v-if="error" class="login-error" role="alert">{{error}}</p>
   <f7-button v-if="resendable" fill class="login-action" :disabled="busy" @click="resend">{{ct('重送剛才的訊息')}}</f7-button>
  </template>
  <template v-else-if="state==='starting'||state==='checking'">
   <div class="login-text login-wait"><f7-preloader :size="16"/>{{state==='starting'?ct('正在準備登入網頁…'):ct('正在確認代碼…')}}</div>
   <f7-button class="login-cancel" :disabled="busy" @click="cancel">{{ct('取消')}}</f7-button>
  </template>
  <template v-else-if="state==='waiting'">
   <div class="login-step">{{ct('第一步：到登入網頁登入，完成後複製代碼')}}</div>
   <a class="button button-fill login-action external" :href="flow.url" target="_blank" rel="noopener noreferrer">{{ct('開啟登入網頁')}}</a>
   <div class="login-step">{{ct('第二步：把代碼貼在這裡')}}</div>
   <form class="login-code" @submit.prevent="submit">
    <input v-model="code" type="text" name="claude-login-code" :aria-label="ct('貼上代碼')" :placeholder="ct('貼上代碼')" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
    <f7-button fill type="submit" class="login-send" :disabled="busy||!code.trim()">{{ct('送出')}}</f7-button>
   </form>
   <p v-if="error||flow.error" class="login-error" role="alert">{{error||ct(flow.error)}}</p>
   <f7-button class="login-cancel" :disabled="busy" @click="cancel">{{ct('取消')}}</f7-button>
  </template>
  <template v-else>
   <div class="login-text">{{message.failed?ct('Claude 的登入已失效，這一輪沒有完成。'):ct('按下登入後，照卡片的步驟完成。')}}</div>
   <div class="login-note">{{admin?ct('這台電腦的 agent 共用同一個登入。'):ct('請管理員重新登入。')}}</div>
   <p v-if="error||flow.error" class="login-error" role="alert">{{error||ct(flow.error)}}</p>
   <f7-button v-if="admin" fill class="login-action" :disabled="busy" @click="begin">{{ct('登入')}}</f7-button>
  </template>
 </div>
</template>
<script setup>
import {computed,onBeforeUnmount,ref} from 'vue';
import {api} from '../js/api.js';
import {currentUser} from '../js/auth.js';
import {ct} from '../js/agent-i18n.js';
import {cancelLogin,loginFlow as flow,loginLive,sendLoginCode,startLogin,watchLogin} from '../js/claudeLogin.js';
const props=defineProps({message:{type:Object,required:true},conversationId:String,time:String});
const admin=computed(()=>currentUser.value?.role==='admin');
const done=computed(()=>props.message.login==='done');
const state=computed(()=>done.value?'done':admin.value&&loginLive(flow.value.status)?flow.value.status:'ask');
const name=computed(()=>done.value?ct('已重新登入 Claude'):props.message.failed?ct('Claude 需要重新登入'):ct('Claude 登入'));
const code=ref(''),busy=ref(false),error=ref(''),resent=ref(false);
const resendable=computed(()=>!resent.value&&(props.message.retryOf||[]).length>0);
// Nothing to read for an old card, or for someone who cannot sign in.
const unwatch=admin.value&&!done.value?watchLogin():null;
onBeforeUnmount(()=>unwatch?.());
async function run(action){
 busy.value=true;error.value='';
 try{await action();}catch(e){error.value=e.message;}
 finally{busy.value=false;}
}
const begin=()=>run(startLogin);
const cancel=()=>run(async()=>{await cancelLogin();code.value='';});
// Cleared as soon as it is sent: it is good for one sign-in and has no reason to stay.
const submit=()=>{const value=code.value;if(!value.trim())return;code.value='';return run(()=>sendLoginCode(value));};
const resend=()=>run(async()=>{await api('/conversations/'+props.conversationId+'/login-resend',{method:'POST',body:JSON.stringify({card:props.message.id})});resent.value=true;});
</script>
<style scoped>
.login-card{cursor:default}
.login-card.done{border-color:color-mix(in srgb,#30d158 45%,transparent);background:color-mix(in srgb,#30d158 9%,transparent)}
.login-head{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#ff9f0a}
.done .login-head{color:#30d158}
.login-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.login-time{flex:0 0 auto;font-weight:400;color:var(--dp-color-text-secondary)}
.login-text{font-size:14px;line-height:1.5}
.login-wait{display:flex;align-items:center;gap:8px}
.login-note{font-size:12px;line-height:1.45;color:var(--dp-color-text-secondary)}
.login-step{font-size:13px;line-height:1.4;margin-top:4px;color:var(--dp-color-text-secondary)}
.login-error{margin:0;font-size:13px;line-height:1.4;color:#ff453a}
.login-action{margin-top:4px}
.login-code{display:flex;gap:8px;align-items:center}
.login-code input{flex:1;min-width:0;height:36px;box-sizing:border-box;padding:0 10px;border-radius:10px;border:1px solid var(--dp-glass-border,#555);background:var(--dp-glass-fill-subtle,transparent);color:var(--dp-color-text);font-size:16px}
.login-send{flex:0 0 auto;width:auto;padding:0 14px}
.login-cancel{color:var(--dp-color-text-secondary)}
</style>
