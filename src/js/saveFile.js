// On an iPhone or iPad home-screen app a download opens the file full screen with no
// way back to the app. There the file goes to the share sheet instead, which opens
// over the app: Save Image, Save to Files and the rest.
// Everywhere else a download stays a download.
const TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
  zip: 'application/zip', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export const typeOf = name => TYPES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';

export function sharesFiles(scope = globalThis) {
  const nav = scope.navigator;
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  const installed = !!(scope.matchMedia?.('(display-mode: standalone)')?.matches || nav.standalone === true);
  const apple = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (/Macintosh/.test(nav.userAgent || '') && nav.maxTouchPoints > 1);
  return installed && apple;
}

function download(url, name, scope) {
  // Marked external, or Framework7 takes the click for a page of its own.
  const a = scope.document.createElement('a');
  a.className = 'external'; a.href = url; a.download = name; a.rel = 'noopener';
  scope.document.body.appendChild(a); a.click(); a.remove();
}

// The file's bytes, telling onProgress(got, total) as they come, so a large video fetched over a
// slow connection does not show nothing for a long while. total is the size the
// server gave, else the one the caller knows, else 0.
export async function fetchBlob(url, {scope = globalThis, signal, onProgress, size = 0} = {}) {
  const res = await scope.fetch(url, {credentials: 'same-origin', ...(signal ? {signal} : {})});
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const reader = onProgress && res.body?.getReader?.();
  if (!reader) return res.blob();
  const total = Number(res.headers?.get?.('content-length')) || size || 0, parts = [];
  let got = 0;
  onProgress(0, total);
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    onProgress(got, total);
  }
  return new scope.Blob(parts, {type: res.headers?.get?.('content-type') || ''});
}

// confirm(run) shows one button that calls run(): the file is fetched first, and by
// then the tap that asked for it may be too old for the share sheet, so a second tap
// opens it. A file already here (blob: the preview fetched it to show it) goes to the
// share sheet at once, inside the tap, instead of taking several taps that each fetched it
// again. onFetched() runs when the bytes are here.
export async function saveFile(url, name, {scope = globalThis, confirm, blob, onProgress, onFetched, size} = {}) {
  if (!sharesFiles(scope)) return download(url, name, scope);
  let file;
  try {
    file = new scope.File([blob || await fetchBlob(url, {scope, onProgress, size})], name, {type: typeOf(name)});
  } catch { onFetched?.(); return download(url, name, scope); }
  onFetched?.();
  if (!scope.navigator.canShare({files: [file]})) return download(url, name, scope);
  const share = () => scope.navigator.share({files: [file]}).catch(() => {});
  try { await scope.navigator.share({files: [file]}); }
  catch (e) { if (e?.name === 'NotAllowedError' && confirm) confirm(share); }
}
