// RSS and Atom subscriptions on the Schedules page: CC Agent reads the feed itself at each due time and hands only the
// entries it has not seen before to the chosen agent, which sums them up.
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
// How many new entries go to the agent in one run, and how many it remembers.
const MAX_NEW = 10, FIRST_RUN = 3, SEEN_KEPT = 300, MAX_ITEMS = 100;

function error(message, status = 400) { return Object.assign(new Error(message), { status }); }

// An address on the owner's own network is not a feed to read on a timer: an agent
// can set one up. IPv4 written inside IPv6 (mapped, compatible, NAT64) counts as
// that IPv4 address.
const blocked = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) blocked.addSubnet(a, n, 'ipv6');
function privateAddress(ip) {
  const type = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
  if (!type) return true;
  // An IPv6 form of an IPv4 address is judged as that address as well.
  const m = type === 'ipv6' && ip.toLowerCase().match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  return blocked.check(ip, type) || (!!m && blocked.check(m[1], 'ipv4'));
}

// The link as it is stored: http(s), a public host name, no credentials.
function urlOf(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2000) throw error('RSS 網址不正確');
  let url;
  try { url = new URL(input.trim()); } catch { throw error('RSS 網址不正確'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw error('RSS 網址要是 http 或 https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || (net.isIP(host) && privateAddress(host))) throw error('RSS 網址不能是本機或內部網路');
  return url.href;
}

// Every address is checked in the lookup the connection itself uses, so a name
// that answers differently the second time cannot reach inside.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!list.length || list.some((a) => privateAddress(a.address))) return callback(error('RSS 網址指向內部網路，不讀取'));
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && privateAddress(host)) return reject(error('RSS 網址不能是本機或內部網路'));
    const req = (u.protocol === 'https:' ? https : http).get(u, { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { 'user-agent': 'CC-Agent-RSS/1.0', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5', 'accept-encoding': 'identity' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); let next; try { next = new URL(res.headers.location, url).href; } catch { return reject(error('RSS 轉址網址不正確')); } return resolve({ redirect: next }); }
      if (res.statusCode !== 200) { res.resume(); return reject(error('RSS 讀取失敗：HTTP ' + res.statusCode)); }
      const parts = []; let size = 0;
      res.on('data', (d) => { size += d.length; if (size > MAX_BYTES) { req.destroy(); reject(error('RSS 內容太大（超過 2 MB）')); } else parts.push(d); });
      res.on('end', () => resolve({ body: Buffer.concat(parts).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(error('RSS 讀取逾時')));
    req.on('error', reject);
    setTimeout(() => req.destroy(error('RSS 讀取逾時')), TIMEOUT_MS).unref();
  });
}

// The fetch goes through io, so a caller with no public network can put its own get in place.
const io = { get };
async function download(url) {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    urlOf(at);
    const r = await io.get(at);
    if (r.redirect) { at = r.redirect; continue; }
    return r.body;
  }
  throw error('RSS 網址轉址太多次');
}

// The parsing below is linear in the document: a feed is read inside the service,
// and a pattern that backtracks would stall it.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function stripTags(s) {
  let out = '', i = 0;
  for (;;) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out += s.slice(i); break; }
    out += s.slice(i, lt) + ' ';
    const gt = s.indexOf('>', lt);
    if (gt < 0) break;
    i = gt + 1;
  }
  return out;
}
function openCdata(s) {
  let out = '', i = 0;
  for (;;) {
    const at = s.indexOf('<![CDATA[', i);
    if (at < 0) { out += s.slice(i); break; }
    const end = s.indexOf(']]>', at + 9);
    const inner = s.slice(at + 9, end < 0 ? s.length : end);
    out += s.slice(i, at) + inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (end < 0) break;
    i = end + 3;
  }
  return out;
}
// Text only: CDATA opened, markup and entities turned into plain words; HTML that
// a feed escapes is stripped once it is unescaped.
function plain(s = '') { return decode(stripTags(decode(stripTags(openCdata(s))))).replace(/\s+/g, ' ').trim(); }
// The content of the first <name> (or <prefix:name>) element in a block.
function tag(block, lower, name) {
  const re = new RegExp(`<([\\w.-]{1,40}:)?${name}(?=[\\s>/])`, 'g');
  for (let m = re.exec(lower); m; m = re.exec(lower)) {
    const gt = lower.indexOf('>', m.index);
    if (gt < 0) return '';
    if (lower[gt - 1] === '/') { re.lastIndex = gt + 1; continue; }
    const close = lower.indexOf(`</${m[1] || ''}${name}>`, gt);
    return close < 0 ? '' : block.slice(gt + 1, close);
  }
  return '';
}
function attr(openTag, name) {
  const m = openTag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]{0,2000})"|'([^']{0,2000})')`, 'i'));
  return m ? decode(m[1] ?? m[2]) : '';
}

// The entries of an RSS or Atom document, newest first as feeds list them.
function parse(xml) {
  if (typeof xml !== 'string') throw error('這個網址不是 RSS 或 Atom');
  const lower = xml.toLowerCase();
  if (!/<(rss|feed|rdf:rdf)[\s>]/.test(lower)) throw error('這個網址不是 RSS 或 Atom');
  const starts = /<(item|entry)(?=[\s>])/g;
  const first = starts.exec(lower);
  const headEnd = first ? first.index : xml.length;
  const title = plain(tag(xml.slice(0, headEnd), lower.slice(0, headEnd), 'title')).slice(0, 200);
  const items = [];
  for (let m = first; m && items.length < MAX_ITEMS; m = starts.exec(lower)) {
    const close = lower.indexOf(`</${m[1]}>`, m.index);
    if (close < 0) break;
    const block = xml.slice(m.index, close), low = lower.slice(m.index, close);
    starts.lastIndex = close;
    let link = plain(tag(block, low, 'link'));
    if (!link) {
      // Atom: <link rel="alternate" href="..."/>, or the first link with an href.
      let fallback = '';
      for (let at = low.indexOf('<link'); at >= 0 && !link;) {
        const gt = low.indexOf('>', at); if (gt < 0) break;
        const open = block.slice(at, gt + 1), href = attr(open, 'href'), rel = attr(open, 'rel');
        if (href && (!rel || rel === 'alternate')) link = href; else if (href && !fallback) fallback = href;
        at = low.indexOf('<link', gt + 1); // past this tag, or overlapping tags cost quadratic time
      }
      link = link || fallback;
    }
    const itemTitle = plain(tag(block, low, 'title')).slice(0, 300);
    const id = (plain(tag(block, low, 'guid')) || plain(tag(block, low, 'id')) || link || itemTitle).slice(0, 500);
    const date = plain(tag(block, low, 'pubdate') || tag(block, low, 'published') || tag(block, low, 'updated') || tag(block, low, 'date')).slice(0, 60);
    const summary = plain(tag(block, low, 'description') || tag(block, low, 'summary') || tag(block, low, 'encoded') || tag(block, low, 'content')).slice(0, 600);
    if (id) items.push({ id, title: itemTitle, link: /^https?:\/\//i.test(link) ? link.slice(0, 1000) : '', date, summary });
  }
  return { title, items };
}

// One run: what is new since `seen` (the ids handed over before). The first run
// hands over the newest few, so a new subscription shows it works.
async function check(url, seen) {
  const feed = parse(await download(url));
  const known = new Set(seen || []);
  const fresh = seen ? feed.items.filter((i) => !known.has(i.id)).slice(0, MAX_NEW) : feed.items.slice(0, FIRST_RUN);
  const nextSeen = [...new Set([...feed.items.map((i) => i.id), ...(seen || [])])].slice(0, SEEN_KEPT);
  return { title: feed.title, items: fresh, total: feed.items.length, seen: nextSeen };
}

module.exports = { urlOf, parse, check, privateAddress, io, MAX_NEW, FIRST_RUN };
