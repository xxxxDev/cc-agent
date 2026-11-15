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
// on every look; one cut off by a full queue is tried again later. One cut off by the time
// limit is remembered too and tried again only after an hour, three times at most, so nobody
// can keep the three ffmpegs busy by sending files that take too long.
// It also decodes on one thread with only the video and picture decoders the list needs, and
// hands the still back on its standard output (at most 1 MB, and only a whole JPEG is kept),
// which this server writes itself. On a Mac it runs in the system sandbox (sandbox-exec): no
// network, no other program, no signal to another process, no system service lookups, no
// writing at all, and no reading
// of file contents in the home folders, /Volumes, /private, /Library, /dev, Homebrew's etc and
// var or CC Agent's own data and install folders, except the one file. Without sandbox-exec a Mac makes no stills;
// elsewhere ffmpeg runs without that sandbox.
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
// The decoders a still needs; any other codec in the file (audio, subtitles, data, a
// lesser-used video codec) is never opened.
const DECODERS = 'h264,hevc,vp8,vp9,av1,libdav1d,mpeg4,prores,mjpeg,png,apng,gif,webp,libwebp,bmp,tiff';
const TIMEOUT_RETRY_MS = 60 * 60 * 1000;
const TIMEOUT_TRIES = 3;
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
// A path as the sandbox profile's string: refused when it holds a quote, a backslash or a
// control character (the stills' paths never do: an id and a known folder).
const sbString = p => {if (/["\\\u0000-\u001f\u007f]/.test(p)) throw new Error('unsafe path for the sandbox'); return '"' + p + '"';};
// Read what the system and ffmpeg's libraries need, but no file's contents where people's files,
// settings, logs and keys are, except the one being read; write nothing (a symlink at a
// writable path would make the server hand out another file as the still).
// Also CC Agent's own data and install folders, wherever they are (an install under /opt or /srv
// would otherwise leave its sign-in secret and accounts readable), and the terminals under /dev.
function sandboxProfile({programs, source, deny = []}) {
  const extra = deny.filter(Boolean).map(p => `(subpath ${sbString(p)})`).join(' ');
  return ['(version 1)', '(allow default)', '(deny network*)', '(deny process-exec*)', `(allow process-exec ${programs.map(p => `(literal ${sbString(p)})`).join(' ')})`, '(deny process-fork)', '(deny signal)', '(allow signal (target self))', '(deny mach-lookup)',
    `(deny file-read-data (subpath "/Users") (subpath "/Volumes") (subpath "/private") (subpath "/Library") (subpath "/opt/homebrew/etc") (subpath "/opt/homebrew/var") (subpath "/usr/local/etc") (subpath "/usr/local/var") (subpath "/var/root") (subpath "/dev")${extra ? ' ' + extra : ''})`,
    '(allow file-read-data (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))',
    `(allow file-read-data (literal ${sbString(source)}))`, '(deny file-write*)'].join('\n');
}
const JPEG = buf => Buffer.isBuffer(buf) && buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
const STILL_MAX_BYTES = 1024 * 1024;

function findFfmpeg(candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
  for (const p of candidates) {try {fs.accessSync(p, fs.constants.X_OK); return p;} catch {}}
  return null;
}

function create({ffmpeg = findFfmpeg(), run = execFile, sandbox = process.platform === 'darwin', sandboxExec = SANDBOX_EXEC, now = Date.now, denyRead = []} = {}) {
  // The folders to keep from ffmpeg besides the fixed ones, as they really are on disk.
  const denied = () => denyRead.filter(Boolean).flatMap(p => {try {return [fs.realpathSync(p)];} catch {return [];}});
  // A Mac without its sandbox makes no stills rather than run ffmpeg unconfined.
  const sandboxMissing = () => sandbox && !fs.existsSync(sandboxExec);
  let said = '';
  const sayOnce = (why) => {if (said !== why) {said = why; console.error('file list stills: ' + why);}};
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
  // {r: 'ok', still} with a whole JPEG, or r: 'failed' (the file's fault), 'timeout' (killed at the
  // limit) or 'error' (this computer's: no ffmpeg or sandbox, a profile refused; never remembered
  // against the file).
  const ffmpegOnce = (args, source) => new Promise(resolve => {
    // Resolved each time: a brew upgrade replaces the versioned file the link points to.
    let real;
    try {real = fs.realpathSync(ffmpeg);} catch {sayOnce('ffmpeg is not at ' + ffmpeg); return resolve({r: 'error'});}
    let file = real, argv = args;
    if (sandbox) {
      if (sandboxMissing()) {sayOnce('no ' + sandboxExec + ', so no stills'); return resolve({r: 'error'});}
      try {file = sandboxExec; argv = ['-p', sandboxProfile({programs: [...new Set([ffmpeg, real])], source: fs.realpathSync(source), deny: denied()}), real, ...args];}
      catch (e) {sayOnce('sandbox profile: ' + e.message); return resolve({r: 'error'});}
    }
    run(file, argv, {timeout: TIME_LIMIT_MS, killSignal: 'SIGKILL', maxBuffer: STILL_MAX_BYTES, encoding: 'buffer', env: {PATH: '/usr/bin:/bin'}}, (err, stdout, stderr) => {
      if (!err) return resolve(JPEG(stdout) ? {r: 'ok', still: stdout} : {r: 'failed'});
      if (err.killed === true && err.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({r: 'timeout'});
      // sandbox-exec's own refusal: its exit code 65 and its name first (not a line ffmpeg printed).
      if (err.code === 'ENOENT' || err.code === 'EACCES' || (err.code === 65 && /^sandbox-exec:/.test(String(stderr || '')))) {sayOnce(String(stderr || err.message).trim().slice(0, 200)); return resolve({r: 'error'});}
      resolve({r: 'failed'});
    });
  });
  async function make(source, out, video, name) {
    const dir = path.dirname(out), tmp = path.join(dir, '.' + path.basename(out, '.jpg') + '.' + randomUUID() + '.jpg');
    const base = ['-nostdin', '-hide_banner', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file', '-format_whitelist', FORMATS, '-codec_whitelist', DECODERS, '-max_pixels', '40000000'];
    const forced = PICTURE_FORMAT[path.extname(String(name)).slice(1).toLowerCase()];
    const tail = [...(forced ? ['-f', forced] : []), '-i', 'file:' + source, '-an', '-sn', '-dn', '-frames:v', '1', '-vf', `scale=${WIDTH}:-2`, '-q:v', '5', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'];
    try {
      // A video's still from a tenth of a second in (a fade from black would give a black one);
      // one shorter than that from its very start.
      let got = await ffmpegOnce(video ? [...base, '-ss', '0.1', ...tail] : [...base, ...tail], source);
      if (got.r === 'failed' && video) got = await ffmpegOnce([...base, ...tail], source);
      if (got.r !== 'ok') return got.r;
      // Deleted for good while this ran: no still is left behind for it.
      if (!fs.existsSync(source)) return 'gone';
      // Written here, a new file of its own (never through a link), then put in place.
      fs.writeFileSync(tmp, got.still, {flag: 'wx', mode: 0o600});
      fs.renameSync(tmp, out);
      if (!fs.existsSync(source)) {fs.rmSync(out, {force: true}); return 'gone';}
      return 'ok';
    } finally {try {fs.rmSync(tmp, {force: true});} catch {}}
  }
  // The still's path, or null when there is none to give.
  // dir: the conversation's attachments folder, which must still be there; folder: where its
  // stills go, outside that folder (attachments.thumbsDirectory).
  async function still({dir, folder, id, name, source}) {
    if (!ffmpeg || !folder || !KINDS.test(String(name || '')) || !/^[-a-f0-9]{36}$/.test(String(id))) return null;
    const out = path.join(folder, id + '.jpg'), none = path.join(folder, id + '.none'), slow = path.join(folder, id + '.timeout');
    // Only a plain file of its own is handed out; anything else there (a link left by an ffmpeg
    // from before the stills were written here) is removed and the still made again.
    try {const st = fs.lstatSync(out); if (st.isFile() && st.nlink === 1) return out; fs.rmSync(out, {force: true});} catch {}
    if (fs.existsSync(none)) return null;
    // Cut off by the time limit before: not again within the hour, and not after three tries.
    const timedOut = () => {try {const t = JSON.parse(fs.readFileSync(slow, 'utf8')); return {n: Number(t.n) || 0, at: Number(t.at) || 0};} catch {return null;}};
    {const t = timedOut(); if (t && (t.n >= TIMEOUT_TRIES || now() - t.at < TIMEOUT_RETRY_MS)) return null;}
    if (pending.has(out)) return pending.get(out);
    const job = limited(async () => {
      // The file's own folder must still be there; it is never made again here.
      if (!fs.existsSync(source) || !fs.existsSync(dir)) return null;
      try {fs.mkdirSync(folder, {recursive: true, mode: 0o700});} catch {return null;}
      const r = await make(source, out, VIDEO.test(name), name);
      if (r === 'ok') {try {fs.rmSync(slow, {force: true});} catch {} return out;}
      if (r === 'failed' && fs.existsSync(source)) try {fs.writeFileSync(none, '', {mode: 0o600});} catch {}
      if (r === 'timeout' && fs.existsSync(source)) try {fs.writeFileSync(slow, JSON.stringify({n: (timedOut()?.n || 0) + 1, at: now()}), {mode: 0o600});} catch {}
      return null;
    }).then(r => r === 'busy' ? null : r).finally(() => pending.delete(out));
    pending.set(out, job);
    return job;
  }
  // A file deleted for good takes its still with it: attachments.removeSent.
  return {still, available: () => !!ffmpeg && !sandboxMissing()};
}

module.exports = {create, findFfmpeg, sandboxProfile, KINDS, TIMEOUT_TRIES, TIMEOUT_RETRY_MS, STILL_MAX_BYTES};
