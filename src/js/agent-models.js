// The model and effort choices the two selects offer. An admin gets Fable and the
// CLI's full effort range (claude --effort: low, medium, high, xhigh, max);
// everyone else gets the production models and the two efforts the product is
// tuned for.
//
// This list is presentation only. `server/agentProfile.js` holds the same split
// and is what actually enforces it, from the session's verified role rather than
// anything the page sends: keep the two in step.
export const MODEL_LABELS = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-5': 'Opus 5',
  'claude-fable-5-1': 'Fable 5.1',
  'claude-fable-5-2': 'Fable 5.2',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
};
export const EFFORT_LABELS = {low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-High', max: 'Max'};
// Opus 5 left the choices for Opus 5.5; its label stays for an agent
// that still runs on it, which withCurrent keeps listed.
const MEMBER_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
// Fable 5.2 replaced Fable 5.1 in the choices; the 5.1 label stays for an agent still on it.
const ADMIN_MODELS = ['claude-fable-5-2', ...MEMBER_MODELS];
const MEMBER_EFFORTS = ['medium', 'high'];
const ADMIN_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const modelLabel = model => MODEL_LABELS[model] || model;
export const effortLabel = effort => EFFORT_LABELS[effort] || effort;
// Every agent starts with native claude: one list of its own, beside All and Recent.
export const sourceOf = () => 'native';
export const SOURCES = {
  all: {name: 'All', icon: '/sources/all.svg'},
  // Every agent in one list, the latest active first.
  recent: {name: 'Recent', icon: '/sources/recent.svg'},
  native: {name: 'Claude Code', icon: '/sources/anthropic-native.svg'},
};
// A setting already on the agent stays listed even when the current role could
// not choose it, so a demoted admin sees what their agent actually runs on rather
// than a select silently showing something else. The server allows the same.
const withCurrent = (list, current) => list.includes(current) || !current ? list : [...list, current];
export const models = (admin, current) => withCurrent(admin ? ADMIN_MODELS : MEMBER_MODELS, /^claude-/.test(current || '') ? current : null);
export const efforts = (admin, current) => withCurrent(admin ? ADMIN_EFFORTS : MEMBER_EFFORTS, current);
