/* global self */

// What is this product's own in the service worker:
// public/push-handler.js is generic and reads this, which the
// worker loads just before it (vite.config.js, importScripts). The page's own values
// are in src/js/productConfig.js, the server's in server/siteConfig.js.
self.PUSH_CONFIG = Object.freeze({
  // What a notification may open: the app, one conversation, one scope report, one
  // diagnostics report, one proposed schedule or one group. Held to the address as sent and to the address
  // as the browser reads it (pathname and query).
  url: /^\/(?:\?(?:conversation|access-report|diagnostic-report|schedule|group)=[a-f0-9-]{36})?$/,
  icon: '/agent-symbol-256.png',
  badge: '/agent-symbol-128.png',
  // Where a tap is left for a page that could not be told; the page reads the same
  // cache (src/js/productConfig.js, intentCache).
  intentCache: 'cc-agent-intent',
});
