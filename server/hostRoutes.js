// The Terminal tab's routes (server/hostTerminal.js): an admin's own machines, terminals and
// files. Each change, terminal opened or closed and transfer is audited.
const agents = require('./agentStore');
const {audit} = require('./services/audit');

module.exports = function installHostRoutes(app, {hosts = require('./hostTerminal').shared()} = {}) {
  // Signed in, as the other agent routes are (ccAgentRoutes installAgentRoutes).
  const {verifyToken} = require('./middlewares/authMiddleware');
  app.use('/api/hosts', verifyToken); app.use('/api/hosts-layout', verifyToken); app.use('/api/host-transfers', verifyToken); app.use('/api/host-uploads', verifyToken);
  const admin = (req) => { if (req.role !== 'admin' || !agents.ownerIsActiveAdmin(req.userId)) throw agents.error('Admin only', 403); };
  const note = (req, action, extra = {}) => { try { audit({source: 'terminal-hosts', action, by: req.userId, ...extra}); } catch (e) { console.error('hosts audit:', e.message); } };
  const view = (userId, h, out) => ({id: h.id, kind: h.kind, name: h.name, host: h.host || '', user: h.user || '', port: h.port || null, identityFile: h.identityFile || '', ...(h.from ? {from: h.from} : {}), tabs: hosts.tabs(userId, h.id, out)});
  const still = (req) => () => req.role === 'admin' && agents.ownerIsActiveAdmin(req.userId);
  // A file for the device is opened only by the page itself, never by a link from another site
  // (a top-level navigation carries the session cookie).
  const sameSite = (req) => { const site = req.get('sec-fetch-site'); if (site && site !== 'same-origin' && site !== 'none') throw agents.error('Not allowed', 403); };
  const wrap = (fn) => async (req, res, next) => { try { admin(req); await fn(req, res); } catch (e) { next(e); } };

  app.get('/api/hosts', wrap((req, res) => { const out = hosts.sessions(); res.json({hosts: hosts.list(req.userId).map((h) => view(req.userId, h, out)), layout: hosts.layout(req.userId), hidden: hosts.hidden(req.userId).length}); }));
  app.delete('/api/hosts-layout/hidden', wrap((req, res) => { hosts.restoreHidden(req.userId); note(req, 'host-restore-hidden'); res.json({ok: true}); }));
  app.put('/api/hosts-layout', wrap((req, res) => { const l = hosts.setLayout(req.userId, req.body || {}); note(req, 'host-layout', {groups: l.groups.length}); res.json(l); }));
  app.get('/api/hosts/status', wrap(async (req, res) => {
    const all = hosts.list(req.userId);
    const states = await Promise.all(all.map((h) => hosts.reach(h)));
    res.json({status: Object.fromEntries(all.map((h, i) => [h.id, states[i]]))});
  }));
  app.post('/api/hosts', wrap((req, res) => { const h = hosts.add(req.userId, req.body || {}); note(req, 'host-add', {host: h.id}); res.json(view(req.userId, {...h, kind: 'saved'})); }));
  app.put('/api/hosts/:id', wrap((req, res) => { const h = hosts.update(req.userId, req.params.id, req.body || {}); note(req, 'host-edit', {host: h.id}); res.json(view(req.userId, {...h, kind: 'saved'})); }));
  app.delete('/api/hosts/:id', wrap((req, res) => { hosts.remove(req.userId, req.params.id); note(req, 'host-delete', {host: req.params.id}); res.json({ok: true}); }));

  app.post('/api/hosts/:id/tabs', wrap((req, res) => { const t = hosts.openTab(req.userId, req.params.id, {localAllowed: agents.shellTabsOn()}); note(req, 'host-terminal-open', {host: req.params.id, n: t.n}); res.json(t); }));
  app.delete('/api/hosts/:id/tabs/:n', wrap((req, res) => {
    const n = Number(req.params.n);
    if (!hosts.closeTab(req.userId, req.params.id, n)) throw agents.error('找不到這個終端機', 404);
    note(req, 'host-terminal-close', {host: req.params.id, n}); res.json({ok: true});
  }));

  app.get('/api/hosts/:id/files', wrap(async (req, res) => res.json(await hosts.listFiles(req.userId, req.params.id, typeof req.query.path === 'string' ? req.query.path : ''))));
  app.post('/api/hosts/:id/files', wrap(async (req, res) => {
    const b = req.body || {};
    const r = await hosts.fileOp(req.userId, req.params.id, b);
    note(req, 'host-file-' + String(b.op).slice(0, 10), {host: req.params.id, path: String(b.path || '').slice(0, 300), ...(b.name ? {name: String(b.name).slice(0, 100)} : {}), ...(b.mode ? {mode: String(b.mode).slice(0, 4)} : {})});
    res.json(r);
  }));
  app.post('/api/hosts/:id/transfers', wrap(async (req, res) => {
    const t = await hosts.startTransfer(req.userId, req.params.id, req.body || {}, {allowed: still(req)});
    note(req, 'host-transfer', {host: req.params.id, direction: t.direction, name: (t.name || t.count + ' items').slice(0, 200), to: String(t.to).slice(0, 300)});
    res.json(t);
  }));
  // ---- the admin's own device. A file comes up in parts as a
  // chat's does (attachments.js, under the account's own name, not a conversation's), then goes to
  // the machine; a machine's file comes down to the device.
  const express = require('express');
  const attachments = require('./attachments');
  const shelf = (req) => ({owner: req.userId, id: attachments.HOST_SHELF, archived: false, messages: []});
  const uploadError = (res, e, next) => { if (e && e.status === 409 && e.received !== undefined) return res.status(409).json({message: e.message, received: e.received}); if (e && e.status === 413 && e.maxBytes) return res.status(413).json({message: e.message, maxBytes: e.maxBytes}); next(e); };
  const upWrap = (fn) => async (req, res, next) => { try { admin(req); await fn(req, res); } catch (e) { uploadError(res, e, next); } };
  app.post('/api/host-uploads', upWrap((req, res) => res.status(201).json(attachments.startUpload(agents.stateRoot, shelf(req), req.body?.name, req.body?.size, {max: agents.uploadMaxBytes()}))));
  app.get('/api/host-uploads/:uploadId', upWrap((req, res) => { res.set('Cache-Control', 'private, no-store'); res.json(attachments.uploadStatus(agents.stateRoot, shelf(req), req.params.uploadId)); }));
  const partArriving = (req, res, next) => { try { admin(req); } catch (e) { return next(e); } const done = attachments.partArriving(shelf(req), String(req.params.uploadId)); res.on('close', done); res.on('finish', done); next(); };
  app.put('/api/host-uploads/:uploadId', partArriving, express.raw({type: () => true, limit: attachments.CHUNK_BYTES}), upWrap(async (req, res) => { const r = await attachments.uploadPart(agents.stateRoot, shelf(req), req.params.uploadId, req.query.offset, req.body); res.status(r.done ? 201 : 200).json(r); }));
  app.delete('/api/host-uploads/:uploadId', upWrap((req, res) => { attachments.cancelUpload(agents.stateRoot, shelf(req), req.params.uploadId); res.json({ok: true}); }));
  // A finished one handed to a machine's folder (or this computer's): it leaves the shelf.
  app.post('/api/hosts/:id/receive', wrap(async (req, res) => {
    const b = req.body || {};
    const {meta, path: file} = attachments.location(agents.stateRoot, shelf(req), String(b.attachmentId || ''));
    const r = await hosts.receive(req.userId, req.params.id, {file, name: meta.name, toDir: b.toDir, overwrite: b.overwrite === true, allowed: still(req)});
    attachments.forget(agents.stateRoot, shelf(req), meta.id);
    note(req, 'host-upload-from-device', {host: req.params.id, name: String(meta.name).slice(0, 200), to: String(b.toDir || '').slice(0, 300), size: meta.size});
    res.json(r);
  }));
  // A machine's file to the device: fetched first (POST, a transfer with its progress), then taken once.
  app.post('/api/hosts/:id/fetch', wrap(async (req, res) => {
    const p = String(req.body?.path || '');
    const t = await hosts.fetchFile(req.userId, req.params.id, p, {allowed: still(req)});
    note(req, 'host-download-to-device', {host: req.params.id, path: p.slice(0, 300)});
    res.json(t);
  }));
  // The whole file, then `after(true)`; cut off or failed, `after(false)` and an answer if none went yet.
  const send = (req, res, f, after) => {
    res.set('Cache-Control', 'private, no-store'); res.attachment(f.name);
    if (req.method === 'HEAD') { res.set('Content-Length', String(f.size)); return res.end(); }
    res.sendFile(f.file, {dotfiles: 'allow', headers: {'Content-Length': f.size}}, (err) => {
      try { after?.(!err); } catch {}
      if (err && !res.headersSent) res.status(err.status === 404 || err.code === 'ENOENT' ? 404 : 500).json({message: '找不到這個檔案或資料夾'});
    });
  };
  app.get('/api/host-transfers/:id/file', wrap((req, res) => { sameSite(req); const f = hosts.fetched(req.userId, req.params.id); send(req, res, f, f.done); }));
  app.get('/api/hosts/local/file', wrap((req, res) => { sameSite(req); const f = hosts.localFile(typeof req.query.path === 'string' ? req.query.path : ''); if (req.method !== 'HEAD') note(req, 'host-download-to-device', {host: 'local', path: f.file.slice(0, 300)}); send(req, res, f); }));
  app.get('/api/host-transfers', wrap((req, res) => res.json({transfers: hosts.listTransfers(req.userId)})));
  app.delete('/api/host-transfers/:id', wrap((req, res) => res.json(hosts.cancelTransfer(req.userId, req.params.id))));
};
