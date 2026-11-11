// The one update routine in the app. Settings' Force Update button and the
// "a new build is available" offer both run this, so there is a single place
// where the service worker takeover, the cache purge, and the reload target are
// defined. A second copy would drift from the attempt marker the version check
// reads back, and a failed update would look like being up to date again.
//
// Phase names are reported through onPhase so the caller owns the wording (this
// app is bilingual; the routine is not).

// Bounded and fail-open on purpose: a slow network once bricked the button for
// 10+ dead seconds. On timeout we reload anyway and the background
// worker checks pick the new version up afterwards.
export const UPDATE_TIMEOUT_MS = 4000;
export const CACHE_TIMEOUT_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function forceAppUpdate({ onPhase = () => {} } = {}) {
  onPhase('checking');
  try {
    // Keep the registration (and therefore the PushSubscription) intact while
    // asking the browser for the newest worker, then wait for its takeover
    // (controllerchange) so one tap really lands on the new version. The hard
    // deadline wraps the WHOLE phase including the sw.js fetch: that fetch has
    // no timeout of its own.
    if ('serviceWorker' in navigator) {
      await Promise.race([
        (async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          if (!registration) return;
          const swapped = new Promise((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          });
          await registration.update();
          if (registration.installing || registration.waiting) {
            onPhase('applying');
            await swapped;
          }
        })().catch(() => {}),
        sleep(UPDATE_TIMEOUT_MS),
      ]);
    }
    onPhase('reloading');
    if (window.caches && caches.keys) {
      await Promise.race([
        (async () => {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        })(),
        sleep(CACHE_TIMEOUT_MS),
      ]);
    }
  } catch (e) {
    /* ignore: reload regardless */
  }
  // Reload to the app root: reloading in place can trap the user on a
  // deep-linked page (e.g. a push-opened detail page).
  // The query parameter is how the freshly loaded app knows it is here because
  // the user asked to update: if it comes up still behind, the waits above
  // failed open and the user is told that instead of being offered the same
  // update again. Keep it in sync with UPDATE_ATTEMPT_PARAM in versionCheck.js.
  window.location.replace(`/?force_update=${Date.now()}`);
}
