import {ref} from 'vue';

// Schedules an agent proposes and the owner approves (SchedulesPage.vue). What a
// schedule's frequency and times read as lives here, apart from the page, so the
// wording can be checked without a browser. `zh` picks Traditional Chinese.

// The schedule a notification's /?schedule=<id> named (App.vue sets it, the page
// opens it once it has loaded).
export const scheduleFocus = ref(null);

// 'weekdays' is the sheet's own preset for weekly on Monday to Friday; the server
// only ever sees it as weekly.
export const FREQUENCY_TYPES = ['daily', 'weekdays', 'weekly', 'monthly', 'interval', 'dates'];
// Set dates: each runs once; the server takes up to this many.
export const MAX_DATES = 24;
// Monday first, as a week is read here; 0 is Sunday, as the server stores it.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAYS = [1, 2, 3, 4, 5];
const isWeekdays = (days = []) => days.length === 5 && WEEKDAYS.every((d) => days.includes(d));
const ZH_DAYS = ['日', '一', '二', '三', '四', '五', '六'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekdayLabel = (day, zh) => (zh ? ZH_DAYS : EN_DAYS)[day];

const pad = (n) => String(n).padStart(2, '0');

export function frequencyText(f, zh) {
  if (!f) return '';
  // Several fixed times read as one: 每天 09:00、21:00.
  if (f.times?.length > 1) return frequencyText({...f, time: f.times.join(zh ? '、' : ', '), times: undefined}, zh);
  if (f.type === 'daily') return zh ? `每天 ${f.time}` : `Daily ${f.time}`;
  if (f.type === 'weekly' && isWeekdays(f.days)) return zh ? `週一到週五 ${f.time}` : `Weekdays ${f.time}`;
  if (f.type === 'weekly') {
    const days = WEEK_ORDER.filter((d) => (f.days || []).includes(d));
    return zh ? `每週${days.map((d) => ZH_DAYS[d]).join('、')} ${f.time}` : `Every ${days.map((d) => EN_DAYS[d]).join(', ')} ${f.time}`;
  }
  if (f.type === 'monthly') return zh ? `每月 ${f.day} 日 ${f.time}` : `Monthly on day ${f.day} ${f.time}`;
  if (f.type === 'interval') return zh ? `每 ${f.hours} 小時` : `Every ${f.hours} ${Number(f.hours) === 1 ? 'hour' : 'hours'}`;
  if (f.type === 'dates') {
    // 12/8、2027/3/6: the year only when it is not this one.
    const year = new Date().getFullYear();
    const days = (f.dates || []).map((d) => { const [y, m, day] = d.split('-').map(Number); return (y === year ? '' : y + '/') + m + '/' + day; });
    return zh ? `${days.join('、')} ${f.time}` : `${days.join(', ')} at ${f.time}`;
  }
  return '';
}

// A moment in the reader's own time, short: 9/26 09:00.
export function shortTime(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A frequency the sheet can edit: every field present, whatever type it is now, so
// switching the type keeps what was typed for the others.
export function editableFrequency(f = {}) {
  return {
    type: f.type === 'weekly' && isWeekdays(f.days) ? 'weekdays' : FREQUENCY_TYPES.includes(f.type) ? f.type : 'daily',
    time: /^\d{2}:\d{2}$/.test(f.time || '') ? f.time : '09:00',
    times: Array.isArray(f.times) && f.times.length > 1 ? [...f.times] : [/^\d{2}:\d{2}$/.test(f.time || '') ? f.time : '09:00'],
    days: Array.isArray(f.days) && f.days.length ? [...f.days] : [1],
    day: Number(f.day) || 1,
    hours: Number(f.hours) || 6,
    dates: Array.isArray(f.dates) && f.dates.length ? [...f.dates] : [''],
  };
}

// Only the fields the chosen type has, as the server takes them; null when it is
// not complete.
export function frequencyFor(e) {
  const list = Array.isArray(e.times) ? e.times : [e.time];
  const valid = list.length && list.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || ''));
  const times = valid ? [...new Set(list)].sort() : [];
  const time = times[0] || null;
  const at = times.length > 1 ? {time, times} : {time};
  if (e.type === 'interval') {
    const hours = Number(e.hours);
    return Number.isInteger(hours) && hours >= 1 && hours <= 168 ? {type: 'interval', hours} : null;
  }
  if (!time) return null;
  if (e.type === 'daily') return {type: 'daily', ...at};
  if (e.type === 'weekdays') return {type: 'weekly', ...at, days: [...WEEKDAYS]};
  if (e.type === 'weekly') {
    const days = WEEK_ORDER.filter((d) => (e.days || []).includes(d)).sort((a, b) => a - b);
    return days.length ? {type: 'weekly', ...at, days} : null;
  }
  if (e.type === 'monthly') {
    const day = Number(e.day);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? {type: 'monthly', ...at, day} : null;
  }
  if (e.type === 'dates') {
    const list = (e.dates || []).filter(Boolean);
    if (!list.length || list.length > MAX_DATES || !list.every(validDate)) return null;
    return {type: 'dates', ...at, dates: [...new Set(list)].sort()};
  }
  return null;
}

// A background script's settings as the sheet shows and edits them.
// The script text itself is the agent's to change, never the sheet's.
const INTERPRETERS = {python: 'Python', node: 'Node.js', sh: 'sh', bash: 'bash', zsh: 'zsh'};
export const interpreterLabel = (i) => INTERPRETERS[i] || i || '';
export const shortHash = (hash) => (hash ? hash.slice(0, 12) + '…' : '');
export const MAX_DOMAINS = 10;
// The host names the server takes: letters, digits and dashes, an optional *. first.
const DOMAIN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// Host names typed one per line or separated by commas; `bad` lists what is not one.
export function parseDomains(text) {
  const domains = [...new Set(String(text || '').split(/[\s,，、;]+/).map((d) => d.trim().toLowerCase()).filter(Boolean))];
  return {domains, bad: domains.filter((d) => !DOMAIN.test(d))};
}

// A time limit in whole seconds from 5 to 600, or null.
export function timeoutFor(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 5 && n <= 600 ? n : null;
}

// A last day, 'YYYY-MM-DD', read short: 到 9/30. Empty for none or a bad one.
export function untilText(until, zh) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(until || '');
  if (!m) return '';
  const day = `${Number(m[1])}/${Number(m[2])}`;
  return zh ? `到 ${day}` : `until ${day}`;
}
export const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v));
export const validTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '');
