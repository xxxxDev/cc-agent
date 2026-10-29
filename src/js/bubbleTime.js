// A bubble's time: today the time alone, then
// "昨天" and the time, and from the day before that the date as well; another
// year's date carries its year. The clock follows the app's language: 上午 10:04 in
// Chinese, 10:04 AM in English.
// Avoid repeated date formatting on each poll.
const formatters = new Map();
const formattedCache = new Map();
const CACHE_MAX = 500;
const clock = (d, locale) => {
  let fmt = formatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {hour: '2-digit', minute: '2-digit'});
    formatters.set(locale, fmt);
  }
  return fmt.format(d);
};
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function bubbleTime(iso, {now = new Date(), yesterday = '昨天', locale = 'zh-TW'} = {}) {
  const today = dayStart(now);
  const key = `${iso}|${today}|${locale}|${yesterday}`;
  const hit = formattedCache.get(key);
  if (hit !== undefined) return hit;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((today - dayStart(d)) / 86400000);
  let out;
  if (days <= 0) out = clock(d, locale);
  else if (days === 1) out = `${yesterday} ${clock(d, locale)}`;
  else {
    const date = `${d.getMonth() + 1}/${d.getDate()}`;
    out = `${d.getFullYear() === now.getFullYear() ? date : `${d.getFullYear()}/${date}`} ${clock(d, locale)}`;
  }
  if (formattedCache.size >= CACHE_MAX) formattedCache.delete(formattedCache.keys().next().value);
  formattedCache.set(key, out);
  return out;
}
