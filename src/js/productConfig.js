// What is this product's own on the page's side: a product built on this code sets
// these values here, and the generic files read them from here. The
// server's is server/siteConfig.js (PRODUCT), the service worker's public/push-config.js.
//
// The storage keys keep the names already in use: under another name each browser
// would forget what it has kept here (its push device, its phone login key, its
// language, whether it was offered a passkey).
export const PRODUCT = Object.freeze({
  name: 'CC Agent',
  // components/InstallScreen.vue: the picture beside the name.
  installIcon: '/agent-symbol-128.png',
  // pages/LoginPage.vue: a picture before the name in the title; '' for none.
  loginLogo: '',
  storageKeys: Object.freeze({
    pushDeviceId: 'cc-push-id', // push.js
    loginKey: 'cc-agent-login-key', // qrLogin.js
    passkeyOffer: 'cc-agent-passkey-offer', // passkeys.js
    updateDialog: 'cc-agent-update-dialog', // updatePrompt.js
    sidebarFolded: 'cc-agent-sidebar-folded', // sidebarState.js
    sidebarAuto: 'cc-agent-sidebar-auto', // sidebarState.js
    language: 'cc-agent-lang', // i18n.js
  }),
  // push.js: the kinds of notification a device has before it says otherwise.
  pushPreferences: Object.freeze({ reply: true }),
  // notification-open.js: where public/push-handler.js leaves a tapped notification
  // for a page that could not be told; public/push-config.js names the same cache.
  intentCache: 'cc-agent-intent',
  // live-connection.js: the window event that carries the build the server names.
  buildEvent: 'cc-agent-build',
});
