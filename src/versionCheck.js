// Polls the build id the server is currently serving and reports when it differs
// from the build id compiled into this bundle. The service worker updates itself
// silently; this is the part that lets the app tell the user a new version exists
// and let them decide when to take it.
//
// A build id comes from git describe, a BUILD_ID setting or 'nogit' (build/buildId.js), so
// it carries no reliable ordering. We can only detect "different", never "newer". That is the intended
// behaviour: after a rollback the served build is still the one to be on.
export const VERSION_ENDPOINT = '/version.json';
export const VERSION_CHECK_INTERVAL_MS = 30 * 60 * 1000;
// forceAppUpdate reloads with this query parameter, which is how the freshly
// loaded app knows it is here because the user just asked to update.
export const UPDATE_ATTEMPT_PARAM = 'force_update';

export function hasNewVersion(currentBuildId, latestBuildId) {
  if (!currentBuildId || !latestBuildId) return false;
  return currentBuildId !== latestBuildId;
}

export function wasUpdateAttempted(scope = globalThis) {
  const search = scope?.location?.search;
  if (typeof search !== 'string' || !search) return false;
  return new URLSearchParams(search).has(UPDATE_ATTEMPT_PARAM);
}

// Reading the marker has to consume it. It answers exactly one question (did
// this load come from an update the user just asked for?), but forceAppUpdate
// leaves it in the URL and nothing else removes it. Without this, a device that
// once used Force Update has every later deploy announced as a failed update
// instead of an offer, and the user is told to clear site data for an update
// they were never offered (seen in browser tabs left open
// across a deploy).
export function clearUpdateAttempt(scope = globalThis) {
  const search = scope?.location?.search;
  if (typeof search !== 'string' || !search) return false;
  const params = new URLSearchParams(search);
  if (!params.has(UPDATE_ATTEMPT_PARAM)) return false;
  // Somewhere that cannot rewrite its own URL keeps the marker rather than
  // losing the check entirely: occasionally wrong wording beats a crash on start.
  if (typeof scope?.history?.replaceState !== 'function') return false;
  params.delete(UPDATE_ATTEMPT_PARAM);
  const query = params.toString();
  const { pathname = '', hash = '' } = scope.location;
  scope.history.replaceState(
    scope.history.state ?? null,
    '',
    `${pathname}${query ? `?${query}` : ''}${hash}`,
  );
  return true;
}

export async function fetchLatestBuildId({
  fetchImpl,
  endpoint = VERSION_ENDPOINT,
  cacheBuster = Math.random(),
} = {}) {
  if (typeof fetchImpl !== 'function') return null;
  try {
    // The endpoint must never be answered from the precache, or the app would
    // keep comparing itself against its own stale copy.
    const response = await fetchImpl(`${endpoint}?v=${cacheBuster}`, { cache: 'no-store' });
    if (!response?.ok) return null;
    const body = await response.json();
    return typeof body?.buildId === 'string' && body.buildId ? body.buildId : null;
  } catch (error) {
    // Offline or a transient failure: stay silent and retry on the next round.
    return null;
  }
}

export function startVersionChecks({
  currentBuildId,
  onNewVersion = () => {},
  intervalMs = VERSION_CHECK_INTERVAL_MS,
  scope = globalThis,
  fetchImpl = scope.fetch?.bind(scope),
  endpoint = VERSION_ENDPOINT,
  updateAttempted = wasUpdateAttempted(scope),
} = {}) {
  // updateAttempted was resolved above, before this line: reading it is what
  // consumes it, so a later load on this device starts from a clean URL.
  clearUpdateAttempt(scope);

  let announced = null;
  // The marker describes one reload, not the whole life of this tab. It expires
  // on the first answer from the server, because that answer settles the
  // question it was asking: same build means the update worked, a different one
  // means it did not. Keeping it set made every later deploy look like a failed
  // update to a tab that had been left open (clearing the URL only helps the
  // next load: this flag is what the current load actually reads).
  let updateAttemptPending = updateAttempted;

  const checkNow = async () => {
    const latest = await fetchLatestBuildId({ fetchImpl, endpoint });
    // No answer at all (offline, transient failure, malformed body): the marker
    // has learned nothing, so keep it for a check that does get an answer.
    if (latest === null) return;
    const afterFailedUpdate = updateAttemptPending;
    updateAttemptPending = false;
    if (!hasNewVersion(currentBuildId, latest)) return;
    // Announce each new build once; a user who dismissed the prompt should not
    // be asked again until the server actually moves on.
    if (announced === latest) return;
    announced = latest;
    // Still behind on the first answer after a requested update means
    // forceAppUpdate's bounded, fail-open waits reloaded onto the old build.
    // Repeating the normal prompt would loop the user through the same silent
    // failure, so the caller is told to say something different instead.
    onNewVersion(latest, { afterFailedUpdate });
  };

  const timer = scope.setInterval(() => void checkNow(), intervalMs);
  const onVisibilityChange = () => {
    if (scope.document?.visibilityState !== 'visible') return;
    return checkNow();
  };
  const visibilityTarget = scope.document;
  visibilityTarget?.addEventListener?.('visibilitychange', onVisibilityChange);

  // Check immediately rather than waiting out the first interval: a tab opened
  // just after a deploy should say so, and a marker left by a successful update
  // needs an answer to expire against.
  const ready = checkNow();

  return {
    checkNow,
    ready,
    stop() {
      scope.clearInterval(timer);
      visibilityTarget?.removeEventListener?.('visibilitychange', onVisibilityChange);
    },
  };
}
