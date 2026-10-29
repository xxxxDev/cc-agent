import {readFileSync} from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { describeSourceBuild, resolveBuildId } from './build/buildId.js';
import { createRequire } from 'node:module';
// The public address and the service port (server/siteConfig.js, one place).
const site = createRequire(import.meta.url)('./server/siteConfig.js');

// Build id: `git describe` of the last commit that could change the output —
// `v2026.9.11` on a release, `v2026.9.11-3-gabc1234` after it, `-dirty` for
// unsaved source. One marker for the Settings footer, the update prompt and
// /version.json; contract and rationale in build/buildId.js.
const BUILD_ID = resolveBuildId({ describe: describeSourceBuild });
// The release named in package.json, for the diagnostics text only.
// Read beside this file, whatever folder vite was started from.
const APP_VERSION=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).appVersion;

// Publishes the build id the server is serving so a running app can detect that
// it is on an older build. Deliberately excluded from the precache below: a
// cached copy would make the app compare itself against its own stale answer.
const versionEndpoint = () => ({
  name: 'version-endpoint',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: `${JSON.stringify({ buildId: BUILD_ID })}\n`,
    });
  },
});

// The dev server and the preview listen on this machine only and answer for the public
// name alone (server/siteConfig.js). The dev server passes the live updates and the
// terminal on to the service, as it does the API, so a page served by it works the same
// (both are WebSockets).
const target='http://127.0.0.1:'+site.servicePort();
const allowedHosts=[new URL(site.publicOrigin()).hostname];

export default defineConfig({
  base: '/',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    versionEndpoint(),
    vue({
      // Keep absolute "/..." URLs (public/ assets) as literal runtime
      // paths; plugin-vue defaults includeAbsolute:true at build time, which
      // would (incorrectly) try to bundle them and fail to resolve.
      template: { transformAssetUrls: { includeAbsolute: false } },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // The manifest's 1024 icon is fetched by the browser through the manifest/
      // apple-touch link; precaching it (the plugin's default) only added dead
      // weight to every update check. It stays out of the SW manifest entirely.
      includeManifestIcons: false,
      // No includeAssets: every public/ file worth caching is already picked up by
      // globPatterns below, and listing the agent-symbol PNGs here put each one in the
      // precache manifest twice (the two sources both match).
      manifest: {
        name: 'CC Agent',
        short_name: 'CC Agent',
        description: 'A web workspace for Claude Code agents',
        lang: 'en-US',
        display: 'standalone',
        background_color: '#121212',
        theme_color: '#121212',
        start_url: '/',
        scope: '/',
        // The CC Agent symbol (the transparent version for
        // dark backgrounds), set opaque on the app's own dark background: macOS 26 puts any
        // transparent icon on a default light tile, which is where the white square around
        // the installed Mac app came from.
        icons: [
          { src: '/agent-symbol-app-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
          { src: '/agent-symbol-app-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Activate + claim immediately so a fresh deploy can't be shadowed by a stale precache.
        // With registerType autoUpdate, one reload lands latest.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,ico,woff,woff2,json}'],
        // version.json must always come from the network; a precached copy would
        // answer the update check with the build the app is already running.
        // The 1024 icon is fetched by the browser only through the manifest/
        // apple-touch link (1.19MB of precache that update checks never used), and
        // browsers that run the woff2 never ask for the fallback .woff.
        globIgnores: ['version.json', '**/agent-symbol-app-1024.png', '**/*.woff'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/bridge\//, /^\/terminal\//, /\.[a-z0-9]+$/i],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4194304,
        // The generated Workbox worker owns caching; this reviewed sidecar adds
        // only Web Push display/click handling and never intercepts fetches. Its
        // product values come first (public/push-config.js).
        importScripts: ['/push-config.js', '/push-handler.js'],
      },
      // A service worker registered by the dev server makes installed iOS PWAs keep stale
      // index/CSS while the UI is being changed, so SW generation is for production builds only.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: site.DEV_PORT,
    strictPort: true,
    allowedHosts,
    headers: { 'Cache-Control': 'no-store' },
    proxy: { '/api': { target, changeOrigin: true }, '/live': { target, changeOrigin: true, ws: true }, '/terminal': { target, changeOrigin: true, ws: true } },
  },
  preview: {
    host: '127.0.0.1',
    port: site.DEV_PORT,
    allowedHosts,
    headers: { 'Cache-Control': 'no-store' },
  },
});
