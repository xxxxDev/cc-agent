const { getPushConfig, assertPushConfigured, validateDeviceId } = require('../services/pushCrypto');
const { getDefaultPushStore } = require('../services/pushStore');
const { getDefaultPushService } = require('../services/pushService');
const { requireTrustedPrincipal } = require('../services/trustedPrincipal');

let storeOverride = null;
const store = () => storeOverride || getDefaultPushStore();
let serviceOverride = null;
const service = () => serviceOverride || getDefaultPushService();

function publicConfig() {
  const config = getPushConfig();
  return {
    available: config.available,
    publicKey: config.available ? config.publicKey : null,
    // Current VAPID key id. The client compares its live
    // applicationServerKey against publicKey; keyId lets it name which key it is
    // on. Legacy (no rotation env) returns 'k0'.
    keyId: config.available ? config.keyId : null,
  };
}

function handleError(res, error) {
  const status = Number(error?.status || 500);
  const safe = status >= 400 && status < 500;
  return res.status(status).json({
    code: error?.code || 'PUSH_FAILED',
    message: safe ? error.message : 'Push operation failed',
  });
}

exports.getConfig = (req, res) => {
  requireTrustedPrincipal(req);
  res.json(publicConfig());
};

exports.getStatus = async (req, res) => {
  try {
    const principal = requireTrustedPrincipal(req);
    const deviceId = validateDeviceId(req.query?.deviceId);
    res.json({ ...publicConfig(), ...(await store().getStatus(principal.id, deviceId)) });
  } catch (error) {
    handleError(res, error);
  }
};

exports.subscribe = async (req, res) => {
  try {
    const principal = requireTrustedPrincipal(req);
    assertPushConfigured();
    const deviceId = validateDeviceId(req.body?.deviceId);
    await store().upsertSubscription({
      userId: principal.id,
      sessionToken: req.sessionToken,
      deviceId,
      subscription: req.body?.subscription,
      userAgent: null,
    });
    // Whose binding was written: the page compares it with who is signed in now, to
    // take back only its own.
    res.status(201).json({ ...(await store().getStatus(principal.id, deviceId)), boundTo: principal.id });
  } catch (error) {
    handleError(res, error);
  }
};

exports.unsubscribe = async (req, res) => {
  try {
    const principal = requireTrustedPrincipal(req);
    const deviceId = validateDeviceId(req.body?.deviceId);
    await store().deactivateSubscription({
      userId: principal.id,
      deviceId,
      endpoint: req.body?.endpoint,
    });
    res.json(await store().getStatus(principal.id, deviceId));
  } catch (error) {
    handleError(res, error);
  }
};

exports.updatePreferences = async (req, res) => {
  try {
    const principal = requireTrustedPrincipal(req);
    const preferences = await store().setPreferences(principal.id, req.body?.preferences);
    res.json({ preferences });
  } catch (error) {
    handleError(res, error);
  }
};

exports.sendTest = async (req, res) => {
  try {
    const principal = requireTrustedPrincipal(req);
    assertPushConfigured();
    // Broadcasts to every active device of the caller's own account; the
    // client still posts its deviceId but the test is account-wide by design.
    res.json(await service().sendTest({ userId: principal.id }));
  } catch (error) {
    handleError(res, error);
  }
};

// Another subscription store or sender in place of the defaults, for a product built on
// this code that keeps or delivers push its own way; null brings the default back.
exports.setPushStore = (value = null) => {
  storeOverride = value;
};

exports.setPushService = (value = null) => {
  serviceOverride = value;
};
