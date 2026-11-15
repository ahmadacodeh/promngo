import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { http } from './api/http';
import { installSessionHooks } from './app/hooks';
import { createAppRouter } from './router';
import './styles/index.css';

const app = createApp(App);
app.use(createPinia());
const router = createAppRouter();
installSessionHooks(http, router);
app.use(router);
app.mount('#app'); // App.vue shows a skeleton until the session is restored
