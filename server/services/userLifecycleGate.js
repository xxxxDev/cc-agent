const states = new Map();

function lifecycleGateError(state) {
  return Object.assign(new Error('User lifecycle transition is in progress'), {
    status: 409,
    code: 'USER_LIFECYCLE_TRANSITION_IN_PROGRESS',
    details: { action: state.blocked?.action || null },
  });
}

function stateFor(userId) {
  const key = String(userId || '');
  if (!key) throw Object.assign(new Error('user id is required'), { status: 400, code: 'USER_ID_INVALID' });
  let state = states.get(key);
  if (!state) {
    state = { key, activeMutations: 0, blocked: null, waiters: [] };
    states.set(key, state);
  }
  return state;
}

function releaseUnusedState(state) {
  if (!state.blocked && state.activeMutations === 0 && state.waiters.length === 0) {
    states.delete(state.key);
  }
}

async function runUserScheduleMutation(userId, operation) {
  if (typeof operation !== 'function') throw new TypeError('schedule mutation operation is required');
  const state = stateFor(userId);
  if (state.blocked) {
    releaseUnusedState(state);
    throw lifecycleGateError(state);
  }
  state.activeMutations += 1;
  try {
    return await operation();
  } finally {
    state.activeMutations -= 1;
    if (state.activeMutations === 0) {
      const waiters = state.waiters.splice(0);
      waiters.forEach((resolve) => resolve());
    }
    releaseUnusedState(state);
  }
}

async function runLifecycleExclusive(userId, action, operation) {
  if (typeof operation !== 'function') throw new TypeError('lifecycle operation is required');
  const state = stateFor(userId);
  if (state.blocked) throw lifecycleGateError(state);
  state.blocked = { action };
  try {
    if (state.activeMutations > 0) {
      await new Promise((resolve) => state.waiters.push(resolve));
    }
    return await operation();
  } finally {
    state.blocked = null;
    releaseUnusedState(state);
  }
}

module.exports = {
  runUserScheduleMutation,
  runLifecycleExclusive,
};
