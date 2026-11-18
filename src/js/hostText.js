// The Terminal tab's server messages (server/hostTerminal.js) are written in Chinese, as the
// rest of the server's are; shown in the page's language: the whole sentence, or a known head
// with its own tail (file names, a detail from ssh).
import {ct} from './agent-i18n.js';
export function hostMessage(m) {
  m = String(m || '');
  const whole = ct(m);
  if (whole !== m) return whole;
  const i = m.indexOf('：');
  if (i > 0) { const head = m.slice(0, i + 1), t = ct(head); if (t !== head) return t + m.slice(i + 1); }
  return m;
}
