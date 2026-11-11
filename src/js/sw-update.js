// Browsers only re-check sw.js on navigation, an explicit update() call, or a
// 24h cap: a tab left open never notices a deploy on its own and can keep a
// stale push handler for hours. The
// worker is built with skipWaiting, so a fetched update takes over at once;
// these background checks make that happen without the user reopening.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

async function check() {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  } catch (_error) {
    // Offline or transient fetch failure: the next tick tries again.
  }
}

export function startSwUpdateChecks() {
  if (!('serviceWorker' in navigator)) return;
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  if (typeof timer === 'object' && timer.unref) timer.unref();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
