// What an agent may be set to run on. Ordinary members get the production
// models and the two efforts the product is tuned for; an admin — the person who
// carries the consequence of the choice, and who creates every agent —
// gets Fable and the CLI's full effort range (claude --effort: low, medium, high,
// xhigh, max).
//
// callerRole is a separate argument and is never read from the input, because the
// input is the request body: taking the role from there would let anyone select
// an admin-only model by sending role:'admin'.
const agentAccess=require('./agentAccess');
// Opus 5.5 came with Claude Code 2.1.280 and replaced Opus 5 in the choices.
// An agent still on Opus 5 keeps
// it, as any setting already on an agent stays saveable (below).
// The choices are the newest of each family and nothing older: Sonnet 5.5 and Haiku 5.5 came with Claude Code 2.1.293.
const MODELS=['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'];
const ADMIN_MODELS=['claude-fable-5-1',...MODELS];
// What a member's new agent, or one with no model saved, runs on.
const DEFAULT_MODEL='claude-sonnet-5-5';
const EFFORTS=['medium','high'];
const ADMIN_EFFORTS=['low','medium','high','xhigh','max'];
const allowed=(role,member,admin)=>role==='admin'?admin:member;
// A model Claude Code has moved past runs on its successor: an agent on Opus 5 is on
// Opus 5.5, however it comes back: stored, restored
// from the deleted list, provisioned from a template or brought in by an import.
// Sonnet 5 went the same way for Sonnet 5.5.
const SUCCESSORS={'claude-opus-5':'claude-opus-5-5','claude-sonnet-5':'claude-sonnet-5-5'};
const successor=model=>SUCCESSORS[model]||model;
function profile(c={}){return {title:c.title||'',description:c.description||'',memory:c.memory||'',model:successor(c.model)||DEFAULT_MODEL,effort:c.effort||'high',subagentModel:c.subagentModel||'',subagentEffort:c.subagentEffort||'',access:agentAccess.of(c)};}
// The owner's choice for the subagents this agent starts, as an instruction to it: the
// agent passes them when it starts one.
function subagentGuidance(c={}){const {subagentModel:m,subagentEffort:e}=profile(c);if(!m&&!e)return null;return 'When you start a subagent, unless the owner asks otherwise, pass'+(m?` model "${/^claude-([a-z]+)-/.exec(m)?.[1]||m}"`:'')+(m&&e?' and':'')+(e?` effort "${e}"`:'')+'.';}
// Model ids are data passed to native Claude, never a provider or launch command.
const isClaude=model=>typeof model==='string'&&/^claude-[a-z0-9][a-z0-9.-]{0,80}$/.test(model);
// What an agent runs when its saved model is not a Claude model.
const CLAUDE_FALLBACK='claude-opus-5-5';
function fit(model){return isClaude(model)?successor(model):CLAUDE_FALLBACK;}
function validate(input={},base={},callerRole){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('Profile must be an object'),{status:400});
 if(Object.hasOwn(input,'launchCommand'))throw Object.assign(new Error('Agents start with native claude; launchCommand is not supported'),{status:400});
 const p={...profile(base),...Object.fromEntries(Object.entries(input).filter(([k])=>['title','description','memory','model','effort','subagentModel','subagentEffort'].includes(k)))};
 p.model=input.model===undefined?fit(p.model):successor(p.model);
 // What an agent can reach is an admin's to set. A member's client sends the
 // profile back whole, so an unchanged scope is fine; a different one is refused.
 if(input.access!==undefined){
  const next=agentAccess.normalize(input.access);
  if(!agentAccess.same(next,p.access)&&callerRole!=='admin')throw Object.assign(new Error('Only an admin can change what an agent can reach'),{status:403});
  p.access=next;
 }
 for(const [key,max] of [['title',80],['description',4000],['memory',20000]]){if(typeof p[key]!=='string'||p[key].length>max)throw Object.assign(new Error(`${key}: maximum ${max} characters`),{status:400});}
 p.title=p.title.trim();if(!p.title)throw Object.assign(new Error('Agent name is required'),{status:400});
 // The setting already on the agent always stays selectable, so an admin-only
 // choice does not trap its owner: a demoted admin can still rename or edit the
 // memory of an agent they made, they simply cannot pick that model again.
 const models=allowed(callerRole,MODELS,ADMIN_MODELS).concat(isClaude(base.model)?[successor(base.model)]:[]);
 const efforts=allowed(callerRole,EFFORTS,ADMIN_EFFORTS).concat(base.effort?[base.effort]:[]);
 if(!models.includes(p.model)||!efforts.includes(p.effort))throw Object.assign(new Error('Invalid model or effort'),{status:400});
 // Empty leaves the choice to the agent. Same tiers as the agent's own.
 if(typeof p.subagentModel!=='string'||typeof p.subagentEffort!=='string')throw Object.assign(new Error('Invalid subagent setting'),{status:400});
 if(p.subagentModel&&!allowed(callerRole,MODELS,ADMIN_MODELS).concat(base.subagentModel||[]).includes(p.subagentModel))throw Object.assign(new Error('Invalid subagent model'),{status:400});
 if(p.subagentEffort&&!allowed(callerRole,EFFORTS,ADMIN_EFFORTS).concat(base.subagentEffort||[]).includes(p.subagentEffort))throw Object.assign(new Error('Invalid subagent effort'),{status:400});
 return p;
}
module.exports={subagentGuidance,profile,validate,successor,fit,DEFAULT_MODEL,MODELS,EFFORTS,ADMIN_MODELS,ADMIN_EFFORTS};
