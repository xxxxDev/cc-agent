const crypto = require('node:crypto');
const webPush = require('web-push');
const { assertPushConfigured, selectVapidDetails } = require('./pushCrypto');
const { getDefaultPushStore } = require('./pushStore');
const { PRODUCT } = require('../siteConfig');
const MarkdownIt = require('markdown-it');
const previewMarkdown = new MarkdownIt({html:false});

function clipPreview(text,limit){if(text.length<=limit)return text;let out='';for(const char of text){if(out.length+char.length>limit-1)break;out+=char;}return out+'…';}
function notificationPreview(text,limit=180){
  const inline=tokens=>tokens.map(t=>t.children?inline(t.children):['text','code_inline','image'].includes(t.type)?t.content:['softbreak','hardbreak'].includes(t.type)?' ':'').join('');
  const plain=previewMarkdown.parse(String(text||''),{}).map(t=>t.type==='inline'?inline(t.children||[]):['fence','code_block'].includes(t.type)?t.content:'').filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  return clipPreview(plain,limit);
}

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

const tagOf=(prefix,id)=>prefix+crypto.createHash('sha256').update(id).digest('hex').slice(0,24);
// A scope report tells an admin which agent was stopped and by what, never the
// tool's arguments: those are the agent's raw material, like its transcript.
const REPORT_KINDS={permission:'要求權限',blocked:'被沙盒擋下'};
// A digest: an agent said, again and again, that it solved a refusal itself.
const digestBody=n=>'24 小時內 '+(Number.isInteger(n)&&n>0?n:'多')+' 次說已在範圍內自行解決，點開查看';
function buildPayload(reply) {
  if(reply?.kind==='access_report'){
    if(!reply.reportId||!reply.replyId)throw new Error('Unsupported notification');
    return {title:clipPreview('範圍報告單 · '+String(reply.agentName||'Agent'),80),body:clipPreview(reply.reportKind==='digest'?digestBody(reply.count):(REPORT_KINDS[reply.reportKind]||'被擋下')+'：'+(String(reply.tool||'')||'未知工具')+'，點開審查',180),url:'/?access-report='+encodeURIComponent(reply.reportId),tag:tagOf('report-',reply.reportId)};
  }
  if(reply?.kind==='diagnostic_report'){
    if(!reply.reportId||!reply.replyId)throw new Error('Unsupported notification');
    return {title:clipPreview('診斷回報 · '+String(reply.agentName||'Agent'),80),body:'有人送來診斷資訊，點開查看',url:'/?diagnostic-report='+encodeURIComponent(reply.reportId),tag:tagOf('diagnostic-',reply.reportId)};
  }
  if(reply?.kind==='schedule_result'){
    if(!reply.scheduleId||!reply.replyId)throw new Error('Unsupported notification');
    // Always marked as a schedule's, so a script cannot dress up as a system notice.
    return {title:clipPreview('排程 · '+String(reply.title||''),80),body:clipPreview(String(reply.body||'')||'有新結果',180),url:'/?schedule='+encodeURIComponent(reply.scheduleId),tag:tagOf('schedule-result-',reply.replyId)};
  }
  if(reply?.kind==='schedule_failed'){
    if(!reply.scheduleId||!reply.replyId)throw new Error('Unsupported notification');
    return {title:clipPreview('排程失敗 · '+String(reply.agentName||'Agent'),80),body:clipPreview('「'+String(reply.scheduleName||'')+'」連續失敗：'+(String(reply.detail||'')||'原因不明'),180),url:'/?schedule='+encodeURIComponent(reply.scheduleId),tag:tagOf('schedule-failed-',reply.scheduleId)};
  }
  if(reply?.kind==='schedule_proposal'){
    if(!reply.scheduleId||!reply.replyId)throw new Error('Unsupported notification');
    return {title:clipPreview('排程提議 · '+String(reply.agentName||'Agent'),80),body:clipPreview('「'+String(reply.scheduleName||'')+'」，點開核准',180),url:'/?schedule='+encodeURIComponent(reply.scheduleId),tag:tagOf('schedule-',reply.scheduleId)};
  }
  if(!reply?.conversationId||!reply?.replyId)throw new Error('Unsupported notification');
  // A reply in a group chat opens the group.
  if(reply.groupId)return {title:clipPreview(String(reply.agentName||'群組'),80),body:notificationPreview(reply.replyText)||'新的回覆',url:'/?group='+encodeURIComponent(reply.groupId),tag:tagOf('reply-',reply.replyId)};
  return {title:clipPreview(String(reply.agentName||PRODUCT.name),80),body:notificationPreview(reply.replyText)||'新的回覆',url:'/?conversation='+encodeURIComponent(reply.conversationId),tag:tagOf('reply-',reply.replyId)};
}

// Per-row VAPID selection: the keypair is chosen from the row's
// stored vapidKeyId (defaulting to 'k0') on every send, rather than a single
// process-global setVapidDetails. selectVapidDetails throws
// PUSH_VAPID_KEY_UNAVAILABLE, before any network call, for a row whose keyId
// matches neither the current nor the previous VAPID key, so a device is never
// messaged with the wrong key; sendOne maps that to a suppression, not a send.
function createWebPushSender(env = process.env) {
  return async (subscription, payload, _delivery = null, vapidKeyId = 'k0') => {
    assertPushConfigured(env);
    const vapid = selectVapidDetails(vapidKeyId, env);
    return webPush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 24 * 60 * 60,
      urgency: 'high',
      topic: payload.tag.slice(0, 32),
      vapidDetails: {
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    });
  };
}

function createPushService({
  store,
  sender = createWebPushSender(),
  logger = console,
  now = () => new Date(),
  autoDrain = true,
  // Deny by default: admin_report rows send only through a wired gate that finds
  // the recipient still an active admin.
  reportGate = async () => ({ ok: false, reason: 'report_gate_unconfigured' }),
} = {}) {
  if (!store) throw new Error('push store is required');
  let draining = null;
  let timer = null;

  // Enqueue this reply's webpush deliveries for one recipient's active devices.
  // Owner rows pass recipientReason 'owner'; scope-report rows pass 'admin_report'.
  // Preference gating is per-recipient (an admin's own preferences govern the
  // reports sent to them). Enqueue-time checks are an optimization; send-time re-checks
  // (sendOne) are authoritative.
  async function enqueueForRecipient(reply, recipientUserId, recipientReason) {
    const [subscriptions, preferences] = await Promise.all([
      store.listActiveSubscriptions(recipientUserId),
      store.getPreferences(recipientUserId),
    ]);
    const payload = buildPayload(reply);
    let pending = 0;
    let suppressed = 0;
    // One device that cannot be written must not cost the others this notification:
    // each is tried, and the first failure is thrown once all have been, so the
    // caller still sees a failed fan-out and may send it again (every row is found
    // again by its stable key).
    let failed = null;
    for (const subscription of subscriptions) {
      try {
        const sessionActive = await store.isSessionActive(subscription);
        const preferenceEnabled = preferences.reply === true;
        const enabled = sessionActive && preferenceEnabled;
        if (!sessionActive) {
          await store.deactivateByFingerprint(subscription.endpointFingerprint, 'session_inactive');
        }
        const projection = await store.ensureDelivery({
          reply,
          subscription,
          payload,
          recipientUserId: String(recipientUserId),
          recipientReason,
          status: enabled ? 'pending' : 'suppressed',
          suppressionReason: sessionActive ? 'preference_disabled' : 'session_inactive',
        });
        if (projection.created) {
          if (enabled) pending += 1;
          else suppressed += 1;
        }
      } catch (error) {
        failed ||= error;
        logger.error?.(`push: a device's delivery was not queued: ${error.message}`);
      }
    }
    if (failed) {
      if (autoDrain && pending) queueMicrotask(() => void drain());
      throw failed;
    }
    return { pending, suppressed };
  }

  async function notifyAgentReply(reply) {
    if (!reply || !reply.ownerUserId) {
      return { deliveries: 0, pending: 0, suppressed: 0 };
    }
    const { pending, suppressed } = await enqueueForRecipient(
      reply, String(reply.ownerUserId), 'owner',
    );
    if (autoDrain && pending) queueMicrotask(() => void drain());
    return { deliveries: pending + suppressed, pending, suppressed };
  }

  // A new scope report, to every admin's devices: reviewing them is the admin's job.
  async function notifyAccessReport(report, adminUserIds = []) {
    let pending = 0;
    let suppressed = 0;
    // One admin whose device cannot be written does not cost the admins after them
    // the report: each is tried, the first failure thrown once all have been.
    let failed = null;
    for (const adminUserId of adminUserIds) {
      try {
        const counts = await enqueueForRecipient(report, String(adminUserId), 'admin_report');
        pending += counts.pending;
        suppressed += counts.suppressed;
      } catch (error) { failed ||= error; }
    }
    if (autoDrain && (pending || failed)) queueMicrotask(() => void drain());
    if (failed) throw failed;
    return { deliveries: pending + suppressed, pending, suppressed };
  }

  async function suppress(delivery, reason) {
    await store.updateDelivery(delivery.deliveryId, {
      status: 'suppressed',
      suppressionReason: reason,
      nextAttemptAt: null,
      claimedAt: null,
    });
  }

  async function sendOne(candidate) {
    const delivery = await store.claimDelivery(candidate.deliveryId);
    if (!delivery) return;
    const subscription = await store.getSubscription(delivery.endpointFingerprint);
    if (!subscription || !subscription.active) {
      await suppress(delivery, 'subscription_inactive');
      return;
    }
    // A browser endpoint may be explicitly re-bound when another account
    // enables notifications on the same device. A queued delivery keeps its
    // original recipient, so every initial send and retry must fail closed if
    // the endpoint now belongs to someone else.
    const recipientUserId = delivery.recipientUserId || delivery.userId;
    if (
      !recipientUserId
      || !subscription.userId
      || String(subscription.userId) !== String(recipientUserId)
    ) {
      await suppress(delivery, 'subscription_recipient_mismatch');
      return;
    }
    if (!(await store.isSessionActive(subscription))) {
      await store.deactivateByFingerprint(subscription.endpointFingerprint, 'session_inactive');
      await suppress(delivery, 'session_inactive');
      return;
    }
    // A row without recipientUserId/recipientReason is an owner
    // delivery whose recipient is delivery.userId (the owner).
    const recipientReason = delivery.recipientReason || 'owner';
    const preferences = await store.getPreferences(recipientUserId);
    if (preferences[delivery.category] !== true) {
      await suppress(delivery, 'preference_disabled');
      return;
    }
    // admin_report rows are re-verified against live state at send/retry time:
    // recipient exists, lifecycle-active, still admin. Any failure ⇒ suppressed
    // (with a reason), never failed.
    if (recipientReason === 'admin_report') {
      const gate = await reportGate(recipientUserId);
      if (!gate.ok) {
        await suppress(delivery, gate.reason || 'report_suppressed');
        return;
      }
    }
    // The checks above await mutable session/preferences/role state. Re-read the
    // endpoint binding after the final await and call the provider without another
    // yield in between, so an account rebind during those gates fails closed.
    const currentSubscription = await store.getSubscription(delivery.endpointFingerprint);
    if (!currentSubscription || !currentSubscription.active) {
      await suppress(delivery, 'subscription_inactive');
      return;
    }
    if (
      !currentSubscription.userId
      || String(currentSubscription.userId) !== String(recipientUserId)
    ) {
      await suppress(delivery, 'subscription_recipient_mismatch');
      return;
    }
    try {
      const response = await sender(
        store.readSubscription(currentSubscription), delivery.payload, delivery,
        currentSubscription.vapidKeyId || 'k0',
      );
      await store.updateDelivery(delivery.deliveryId, {
        status: 'sent',
        attempts: delivery.attempts + 1,
        sentAt: now().toISOString(),
        nextAttemptAt: null,
        claimedAt: null,
        lastErrorCode: null,
        providerStatusCode: Number(response?.statusCode || 201),
      });
    } catch (error) {
      // The device's VAPID key is gone (neither current nor previous matches):
      // fail closed as a suppression, never a `failed` send and never a retry:
      // retrying cannot conjure the key, and it must never be sent with another.
      if (error?.code === 'PUSH_VAPID_KEY_UNAVAILABLE') {
        await suppress(delivery, 'vapid_key_unavailable');
        return;
      }
      const statusCode = Number(error?.statusCode || 0);
      const attempts = delivery.attempts + 1;
      if (statusCode === 404 || statusCode === 410) {
        await store.deactivateByFingerprint(currentSubscription.endpointFingerprint, 'push_endpoint_gone');
        await store.updateDelivery(delivery.deliveryId, {
          status: 'gone', attempts, nextAttemptAt: null, claimedAt: null,
          lastErrorCode: `push_${statusCode}`,
        });
        return;
      }
      if (attempts >= MAX_ATTEMPTS) {
        await store.updateDelivery(delivery.deliveryId, {
          status: 'failed', attempts, nextAttemptAt: null, claimedAt: null,
          lastErrorCode: statusCode ? `push_${statusCode}` : 'push_send_failed',
        });
        return;
      }
      const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
      await store.updateDelivery(delivery.deliveryId, {
        status: 'pending', attempts, claimedAt: null,
        nextAttemptAt: new Date(now().getTime() + delay).toISOString(),
        lastErrorCode: statusCode ? `push_${statusCode}` : 'push_send_failed',
      });
    }
  }

  // Admin-triggered plumbing check: broadcasts to every active device of the
  // caller's own account (a test must behave like a
  // real reply would), while still bypassing the agent reply pipeline and
  // its delivery ledger on purpose: a test must never look like an agent
  // reply. Dead sessions are deactivated and skipped, not fatal, so one
  // stale device cannot hide the healthy ones.
  async function sendTest({ userId }) {
    const subscriptions = await store.listActiveSubscriptions(userId);
    // Click target is the app itself: the worker allow-list accepts it, and a
    // made-up detail id would open an "unavailable" page.
    const payload = {
      title: `${PRODUCT.name}：測試通知`,
      body: '通知管道運作正常',
      url: '/',
      tag: `push-test-${crypto.randomUUID()}`,
    };
    let sentCount = 0;
    let skipped = 0;
    for (const subscription of subscriptions) {
      if (!(await store.isSessionActive(subscription))) {
        await store.deactivateByFingerprint(subscription.endpointFingerprint, 'session_inactive');
        skipped += 1;
        continue;
      }
      try {
        await sender(store.readSubscription(subscription), payload, null, subscription.vapidKeyId || 'k0');
        sentCount += 1;
      } catch (error) {
        // A device on a retired VAPID key (PUSH_VAPID_KEY_UNAVAILABLE) is
        // skipped like a dead session, never sent with the wrong key.
        const statusCode = Number(error?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await store.deactivateByFingerprint(subscription.endpointFingerprint, 'push_endpoint_gone');
        }
        skipped += 1;
      }
    }
    if (!sentCount) {
      const error = new Error('No active push subscription for this account');
      error.code = 'PUSH_TEST_NO_DEVICE';
      error.status = 404;
      throw error;
    }
    return { sent: sentCount, skipped };
  }

  async function drain() {
    if (draining) return draining;
    draining = (async () => {
      const staleBefore = new Date(now().getTime() - 5 * 60_000).toISOString();
      await store.recoverStaleSending(staleBefore);
      const due = await store.listDue(now().toISOString());
      for (const delivery of due) await sendOne(delivery);
      return due.length;
    })().catch((error) => {
      logger.error(`[push] delivery drain failed: ${error.message}`);
      return 0;
    }).finally(() => {
      draining = null;
    });
    return draining;
  }

  function start() {
    void drain();
    timer = setInterval(() => void drain(), 60_000);
    timer.unref();
    return stop;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { notifyAgentReply, notifyAccessReport, enqueueForRecipient, sendTest, drain, start, stop };
}

// Who may receive scope-report notifications, checked again at every send.
function createReportGate(usersDB) {
  const { isActiveUser } = require('./userLifecycle');
  return (recipientUserId) => new Promise((resolve) => {
    usersDB.findOne({ _id: String(recipientUserId) }, (error, user) => {
      if (error || !user || !isActiveUser(user)) resolve({ ok: false, reason: 'recipient_inactive' });
      else if (user.role !== 'admin') resolve({ ok: false, reason: 'recipient_not_admin' });
      else resolve({ ok: true });
    });
  });
}

let defaultService = null;
function getDefaultPushService() {
  if (!defaultService) {
    defaultService = createPushService({
      store: getDefaultPushStore(),
      reportGate: createReportGate(require('../stores').usersDB),
    });
  }
  return defaultService;
}

module.exports = {
  MAX_ATTEMPTS,
  buildPayload,
  createWebPushSender,
  createPushService,
  createReportGate,
  getDefaultPushService,
};
