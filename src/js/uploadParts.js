// A file sent in parts: one request through a proxy such as Cloudflare carries at
// most 100 MB, so a larger file goes up in parts the server writes one after another and makes
// into a single attachment (server/attachments.js startUpload). The page shows one file and one
// progress bar; nobody sees the parts. A part whose answer was lost is not sent twice: the server
// says where it got to, and the next part starts there.
import {api, apiUpload} from './api.js';

// A phone that loses its signal for half a minute, or a server asking to slow down (429), goes on afterwards
// rather than giving up.
const TRIES = 6, SLOW_TRIES = 10;
const pause = ms => new Promise(ok => setTimeout(ok, ms));
// A dropped connection or a server that did not answer, worth trying again; a refusal is not.
const passing = e => !e?.status || e.status >= 500 && e.status !== 507;
// Parts small enough that a phone losing its signal sends one part again, not the whole file (a
// 24 MB recording over a mobile network went as one request and failed); larger for a large file,
// so it stays within the site's 60 changes in five minutes.
const MB = 1024 * 1024, SMALL_PART = 8 * MB, MOST_PARTS = 40;
export const partBytes = (size, most) => Math.min(most, Math.max(SMALL_PART, Math.ceil(size / MOST_PARTS / MB) * MB));

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1) + ' GB';
  if (n >= 1024 * 1024) return Math.round(n / 1024 / 1024) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

// onProgress(fraction) as the bytes go; resolves with the attachment ({id, name, size}).
export async function uploadInParts(conversationId, file, name, {onProgress} = {}) {
  const base = '/conversations/' + conversationId + '/uploads';
  const start = await api(base, {method: 'POST', body: JSON.stringify({name, size: file.size})});
  const id = start.uploadId, size = file.size, step = partBytes(size, start.chunkBytes);
  let at = start.received || 0, tries = 0, slowed = 0;
  try {
    while (true) {
      if (at >= size) {
        // Every byte is there and no answer said done: the last one was lost. The server says what became of it.
        const s = await api(base + '/' + id);
        if (s.done) { onProgress?.(1); return {id: s.id, name: s.name, size: s.size}; }
        throw new Error('Upload did not finish');
      }
      const end = Math.min(size, at + step);
      try {
        const r = await apiUpload(base + '/' + id + '?offset=' + at, file.slice(at, end), {
          method: 'PUT', headers: {'Content-Type': 'application/octet-stream'},
          onProgress: f => onProgress?.((at + f * (end - at)) / size),
        });
        tries = 0;
        if (r.done) { onProgress?.(1); return {id: r.id, name: r.name, size: r.size}; }
        at = r.received;
      } catch (e) {
        if (e?.status === 409 && Number.isSafeInteger(e.data?.received)) { at = e.data.received; continue; }
        if (e?.status === 429 && ++slowed < SLOW_TRIES) { await pause(Math.min(300, e.retryAfter || 30) * 1000); continue; }
        if (!passing(e) || ++tries >= TRIES) throw e;
        await pause(Math.min(16, 2 ** (tries - 1)) * 1000);
        // Where the server got to: the part may have arrived even though its answer did not.
        try { const s = await api(base + '/' + id); if (s.done) { onProgress?.(1); return {id: s.id, name: s.name, size: s.size}; } at = s.received; } catch (s) { if (s?.status === 404) throw e; }
      }
      onProgress?.(at / size);
    }
  } catch (e) {
    api(base + '/' + id, {method: 'DELETE'}).catch(() => {});
    throw e;
  }
}
