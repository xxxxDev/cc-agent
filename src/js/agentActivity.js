// Shared by the list indicator and the conversation-only operation shield.
export function agentActivity(agent, operation) {
 if (!agent) return null;
 // A restart shows as a start: the same wake, with its steps.
 if (operation) return agent.pendingRotation || agent.generation > operation.generation ? 'rotate' : operation.kind === 'restart' ? 'start' : operation.kind;
 if (['error', 'stopped'].includes(agent.phase)) return null;
 if (agent.pendingRotation || agent.phase === 'handing-off') return 'rotate';
 if (agent.compacting) return 'compact';
 if (agent.phase === 'starting' || (agent.phase === 'ready' && !agent.connected)) return 'start';
 return null;
}
