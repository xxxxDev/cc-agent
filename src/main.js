import { createApp } from 'vue';
import { createPinia } from 'pinia';

// Framework7 core (full bundle: panel, popup, dialog, sortable, searchbar, swiper, ...)
import Framework7 from 'framework7/bundle';
import Framework7Vue, { registerComponents } from 'framework7-vue/bundle';

// Official F7 v9 bundle CSS + framework7-icons, then the app's skin (skin.css, scoped
// under .cc-app).
import 'framework7/css/bundle';
import 'framework7-icons';
import App from './App.vue';
import 'swiper/css';
import 'swiper/css/free-mode';
import './styles/tokens.css';
import './styles/skin.css';
import './styles/mobile.css';
import {initTheme} from './theme.js';
initTheme();
import { startSwUpdateChecks } from './js/sw-update.js';
import {startViewportRecovery} from './js/viewportRecovery.js';

Framework7.use(Framework7Vue);
import safeDialogs from './js/safeDialog.js';
import { PRODUCT } from './js/productConfig.js';
Framework7.use(safeDialogs);

// Build marker: log the build id on every load so the running build can be confirmed
// from devtools on any page/device (entry, app, desktop) — not only the Settings footer.
console.log(`[${PRODUCT.name}] build ${__BUILD_ID__}`);

const app = createApp(App);
app.use(createPinia());
registerComponents(app);
app.mount('#app');

startSwUpdateChecks();

import {bindTabbarViewport} from './js/tabbarViewport.js';
bindTabbarViewport();

import {showScrollbarsWhileScrolling} from './js/scrollbars.js';
showScrollbarsWhileScrolling();
startViewportRecovery();
