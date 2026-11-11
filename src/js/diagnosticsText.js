// The diagnostics text 工程診斷資訊 shows, copies and reports, and the recording badge reports:
// one assembly, so both send the same words. Explicit support
// fields only: never serialize the account, memory, chat or credentials.
import {keyboardTrace,traceSamples,traceWith} from './keyboardDiagnostics.js';
import {api} from './api.js';
// What /api/diagnostic-reports takes (server/diagnosticReports.js); past it the oldest samples
// are left out, and the text says so.
export const REPORT_MAX_BYTES=512*1024;
const bytes=s=>new TextEncoder().encode(s).length;
// The build id the Settings footer shows (a Git description: the release tag, and after it
// how far past), so the text and the footer never name two different versions.
export const buildId=()=>typeof __BUILD_ID__==='undefined'?'dev':__BUILD_ID__;
function assemble(detail,status,trace){
 const d=detail||{};
 return [
  'CC Agent',
  `Version: ${buildId()}`,
  `Agent ID: ${d.id}`,
  ...(d.unavailable?['Agent: no longer available to this account']:[
  `Session ID: ${d.sessionId}`,
  `Generation: ${d.generation}`,
  `Status: ${status} (${d.phase})`,
  `Compact: ${d.compactCount} / ${d.threshold||'off (no automatic handoff)'}`,
  `Configured model: ${d.model}`,
  `Configured effort: ${d.effort}`,
  `Session model: ${d.sessionModel||'legacy / unspecified'}`,
  `Session effort: ${d.sessionEffort||'legacy / unspecified'}`]),
  ...(trace?['Recorded diagnostics:',trace]:[]),
  ...(d.unavailable?[]:['Session history:',
  ...(d.runs||[]).map(run=>`  Generation ${run.number}: ${run.sessionId}${run.sessionId===d.sessionId?' (current)':''}`)]),
 ].join('\n');
}
// detail: the agent's detail object ({id, unavailable:true} when it can no longer be read);
// status: agentOperation.statusLabel(detail), as Agent Profile shows it.
export function diagnosticsText(detail,status,{maxBytes=REPORT_MAX_BYTES}={}){
 const full=assemble(detail,status,keyboardTrace.value);
 if(bytes(full)<=maxBytes)return full;
 // Too long for a report: the fewest oldest samples left out that make it fit.
 const samples=traceSamples();
 const fits=k=>bytes(assemble(detail,status,traceWith(samples.slice(k),k)))<=maxBytes;
 let lo=1,hi=samples.length;
 if(!fits(hi))return assemble(detail,status,traceWith([],samples.length));
 while(lo<hi){const mid=(lo+hi)>>1;if(fits(mid))hi=mid;else lo=mid+1;}
 return assemble(detail,status,traceWith(samples.slice(lo),lo));
}
// The report itself, from Agent Profile's 回報診斷 or the badge's 停止並回報.
export function sendDiagnosticsReport(conversationId,text){
 return api('/diagnostic-reports',{method:'POST',body:JSON.stringify({conversationId,text,build:buildId()})});
}
