'use strict';
// A small still for a picture or a video on the conversation's file list: an iPhone drew a
// video's first frame only now and then, drew it again each
// time the list opened, and every row held a whole video or a whole photo in memory. One
// JPEG, 176 px wide, made once with ffmpeg beside the file and kept until the file goes.
// Only a file a message holds; no ffmpeg on the machine means no still, and the list keeps
// the file's icon. The file may be anyone's making, so ffmpeg reads it
// only as a plain video or picture container (a DASH or playlist file named .mp4 would
// otherwise open other files on this computer), files as the only protocol, at most 40
// million pixels a frame, no standard input, a clean environment, 15 seconds, three at a
// time and a short queue. A file it cannot read is remembered as such, so it is not tried
// on every look; one cut off by the time limit or a full queue is tried again later.
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {randomUUID} = require('node:crypto');

const KINDS = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif|tiff?|mp4|m4v|mov|webm)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const WIDTH = 176;
const TIME_LIMIT_MS = 15000;
const AT_ONCE = 3;
const QUEUE_MAX = 120;
// Demuxers for what the list previews; nothing that names other files or addresses. A
// picture is read as its own kind (by name, ffmpeg would pick image2 for a .jpg).
const PICTURE_FORMAT = {png: 'png_pipe', jpg: 'jpeg_pipe', jpeg: 'jpeg_pipe', gif: 'gif', webp: 'webp_pipe', bmp: 'bmp_pipe', tif: 'tiff_pipe', tiff: 'tiff_pipe'};
const FORMATS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,png_pipe,jpeg_pipe,gif,webp_pipe,bmp_pipe,tiff_pipe';

function findFfmpeg(candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
  for (const p of candidates) {try {fs.accessSync(p, fs.constants.X_OK); return p;} catch {}}
  return null;
}

function create({ffmpeg = findFfmpeg(), run = execFile} = {}) {
  const pending = new Map();
  const queue = [];
  let running = 0;
  const next = () => {
    while (running < AT_ONCE && queue.length) {
      const job = queue.shift(); running++;
      job().finally(() => {running--; next();});
    }
  };
  const limited = job => new Promise((resolve, reject) => {
    if (queue.length >= QUEUE_MAX) return resolve('busy');
    queue.push(() => job().then(resolve, reject)); next();
  });
  // 'ok', 'failed', or 'timeout' (killed at the limit: not the file's fault, perhaps).
  const ffmpegOnce = (args) => new Promise(resolve => {
    run(ffmpeg, args, {timeout: TIME_LIMIT_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, env: {PATH: '/usr/bin:/bin'}}, err => resolve(!err ? 'ok' : err.killed === true ? 'timeout' : 'failed'));
  });
  async function make(source, out, video, name) {
    const dir = path.dirname(out), tmp = path.join(dir, '.' + path.basename(out, '.jpg') + '.' + randomUUID() + '.jpg');
    const base = ['-nostdin', '-hide_banner', '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', FORMATS, '-max_pixels', '40000000'];
    const forced = PICTURE_FORMAT[path.extname(String(name)).slice(1).toLowerCase()];
    const tail = [...(forced ? ['-f', forced] : []), '-i', 'file:' + source, '-frames:v', '1', '-vf', `scale=${WIDTH}:-2`, '-q:v', '5', '-f', 'image2', '-y', 'file:' + tmp];
    try {
      // A video's still from a tenth of a second in (a fade from black would give a black one);
      // one shorter than that from its very start.
      const made = () => fs.existsSync(tmp) && fs.statSync(tmp).size > 0;
      let r = await ffmpegOnce(video ? [...base, '-ss', '0.1', ...tail] : [...base, ...tail]);
      if (r !== 'timeout' && !(r === 'ok' && made()) && video) r = await ffmpegOnce([...base, ...tail]);
      if (r === 'ok' && made()) {
        // Deleted for good while this ran: no still is left behind for it.
        if (!fs.existsSync(source)) return 'gone';
        fs.renameSync(tmp, out);
        if (!fs.existsSync(source)) {fs.rmSync(out, {force: true}); return 'gone';}
        return 'ok';
      }
      return r === 'timeout' ? 'timeout' : 'failed';
    } finally {try {fs.rmSync(tmp, {force: true});} catch {}}
  }
  // The still's path, or null when there is none to give.
  async function still({dir, id, name, source}) {
    if (!ffmpeg || !KINDS.test(String(name || '')) || !/^[-a-f0-9]{36}$/.test(String(id))) return null;
    const folder = path.join(dir, 'thumbs'), out = path.join(folder, id + '.jpg'), none = path.join(folder, id + '.none');
    if (fs.existsSync(out)) return out;
    if (fs.existsSync(none)) return null;
    if (pending.has(out)) return pending.get(out);
    const job = limited(async () => {
      // The file's own folder must still be there; it is never made again here.
      if (!fs.existsSync(source) || !fs.existsSync(dir)) return null;
      try {fs.mkdirSync(folder, {mode: 0o700});} catch (e) {if (e.code !== 'EEXIST') return null;}
      const r = await make(source, out, VIDEO.test(name), name);
      if (r === 'ok') return out;
      if (r === 'failed' && fs.existsSync(source)) try {fs.writeFileSync(none, '', {mode: 0o600});} catch {}
      return null;
    }).then(r => r === 'busy' ? null : r).finally(() => pending.delete(out));
    pending.set(out, job);
    return job;
  }
  // A file deleted for good takes its still with it: attachments.removeSent.
  return {still, available: () => !!ffmpeg};
}

module.exports = {create, findFfmpeg, KINDS};
