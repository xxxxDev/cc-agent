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
import './styles/blue-accent.css';
import './styles/mobile.css';
import './styles/listDetail.css';
import {initTheme} from './theme.js';
initTheme();
import { startSwUpdateChecks } from './js/sw-update.js';
import {startViewportRecovery} from './js/viewportRecovery.js';

Framework7.use(Framework7Vue);
import safeDialogs from './js/safeDialog.js';
import { tipDirective } from './js/hoverTip.js';
Framework7.use(safeDialogs);

const app = createApp(App);
app.use(createPinia());
// v-tip: an icon button's name under it while the mouse rests on it (js/hoverTip.js).
app.directive('tip', tipDirective);
registerComponents(app);
app.mount('#app');

startSwUpdateChecks();

import {bindTabbarViewport} from './js/tabbarViewport.js';
bindTabbarViewport();

import {showScrollbarsWhileScrolling} from './js/scrollbars.js';
showScrollbarsWhileScrolling();
startViewportRecovery();
